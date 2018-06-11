# Safe Trek - Microsoft Azure Bot Service
An Azure chat bot that makes REST API calls with SafeTrek. Optimized to work with Cortana channel. 

## Setting up
1. Go to https://portal.azure.com/
2. `Create a resource` -> `AI + Machine Learning` + `Web App Bot` 
3. Fill out the form, and set `Bot template` to Basic Node.js
4. Wait few minutes for the app to get deployed. Once deployed open it
5. Go to `Build` -> `Open online source editor`
6. Once inside, replace `app.js` and `package.json` with the one in this repository
7. Now go back to the previous page and go to `Channels`
8. Click on **Cortana** under `Add a featured channel`
9. Fill out the form with your OAuth 2.0 information. Redirect URL must be: `https://www.bing.com/agents/oauth`

## Usage
Log into your Cortana app with the same Microsoft account. Say "Ask `invocation name`", to launch the app. You can also directly say things like: "Ask `invocation name` to help", or "Ask `invocation name` to change address". 

## Google Maps Geocode API
Google Maps Geocode API is used to convert a user's address entry into a more properly formatted address, and longitude/latitude numbers. This API also does spell checking and best estimation for us. Google offers us with 2,500 free requests per day for free. This means 2,500 address changes can be requested per day by SafeTrek users. From there on, it's $0.50 per 1000 requests. 



