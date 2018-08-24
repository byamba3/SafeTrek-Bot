var restify = require('restify');
var builder = require('botbuilder');
var request = require('request');
var botbuilder_azure = require("botbuilder-azure");

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
var azureTableClient = new botbuilder_azure.AzureTableClient(tableName, process.env['AzureWebJobsStorage']);
var tableStorage = new botbuilder_azure.AzureBotStorage({ gzipData: false }, azureTableClient);

// Create bot with root dialog
 
var inMemoryStorage = new builder.MemoryBotStorage();
const GOOGLE_GEOCODE_API_KEY = 'AIzaSyAZg0BlLFSYiQQGRtQa-EzUAihBo479GSA';
const ADDRESS_PROMPT = "Please state a default address for help (Street address **and** either city, state, or zipcode).";
const ADDRESS_PROMPT_DURING_ALARM = "Please state a new address.";

var tokenEntity;
// This bot ensures user's profile is up to date.
var bot = new builder.UniversalBot(connector, [
    function (session, args, next) {
        tokenEntity = session.message.entities.find((e) => {
            return e.type === 'AuthorizationToken';
        });
        
        // If the token doesn't exist, then this is a non-Cortana channel
        if (!tokenEntity) {
            // Send message that info is not available
            session.say('Failed to get info', 'Sorry, I couldn\'t get your info. Try again later on Cortana.', {
                inputHint: builder.InputHint.ignoringInput
            }).endConversation();  
            return;
        }
        
        //Checks if there is a current alarm
        if(session.userData.profile && session.userData.profile.alarm_id){
            console.log("alarm id is: ", session.userData.profile.alarm_id);
            session.beginDialog('getAlarmStatus', {alarm_id: session.userData.profile.alarm_id});
        } else{          
            next();
        }
    },
    function (session, results){
        if(results.response){
           if(results.response == "ACTIVE"){
               console.log("alarm is active!");
               session.replaceDialog("alarmDialog");
           }
        }
        session.beginDialog('ensureProfile', session.userData.profile);
    },
    function (session, results) {
        session.userData.profile = results.response; // Save user profile.
        var msg = "Hello " + session.userData.profile.name +"! Your current address is " + session.userData.profile.formatted_address + "! \n You can always change your current address by saying \"change my location\".\n You may request for help by saying \"help me\".";
        session.say(msg,msg
            );
    }
]).set('storage', inMemoryStorage); // Register in-memory storage 

//bot.set(`persistUserData`, false);

bot.dialog('ensureProfile', [
    function (session, args, next) {
        session.dialogData.profile = args || {}; // Set the profile or create the object.
        if (!session.dialogData.profile.name) {
            builder.Prompts.text(session, 'What\'s your name?', {                                    
                speak: 'What\'s your name?',                                               
                retrySpeak: 'Please state your name.',  
                inputHint: builder.InputHint.expectingInput                                              
            });
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
            session.beginDialog('getAddress', {prompt: ADDRESS_PROMPT});
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

// Gets the type of service the user needs
bot.dialog('getServices', [
    function (session, args) {
        builder.Prompts.choice(session, "Which service do you need?", "police|medical|fire", { speak: "Which service do you need? Police, medical or fire?",
            retrySpeak: 'I did not catch that. Please say it again.', listStyle: builder.ListStyle.button });
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

// Gets the status of an alarm. Otherwise ends dialog if no alarm id is found in userData. 
// args.alarm_id - the id of the alarm
bot.dialog('getAlarmStatus', 
    function (session, args) {
        console.log('I am in getAlarmStatus');
        var AuthCombined = 'Bearer ' + tokenEntity.token;
        console.log("My auth is: " + AuthCombined);
        var url = 'https://api-sandbox.safetrek.io/v1/alarms/' + args.alarm_id + '/status';
        request.get(
            {
                headers: { 'content-type': 'application/json', 'Authorization': AuthCombined},
                url
                }, (err, res, body) =>  {
            if (err) {
                console.log('Error:', err);
            } else if (res.statusCode !== 200) {
                console.log('Alarm ID:', args.alarm_id);
                console.log('I am in getAlarmStatus');
                console.log('Status:', res.statusCode);
                session.endConversation();
                return;
            } else {
                var bodyObj = JSON.parse(body);
                session.endDialogWithResult( {response: bodyObj['status']});
            }
        });
    }
);

// Sends help request
// args.services - object services the user requested
// args.lat - latitude of the user
// args.lng - longitude of the user
bot.dialog('postHelp', [
    function (session, args) {
        var AuthCombined = 'Bearer ' + tokenEntity.token;
        console.log("My combined auth token:" + AuthCombined);
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
                console.log("I am in response function of postHelp");
                if (response.statusCode === 401) {
                    // Access token isn't valid, present the oauth flow again
                    console.log("I got 401 error in postHelp");
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
                    session.say('Failed to connect to Noonlight', 'Sorry, we encountered an error! Please try again!', {
                        inputHint: builder.InputHint.ignoringInput
                    }).endConversation();
                    return;
                }
                
                var bodyObj = JSON.parse(body);
                session.userData.profile.alarm_id = bodyObj['id'];
                
                session.say('We are now sending help!', 'We are now sending help!').endDialog();
            });
        }
]);

// Dialog that is launched when there is an active alarm
bot.dialog('alarmDialog', 
    function (session) {
        session.say("**You have an active alarm.**\n You can say things like: \n 1. \"update alarm location\"\n 2. \"cancel alarm\"", 
            "You have an active alarm. You can say things like \"update alarm location\", or \"cancel alarm\"");
    }
);

// Prompts user for address, then uses Google Geocode API to convert to long/lat points
// args.prompt - Custom prompt used to ask the user for their password
bot.dialog('getAddress', [
    function (session, args) {
        builder.Prompts.text(session, args.prompt, {speak: args.prompt});
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
                        session.say("Invalid address entered.", "Invalid address entered");
                        session.endDialog();
                    }

                }
            });
        } else{
            session.endDialog();
        }
    }]).cancelAction('cancelAction', 'Ok, cancelling address change.', {
    matches: /^nevermind$|^cancel$|^stop$|I do not know/i
});

