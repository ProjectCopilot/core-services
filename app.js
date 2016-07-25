// Project Copilot Core Services
// Copyright 2016 Project Copilot

var app = require('express')();
var bodyParser = require('body-parser');
var colors = require('colors');
var communicate = require(__dirname+'/copilot-communications/index.js');
var dotenv = require('dotenv').config({path: __dirname+'/.env'});
var firebase = require('firebase');
var hashid = require('hashids', process.env.HASH_LENGTH);
var multiparty = require('multiparty');
var prioritize = require(__dirname+'/copilot-prioritize/index.js');

require('shelljs/global');

/* SET UP */
app.use(bodyParser.json({extended:true}));
app.use(bodyParser.urlencoded({extended:true}));
app.use(function(req, res, next) { // enable CORS and assume JSON return structure
  res.setHeader('Content-Type', 'application/json');
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
});

// setup Firebase
firebase.initializeApp({
  serviceAccount: process.env.FIREBASE_KEY_PATH,
  databaseURL: "https://"+process.env.FIREBASE_ID+".firebaseio.com"
});

// Initialize database
var db = firebase.database().ref("/");

var hash = new hashid(process.env.HASH_SALT);



/* CORE API ENDPOINTS */

/*
  POST /api/request -- takes input from HTML form in
  the user-client and adds it to a database (currently RethinkDB)
*/
app.post('/api/addUserRequest', function (req, res) {
  // specify post body schema
  var schema = {
    referral: 'String',
    name: 'String',
    age: 10,
    gender: 'String',
    school: 'String',
    contactMethod: 'String',
    contact: 'String',
    situation: 'String'
  }

  // validate the request body based on the specified schema
  var checkParams = validateRequestParameters(schema, req.body);

  // process entry
  if (checkParams.valid === true) {
    var pendingRequest = req.body;
    pendingRequest["time_submitted"] = new Date();
    pendingRequest["helped"] = false;

    db.child("requests").push(req.body, function () {
      res.status(200).end();
    });


  } else { // otherwise return error
    console.log("/api/addUserRequest".cyan + " had bad request for: ".blue + (checkParams.reason).red);
    res.status(500).end();
  }

});


/*
  GET /api/getNewRequests -- using the prioritize function, return the most urgent inquiries
  No schema necessary.
*/
app.get("/api/getRequests/:number", function (req, res) {
    // get the number of desired requests
    var numRequests = req.params.number;

    db.child("requests").orderByChild("time_submitted").limitToFirst(parseInt(numRequests, 10)).once("value", function (snapshot) {
      res.send(snapshot.val())
    });
});






/* COMMUNICATION ENDPOINTS/WEBHOOKS */

// Incoming email (SendGrid) webhook
app.post('/communication/incoming/email', function(req, res) {
  var form = new multiparty.Form();
  form.parse(req, function(err, fields, files) {
    var fromEmail = JSON.parse(fields.envelope).from;
    var rawEmailBody = fields.text[0];
    var fromHeader = fields.from[0];
    var body = stripEmail(rawEmailBody, fromHeader);

    var attachments = [];
    for (var key in files) {
      var fileInfo = files[key][0];
      var path = fileInfo.path;
      var uploadOutString = exec(__dirname+'/util/imgur.sh '+ path +' '+ process.env.IMGUR_CLIENT_ID, {silent:true}).stdout.replace(/\/n/g, "").trim();
      var uploadResponse = uploadOutString.indexOf("Error: ENOSPC") > -1 ? false : uploadOutString;

      if (uploadResponse !== false) {
        attachments.push(uploadResponse);
      }

    }

    var message = {
      "from": fromEmail,
      "body": body,
      "attachments": attachments
    };

    db.child("messages").child(message.from).push(message);

    res.status(200).end();

  });
});

// Incoming SMS (Twilio) webhook
app.post('/communication/incoming/sms', function (req, res) {
  var attachments = [];
  for (var i = 0; i < parseInt(req.body.NumMedia, 10); i++) {
    attachments.push(req.body["MediaUrl"+i.toString()]);
  }

  var numberPattern = /\d+/g;

  var message = {
    "from": (req.body.From).match(numberPattern).join("").substr(-10),
    "body": req.body.Body,
    "attachments": attachments
  }

  db.child("messages").child(message.from).push(message);

  res.status(200).end();
});


// Send a message
app.post('/communication/send', function (req, res) {

});


/* HELPER FUNCTIONS */

// given a body schema and the actual request body, return whether request body is valid or not and reason
function validateRequestParameters(schema, body) {
  var valid = true;
  var reason = "None";
  for (var field in schema) {
    if (!(field in body)) {
      valid == false;
      reason = "Missing parameters.";
      break;
    } else {
      if (typeof(schema[field]) == "string" && body[field].length == 0) {
        valid = false;
        reason = "Cannot pass empty string as parameter value.";
        break;
      } else if (typeof(schema[field]) == "number" && typeof(body[field]) == "string") {
        if (isNaN(parseInt(body[field], 10))) {
          valid = false;
          reason = "Cannot pass NaN value as numreic parameter value."
          break;
        }
        break;
      } else if (typeof(schema[field]) !== typeof(body[field])) {
        valid = false;
        reason = "Invalid parameter type " + typeof(body[field]) + " that should be " + typeof(schema[field]) + ".";
        break;
      }
    }
  }

  return {"valid": valid, "reason":reason};
}


// Removes reply message headers from emails
function stripEmail(emailString, fromHeader) {
  return emailString.substr(0, emailString.indexOf(fromHeader));
}


app.listen(process.env.PORT, process.env.HOSTNAME, function () {
  console.log(('Copilot Core Services running at ').blue + (process.env.HOSTNAME+":"+process.env.PORT).magenta);
  console.log('Node '+exec('node --version', {silent:true}).stdout);
});
