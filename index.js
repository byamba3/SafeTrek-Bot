var restify = require('restify');
var builder = require('botbuilder');
var request = require('request');

// Setup Restify Server
var server = restify.createServer();
server.listen(process.env.port || process.env.PORT || 3978, function () {
   console.log('%s listening to %s', server.name, server.url); 
});
  
// Create chat connector for communicating with the Bot Framework Service
var connector = new builder.ChatConnector({
    appId: process.env.MicrosoftAppId,
    appPassword: process.env.MicrosoftAppPassword,
    openIdMetadata: process.env.BotOpenIdMetadata 
});

// Listen for messages from users 
server.post('/api/messages', connector.listen());

var tableName = 'botdata';

// Create bot with root dialog

var inMemoryStorage = new builder.MemoryBotStorage();
const GOOGLE_GEOCODE_API_KEY = 'AIzaSyAZg0BlLFSYiQQGRtQa-EzUAihBo479GSA';

// This bot ensures user's profile is up to date.
var bot = new builder.UniversalBot(connector, [
    function (session) {
        console.log("begin");
        session.beginDialog('ensureProfile', session.userData.profile);
    },
    function (session, results) {
        session.userData.profile = results.response; // Save user profile.
        session.send(`Hello ${session.userData.profile.name}! Your current address is ${session.userData.profile.formatted_address}!`);
        session.say(`You can always change your current address by saying \"change my location\"`,`You can always change your current address by saying \"change my location\"`);
        session.say(`You may request for help by saying \"help me\"`);
    }
]).set('storage', inMemoryStorage); // Register in-memory storage 

//bot.set(`persistUserData`, false);

bot.dialog('ensureProfile', [
    function (session, args, next) {
        session.dialogData.profile = args || {}; // Set the profile or create the object.
        if (!session.dialogData.profile.name) {
            builder.Prompts.text(session, "What's your name?");
        } else {
            next(); // Skip if we already have this info.
        }
    },
    function (session, results, next) {
        if (results.response) {
            // Save user's name if we asked for it.
            session.dialogData.profile.name = results.response;
        }
        if (!session.dialogData.profile.formatted_address) {
            session.beginDialog('getAddress');
        } else {
            next(); // Skip if we already have this info.
        }
    },
    function (session, results) {
        if (results.response) {
            session.dialogData.profile.formatted_address = results.response.formatted_address;
            session.dialogData.profile.lat = results.response.lat;
            session.dialogData.profile.lng = results.response.lng;
        }
        session.endDialogWithResult({ response: session.dialogData.profile });
    }
]);

bot.dialog('getAddress', [
    function (session) {
        builder.Prompts.text(session, "Please enter a default address for help (Street address or Zipcode).");
    },
    function (session, results, next){
        if (results.response) {
            var url = 'https://maps.googleapis.com/maps/api/geocode/json?address=' + results.response + '&key=' + GOOGLE_GEOCODE_API_KEY;
            request.get(url, (err, res, body) =>  {
                if (err) {
                    console.log('Error:', err);
                } else if (res.statusCode !== 200) {
                    console.log('Status:', res.statusCode);
                } else {
                    var bodyObj = JSON.parse(body);
                    if(bodyObj['status'] == "OK"){
                        session.endDialogWithResult( {response: {formatted_address: bodyObj['results'][0]['formatted_address'], 
                        lat : bodyObj['results'][0]['geometry']['location']['lat'], lng : bodyObj['results'][0]['geometry']['location']['lng']}});
                    } else{
                        session.send("Invalid address entered.");
                        session.endDialog();
                    }

                }
            });
        } else{
            session.endDialog();
        }
    }]);

bot.dialog('getServices', [
    function (session, args) {
        builder.Prompts.choice(session, "Which service do you need?", "police|medical|fire", { listStyle: builder.ListStyle.button });
    },
    function (session, results) {
        if (results.response) {
            var serviceData = {
                "police": false,
                "medical": false,
                "fire": false
            };
            serviceData[results.response.entity] = true;
            session.endDialogWithResult( {response: serviceData} );
        } else {
            session.endDialog("Help request cancelled.");
        }
    }
]);

bot.dialog('helpDialog', [
    function (session, results, next) {
        if (!session.userData.profile) {
            session.beginDialog('updateLocationDialog');
        } else {
            next(); // Skip if we already have this info.
        }
    },
    function (session, next) {
        session.beginDialog("getServices");
    }, function (session, results){
        if(results.response){
            session.beginDialog('postHelp', {services: results.response, lat: session.userData.profile.lat, lng: session.userData.profile.lng});
        } else {
            session.endDialog();
        }
    }
]).triggerAction({ matches: /^help me$/i });

bot.dialog('postHelp', [
    function (session, args) {
        var AuthCombined = 'Bearer ' + tokenEntity.token;
        request.post({
            headers: { 'content-type': 'application/json', 'Authorization': AuthCombined},
            url: 'https://api-sandbox.safetrek.io/v1/alarms',
            body: JSON.stringify({
                "services": args.services,
                "location.coordinates": {
                    "lat": args.lat,
                    "lng": args.lng,
                    "accuracy": 15
                }
            })
        }, function (error, response, body) {
                if (response.statusCode === 401) {
                // Access token isn't valid, present the oauth flow again
                var msg = new builder.Message(session)
                    .addAttachment({
                        contentType: 'application/vnd.microsoft.card.oauth',
                        content: {}
                    });
                session.endConversation(msg);
                return;
                }

                if (error || response.statusCode !== 201) {
                    // API call failed, present an error
                    session.say('Failed to connect to SafeTrek', 'Sorry, we encountered and error! Please try again!', {
                        inputHint: builder.InputHint.ignoringInput
                    }).endConversation();
                    return;
                }

                var bodyObj = JSON.parse(body);
                session.userData.profile.alarm_id = bodyObj['id'];
                session.userData.profile.alarm_status = bodyObj['status'];
                
                session.say('We are now sending help!', 'We are now sending help!', {
                    inputHint: builder.InputHint.ignoringInput
                }).endDialog();
            });
        }
]);


bot.dialog('updateLocationDialog', [
    function (session) {
        session.beginDialog('getAddress');
    },
    function (session, results) {
        if (results.response) {
            session.userData.profile.formatted_address = results.response.formatted_address;
            session.userData.profile.lat = results.response.lat;
            session.userData.profile.lng = results.response.lng;
            session.send("Location set to: " + session.userData.profile.formatted_address);
            session.endDialogWithResult( {response: results.response} );
        } else{
            session.endDialog("Location not changed.");
        }
    }
]).triggerAction({ matches: /^change my location$/i });