// sends a POST request to update a current alarm's location 
// args.alarm_id - current Alarm's id
// args.lat - latitude of new location
// args.lng - longitude of new location
bot.dialog('postUpdatedAlarmLocation', 
    function (session, args) {
        var AuthCombined = 'Bearer ' + tokenEntity.token;
        request.post({
            headers: { 'content-type': 'application/json', 'Authorization': AuthCombined},
            url: 'https://api-sandbox.safetrek.io/v1/alarms/' + args.alarm_id + '/locations',
            body: JSON.stringify({
                "id": session.userData.alarm_id,
                "coordinates": {
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

                if (error || response.statusCode !== 200) {
                    // API call failed, present an error
                    console.log('Alarm ID:', args.alarm_id);
                    console.log('I am in postUpdatedAlarmLocation');
                    console.log('Status:', response.statusCode);
                    session.say('Failed to connect to Noonlight', 'Sorry, we encountered an error! Please try again!', {
                        inputHint: builder.InputHint.ignoringInput
                    }).endConversation();
                    return;
                }
                
                session.say('Alarm location updated!', 'I updated your alarm location!').endDialog();
            });
    }
);

// Always on Listeners - These dialogs are triggered from anywhere. User's input must match first. 

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
            session.replaceDialog("alarmDialog");
        } else {
            session.endDialog();
        }
    }
]).triggerAction({ matches: /^.*help.*$/i });

bot.dialog('updateLocationDialog', [
    function (session, results, next){
        console.log("I was called in updateLocationDialog");
        if(session.userData.profile && session.userData.profile.alarm_id){
            console.log("alarm id exists");
            session.beginDialog('getAlarmStatus', {alarm_id: session.userData.profile.alarm_id});
        } else{
            console.log("alarm id doesn't exist");
            next();
        }
    },
    function (session, results){
        console.log("I am called in 2nd function");
        if(results.response){
           if(results.response == "ACTIVE"){
               console.log("Alarm is active");
               session.userData.profile.alarm_status = "ACTIVE";
               session.beginDialog("getAddress", {prompt: ADDRESS_PROMPT_DURING_ALARM});
           }
        }
        else{
               console.log("Alarm is not active");
               session.beginDialog("getAddress", {prompt: ADDRESS_PROMPT});
        }
    },
    function (session, results) {
        if (results.response) {
            if( session.userData.profile && session.userData.profile.alarm_status == "ACTIVE"){
                session.beginDialog("postUpdatedAlarmLocation", {lat: results.response.lat, lng : results.response.lng, alarm_id : session.userData.profile.alarm_id});
            } else{
                session.userData.profile.formatted_address = results.response.formatted_address;
                session.userData.profile.lat = results.response.lat;
                session.userData.profile.lng = results.response.lng;
                session.say("Location set to: " + session.userData.profile.formatted_address, "Location set.");
                session.endDialogWithResult( {response: results.response} );
            }
        } else{
            session.endDialog("Location not changed.");
        }
    }
]).triggerAction({ matches: /^(change|alter|modify|revise|replace|update).*(location|address)/i });

bot.dialog('postCancelHelp', [
     function (session) {
            var prompt = "Please state your Pin code!";
            builder.Prompts.text(session, prompt, {speak: prompt});
     },
    function (session, results) {
        if (!results.response) {
            session.endDialog("Alarm cancel failed.");
        }
        var AuthCombined = 'Bearer ' + tokenEntity.token;
        request.put({
            headers: { 'content-type': 'application/json', 'Authorization': AuthCombined},
            url: 'https://api-sandbox.safetrek.io/v1/alarms/' + session.userData.profile.alarm_id + '/status',
            body: JSON.stringify({
                "status": "CANCELED",
                "pin": results.response
            })
        }, function (error, response, body) {
                if (body.code === 400) {
                    session.say(body.details, body.details, {
                        inputHint: builder.InputHint.ignoringInput
                    }).endConversation();
                }
                
                if (response.statusCode === 400) {
                // Access token isn't valid, present the oauth flow again
                var msg = new builder.Message(session)
                    .addAttachment({
                        contentType: 'application/vnd.microsoft.card.oauth',
                        content: {}
                    });
                session.endConversation(msg);
                return;
                }

                if (error || response.statusCode !== 200) {
                    // API call failed, present an error
                    console.log('error:', error);
                    console.log('response: ', response);
                    console.log('body: ', body);
                    console.log('Status:', response.statusCode);
                    session.say('Failed to connect to Noonlight', 'Sorry, we encountered an error! Please try again!', {
                        inputHint: builder.InputHint.ignoringInput
                    }).endConversation();
                    return;
                }

                session.say('Alarm cancelled!', 'Your alarm has been cancelled!');
            });
        }
]).triggerAction({ matches: /^(cancel|halt|stop).*(alarm|help|request)/i });