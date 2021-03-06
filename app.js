/**
 * Created by Pawan on 11/4/2015.
 */

var config=require('config');
var restify = require('restify');
var DbConn = require('dvp-dbmodels');
var httpReq = require('request');
var util = require('util');
var uuid = require('node-uuid');
var async= require('async');
var gcm = require('node-gcm');
var moment = require('moment');
var validator = require('validator');
var redisManager=require('./RedisManager.js');
var logger = require('dvp-common/LogHandler/CommonLogHandler.js').logger;
var DBController = require('./DBController.js');
var messageFormatter = require('dvp-common/CommonMessageGenerator/ClientMessageJsonFormatter.js');


var secret = require('dvp-common/Authentication/Secret.js');
var socketioJwt =  require("socketio-jwt");
var jwt = require('restify-jwt');
var authorization = require('dvp-common/Authentication/Authorization.js');
var adapter = require('socket.io-redis');
var redis = require('redis').createClient;



////////////////////////////////redis////////////////////////////////////////
var redisip = config.Redis.ip;
var redisport = config.Redis.port;
var redisdb = config.Redis.db;
var redisuser = config.Redis.user;
var redispass = config.Redis.password;
////////////////////////////////////////////////////////////////////////////////



var opt = {
    pingTimeout: 60000,
    pingInterval: 25000,
    transports: ['websocket'],
    allowUpgrades: false,
    cookie: false
};

var socketio = require('socket.io',opt);


var pub = redis(redisport, redisip, { auth_pass: redispass });
var sub = redis(redisport, redisip, { auth_pass: redispass });


var port = config.Host.port || 3000;
var version=config.Host.version;
var token=config.Token;
var Sender = new gcm.Sender(config.SENDER);


var TTL = config.TTL.ttl;
var MyID = config.ID;


var Notice = require('dvp-mongomodels/model/Notice').Notice;
var User = require('dvp-mongomodels/model/User');
var UserGroup = require('dvp-mongomodels/model/UserGroup').UserGroup;


var RestServer = restify.createServer({
    name: "myapp",
    version: '1.0.0'
});

var io = socketio.listen(RestServer.server);
io.adapter(adapter({ pubClient: pub, subClient: sub }));
//restify.CORS.ALLOW_HEADERS.push('authorization');


//var utcSeconds = parseInt("139981498411584")/1000000;
//var m = moment.unix(utcSeconds);
//var date = m.format("YYYY-MM-DD HH:mm:ss");


//var d = new Date(0); // The 0 there is the key, which sets the date to the epoch
//d.setUTCSeconds(utcSeconds);
//eventTime = moment(d).format("yyyy-MM-dd HH:mm:ss");



restify.CORS.ALLOW_HEADERS.push('authorization');
restify.CORS.ALLOW_HEADERS.push('eventname');
restify.CORS.ALLOW_HEADERS.push('eventuuid');
restify.CORS.ALLOW_HEADERS.push('appkey');
RestServer.use(restify.CORS());
RestServer.use(restify.fullResponse());
RestServer.use(restify.bodyParser());
RestServer.use(restify.acceptParser(RestServer.acceptable));
RestServer.use(restify.queryParser());


RestServer.use(jwt({secret: secret.Secret}));

var Clients ={};//=new Array();
var Refs=new Array();

var newSock;

var inboxMode=config.PERSISTENCY.inbox_mode;


//Server listen

var mongoip=config.Mongo.ip;
var mongoport=config.Mongo.port;
var mongodb=config.Mongo.dbname;
var mongouser=config.Mongo.user;
var mongopass = config.Mongo.password;
var mongoreplicaset= config.Mongo.replicaset;

var mongoose = require('mongoose');
var connectionstring = '';
if(util.isArray(mongoip)){

    mongoip.forEach(function(item){
        connectionstring += util.format('%s:%d,',item,mongoport)
    });

    connectionstring = connectionstring.substring(0, connectionstring.length - 1);
    connectionstring = util.format('mongodb://%s:%s@%s/%s',mongouser,mongopass,connectionstring,mongodb);

    if(mongoreplicaset){
        connectionstring = util.format('%s?replicaSet=%s',connectionstring,mongoreplicaset) ;
    }
}else{

    connectionstring = util.format('mongodb://%s:%s@%s:%d/%s',mongouser,mongopass,mongoip,mongoport,mongodb)
}


mongoose.connect(connectionstring,{server:{auto_reconnect:true}});


mongoose.connection.on('error', function (err) {
    console.error( new Error(err));
    mongoose.disconnect();

});

mongoose.connection.on('opening', function() {
    console.log("reconnecting... %d", mongoose.connection.readyState);
});


mongoose.connection.on('disconnected', function() {
    console.error( new Error('Could not connect to database'));
    mongoose.connect(connectionstring,{server:{auto_reconnect:true}});
});

mongoose.connection.once('open', function() {
    console.log("Connected to db");

});


mongoose.connection.on('reconnected', function () {
    console.log('MongoDB reconnected!');
});

mongoose.connection.on('error', function(err) {
    console.error('MongoDB error: %s', err);
});

process.on('SIGINT', function() {
    mongoose.connection.close(function () {
        console.log('Mongoose default connection disconnected through app termination');
        process.exit(0);
    });
});



RestServer.listen(port, function () {
    console.log('%s listening at %s', RestServer.name, RestServer.url);

});


var Schema = mongoose.Schema;
var ObjectId = Schema.ObjectId;






io.sockets.on('connection',socketioJwt.authorize({
    secret:  secret.Secret,
    timeout: 15000 // 15 seconds to send the authentication message
})).on('authenticated',function (socket) {

    console.log(socket.decoded_token.iss);
    newSock=socket;
    console.log('authenticated received ');
    var clientID = socket.decoded_token.iss;
    console.log("Client logged "+clientID);
    socket.emit('clientdetails',clientID);
    console.log(clientID);

//get client's identity

    socket.join(clientID);

    if(clientID)
    {
        console.log('authenticated Client :- '+clientID);

        if(Clients[clientID])
        {
            console.log("New Instance");
            var curSockArray=[];
            curSockArray=Clients[clientID];
            curSockArray.push(socket);
            Clients[clientID]= curSockArray;
        }
        else
        {
            console.log("new Client");
            var curSockArray=[];
            curSockArray.push(socket);
            Clients[clientID]=curSockArray;

        }

        redisManager.LocationListPicker(clientID, function (errList,resList) {

            if(errList)
            {
                console.log("Error in Checking Register status of "+clientID,errList);
            }
            else
            {


                //if(typeof resList !== 'undefined' && resList.length > 0)
                if(resList.length > 0)
                {

                    // console.log("New Client instance Added");
                    if(resList.indexOf(MyID)==-1)
                    {
                        console.log("New user for This server");
                        redisManager.RecordUserServer(clientID,MyID, function (errSet,resSet) {
                            if(errSet)
                            {
                                console.log("Error in Client registration, Client : "+clientID+" Error : "+errSet);
                            }
                            else
                            {

                                console.log("New Client Registered : "+clientID);

                            }
                        });
                    }
                    else
                    {
                        console.log("New user instance for This server");

                    }
                }
                else
                {

                    console.log("New user for This server for first time");

                    redisManager.RecordUserServer(clientID,MyID, function (errSet,resSet) {
                        if(errSet)
                        {
                            console.log("Error in Client registration, Client : "+clientID+" Error : "+errSet);
                        }
                        else
                        {

                            console.log("New Client Registered FirstTime : "+clientID);

                        }
                    });


                }

                /*DBController.QueuedMessagesPicker(clientID, function (errMsg,resMsg) {

                    if(errMsg)
                    {
                        console.log("Error in queued messages searching for Client : "+clientID,errMsg);
                    }
                    else
                    {
                        console.log(resMsg.length+" Messages found for Client : "+clientID);
                        for(i=0 ;i<resMsg.length;i++)
                        {
                            QueuedMessageOperator(resMsg[i],socket);
                        }


                    }
                });*/
            }

        });
    }

    socket.on('authenticate', function (data) {
        console.log("authenticate  received from client ");
        console.log("authenticate  : "+JSON.stringify(data));


    })

    socket.on('reply',function(data)
    {
        console.log("Reply received from client ");
        console.log("Message : "+data.Message);
        var clientTopic=data.Tkey;

        console.log("Token key from Client "+clientTopic);


        redisManager.ResponseUrlPicker(clientTopic,TTL, function (errURL,resURL) {

            if(errURL)
            {
                console.log("Error in searching URL ",errURL);
            }
            else
            {
                if(!resURL || resURL==null || resURL=="")
                {
                    console.log("Invalid URL records found ",resURL)
                }
                else
                {
                    var direction = resURL[0];
                    var URL =resURL[1];

                    console.log("URL "+URL);
                    console.log("DIRECTION "+direction);

                    if(direction=="STATELESS" )
                    {

                    }
                    else
                    {
                        if(direction=="STATEFUL" && URL!=null)
                        {
                            var replyObj={
                                Reply:data,
                                Ref:Refs[clientTopic]
                            };

                            console.log("Reply to sender .... "+JSON.stringify(replyObj));

                            var optionsX = {url: URL, method: "POST", json: replyObj};
                            httpReq(optionsX, function (errorX, responseX, dataX) {

                                if(errorX)
                                {
                                    console.log("ERROR sending request "+errorX);
                                }
                                else if (!errorX && responseX != undefined ) {

                                    console.log("Sent "+data+" To "+URL);

                                }
                                else
                                {
                                    console.log("Nooooooo");
                                }
                            });
                        }
                        else
                        {
                            console.log("Invalid Callback URL found "+resURL);
                        }
                    }

                }
            }
        });


    });
    socket.on('disconnect',function(reason)
    { var ClientID=socket.decoded_token.iss;
        console.log("Disconnected "+socket.id+" Reason "+reason);
        console.log("Socket ID ",socket.id);
        console.log("ClientID "+ClientID);

        if(typeof Clients[ClientID] !== 'undefined' && Clients[ClientID].length >1)
        {

            var index = Clients[ClientID].indexOf(socket);
            Clients[ClientID].splice(index, 1);
            //delete Clients[ClientID][Clients[ClientID].indexOf(socket)];
            console.log("Client Id instance disconnected ",socket.id);
        }
        else
        {
            redisManager.ClientLocationDataRemover(ClientID,MyID, function (e,r) {

                var index = Clients[ClientID].indexOf(socket);
                Clients[ClientID].splice(index, 1);
                if(e)
                {
                    console.log("Error in Client Location removing "+e);

                    console.log("Client Id instance disconnected from server ",socket.id);
                    //  res.end();
                }
                else
                {
                    console.log("Client Location removed "+r);
                    console.log("Client Id instance disconnected ",socket.id);

                    //res.end();
                }
            });
        }



    });

    socket.emit('message',"Hello "+socket.decoded_token.iss);

    socket.on('subscribe', function (subsObj) {

        InitiateSubscriber(clientID,subsObj, function (errSubs,resSubs) {

            if(errSubs)
            {
                console.log("Error in subscribing Client : "+clientID+" Error : "+errSubs);
            }
            else
            {
                console.log("Successfully Subscribed, Key : "+resSubs);
            }
        });
    });

});


// check and follow common format or res.end();

RestServer.post('/DVP/API/:version/NotificationService/Notification/initiate',authorization({resource:"notification", action:"write"}),function(req,res,next)
{
    if(!req.user.company || !req.user.tenant)
    {
        throw new Error("Invalid company or tenant");
    }

    var Company=req.user.company;
    var Tenant=req.user.tenant;
    var compInfo = Tenant + ':' + Company;
    console.log("New request form "+req.body.From);

    var clientID=req.body.To;
    var eventName=req.headers.eventname;
    var eventUuid=req.headers.eventuuid;
    var msgSenderArray=[];
    if(!isNaN(req.body.Timeout))
    {
        TTL =req.body.Timeout;
        console.log("TTL found "+TTL);
    }

    var callbackURL=req.body.CallbackURL;
    var topicID=TopicIdGenerator();
    var direction=req.body.Direction;
    var message=req.body.Message;
    var ref=req.body.Ref;

    Refs[topicID]=ref;


    var sender = req.body.From;


    var msgObj={
        "Tenant":Tenant,
        "Company":Company,
        "eventUuid":eventUuid,
        "TopicKey":topicID,
        "Message":message,
        "eventName":eventName,
        "From":sender
    };


    if(direction=="STATEFUL")
    {
        callbackURL=req.body.CallbackURL;
        redisManager.TokenObjectCreator(topicID,clientID,direction,sender,callbackURL,TTL,function(errTobj,resTobj){
            if(errTobj){
                logger.error('Set TokenObjectCreator Failed :: ' + errTobj);
            }
        });
    }

    GooglePushMessageSender(clientID,msgObj, function (errGnotf,resGnotf) {
        if(errGnotf)
        {
            console.log("Error in Google notifications:  "+errGnotf);
        }
        else
        {
            console.log("Success. Google notifications sent:  "+resGnotf);
        }
    });

    if(eventName == 'message'){

        eventName = 'notice_message';

    }


    console.log("Event Name : " + eventName);
    console.log("Event Message : " + msgObj);
    console.log("Event User : " + clientID);


    io.sockets.adapter.clients( [clientID], function (err, clients) {
        logger.info('io.sockets.adapter.clients result :: clients :: '+ JSON.stringify(clients) +' :: err :: '+ err);
        if (!err && (Array.isArray(clients) && clients.length > 0) ) {


            io.to(clientID).emit(eventName, msgObj);
            console.log("Notification sent : " + JSON.stringify(msgObj));
            if(req.body.isPersist)
            {
                DBController.PersistenceMessageRecorder(req, function (errSave, resSave) {

                    if (errSave) {
                        console.log("Error in Message Saving ", errSave);
                        res.end();
                    }
                    else {
                        console.log("Message saving succeeded ");
                        res.end("Message saved until related client is online");
                    }
                });
            }
            else
            {
                console.log("Message saving succeeded ");
                res.end("Message is not stored");
            }




        }else {

            logger.error('No user available in room', err);

            if (inboxMode) {
                DBController.InboxMessageSender(req, function (errInbox, resInbox) {
                    if (errInbox) {
                        console.log("Error in Message Saving ", errInbox);
                        res.end();
                    }
                    else {
                        console.log("Message saving succeeded ");
                        res.end("Message saved to related client's inbox");
                    }
                });
            }
            else {
                DBController.PersistenceMessageRecorder(req, function (errSave, resSave) {

                    if (errSave) {
                        console.log("Error in Message Saving ", errSave);
                        res.end();
                    }
                    else {
                        console.log("Message saving succeeded ");
                        res.end("Message saved until related client is online");
                    }
                });
            }


        }
    });

    ////////////////////////////////////////////////on special call status events//////////
    var isCallEvent = false;
    var callObject = {};
    //msg = switch_mprintf("agent_found|%q|%q|%q|%q|%q|%q|inbound|%q", h->member_uuid, skill, cid_number, cid_name, calling_number, h->skills, engagement_type);

    console.log("Message is "+message);
    var messageList = message.split('|');

    console.log("Message list object is" + JSON.stringify(messageList) );

    console.log("Message list object length is " + messageList.length );

    if (eventName == "agent_connected") {


        isCallEvent = true;
        if (Array.isArray(messageList) && messageList.length > 9) {


            callObject.action = "answered";
            callObject.session = messageList[1];
            callObject.from = messageList[3];
            callObject.to = messageList[5];
            callObject.profile = messageList[9];
        }

    }
    else if (eventName == "agent_disconnected") {

        isCallEvent = true;

        if (Array.isArray(messageList) && messageList.length > 11) {

            callObject.action = "hungup";
            callObject.session = messageList[1];
            callObject.from = messageList[3];
            callObject.to = messageList[5];
            callObject.profile = messageList[9];
            var startTime = messageList[10];
            var utcSeconds = parseInt(startTime)/1000000;
            var m = moment.unix(utcSeconds);
            var date = m.format("YYYY-MM-DD HH:mm:ss");


            callObject.starttime = date;
            callObject.direction = messageList[7];
            callObject.duration = messageList[11];
            callObject.description = messageList[8];

        }

    }
    else if (eventName == "agent_found") {

        isCallEvent = true;

        if (Array.isArray(messageList) && messageList.length > 9) {


            console.log("Agents found crm ready to call .....");
            callObject.action = "received";
            callObject.session = messageList[1];
            callObject.from = messageList[3];
            callObject.to = messageList[5];
            callObject.profile = messageList[9];
        }

    }
    else if (eventName == "agent_rejected") {

        isCallEvent = true;

        if (Array.isArray(messageList) && messageList.length > 11) {

            callObject.action = "missed";
            callObject.session = messageList[1];
            callObject.from = messageList[3];
            callObject.to = messageList[5];
            callObject.profile = messageList[9];

            var startTime = messageList[11];
            var utcSeconds = parseInt(startTime)/1000000;
            var m = moment.unix(utcSeconds);
            var date = m.format("YYYY-MM-DD HH:mm:ss");

            callObject.missedtime =  date;
            callObject.sequential = true;
        }

    }

    if(isCallEvent){

        console.log("Call Object is "+ JSON.stringify(callObject));
        CallCRM(Company,Tenant,callObject);
    }


    ////////////////////////////////////////////////////////////////////////////////////////

    //redisManager.LocationListPicker(clientID, function (errList,resList) {
    //
    //    console.log("Checking Availability of Client :  "+clientID);
    //
    //    if(errList)
    //    {
    //        console.log("Client is not available.......................");
    //        console.log("Error in Checking Availability ",errList);
    //        res.end();
    //    }
    //    else if(typeof resList !== 'undefined' && resList.length > 0)
    //    {
    //
    //        redisManager.TokenObjectCreator(topicID,clientID,direction,sender,callbackURL,TTL,function(errTobj,resTobj)
    //        {
    //            resList.forEach(function (serverId) {
    //
    //                msgSenderArray.push(function createContact(callback)
    //                {
    //
    //                    if(serverId==MyID)
    //                    {
    //
    //                        if(Clients[clientID])
    //                        {
    //
    //                            var insArray =Clients[clientID];
    //                            for(var i=0;i<insArray.length;i++) {
    //                                var insSocket = insArray[i];
    //
    //
    //                                console.log("Event Name : " + eventName);
    //                                console.log("Event Message : " + msgObj);
    //
    //                                insSocket.emit(eventName, msgObj);
    //                                console.log("Notification sent : " + JSON.stringify(msgObj));
    //
    //
    //                                ////////////////////////////////////////////////on special call status events//////////
    //                                var isCallEvent = false;
    //                                var callObject = {};
    //                                //msg = switch_mprintf("agent_found|%q|%q|%q|%q|%q|%q|inbound|%q", h->member_uuid, skill, cid_number, cid_name, calling_number, h->skills, engagement_type);
    //
    //                               console.log("Message is "+message);
    //                                var messageList = message.split('|');
    //
    //                                console.log("Message list object is" + JSON.stringify(messageList) );
    //
    //                                console.log("Message list object length is " + messageList.length );
    //
    //                                if (eventName == "agent_connected") {
    //
    //
    //                                    isCallEvent = true;
    //                                    if (Array.isArray(messageList) && messageList.length > 9) {
    //
    //
    //                                        callObject.action = "answered";
    //                                        callObject.session = messageList[1];
    //                                        callObject.from = messageList[3];
    //                                        callObject.to = messageList[5];
    //                                        callObject.profile = messageList[9];
    //                                    }
    //
    //                                }
    //                                else if (eventName == "agent_disconnected") {
    //
    //                                    isCallEvent = true;
    //
    //                                    if (Array.isArray(messageList) && messageList.length > 11) {
    //
    //                                        callObject.action = "hungup";
    //                                        callObject.session = messageList[1];
    //                                        callObject.from = messageList[3];
    //                                        callObject.to = messageList[5];
    //                                        callObject.profile = messageList[9];
    //                                        var startTime = messageList[10];
    //                                        var utcSeconds = parseInt(startTime)/1000000;
    //                                        var m = moment.unix(utcSeconds);
    //                                        var date = m.format("YYYY-MM-DD HH:mm:ss");
    //
    //
    //                                        callObject.starttime = date;
    //                                        callObject.direction = messageList[7];
    //                                        callObject.duration = messageList[11];
    //                                        callObject.description = messageList[8];
    //
    //                                    }
    //
    //                                }
    //                                else if (eventName == "agent_found") {
    //
    //                                    isCallEvent = true;
    //
    //                                    if (Array.isArray(messageList) && messageList.length > 9) {
    //
    //
    //                                        console.log("Agents found crm ready to call .....");
    //                                        callObject.action = "received";
    //                                        callObject.session = messageList[1];
    //                                        callObject.from = messageList[3];
    //                                        callObject.to = messageList[5];
    //                                        callObject.profile = messageList[9];
    //                                    }
    //
    //                                }
    //                                else if (eventName == "agent_rejected") {
    //
    //                                    isCallEvent = true;
    //
    //                                    if (Array.isArray(messageList) && messageList.length > 11) {
    //
    //                                        callObject.action = "missed";
    //                                        callObject.session = messageList[1];
    //                                        callObject.from = messageList[3];
    //                                        callObject.to = messageList[5];
    //                                        callObject.profile = messageList[9];
    //
    //                                        var startTime = messageList[11];
    //                                        var utcSeconds = parseInt(startTime)/1000000;
    //                                        var m = moment.unix(utcSeconds);
    //                                        var date = m.format("YYYY-MM-DD HH:mm:ss");
    //
    //                                        callObject.missedtime =  date;
    //                                        callObject.sequential = true;
    //                                    }
    //
    //                                }
    //
    //                                if(isCallEvent){
    //
    //                                    console.log("Call Object is "+ JSON.stringify(callObject));
    //                                    CallCRM(Company,Tenant,callObject);
    //                                }
    //                                ////////////////////////////////////////////////////////////////////////////////////////
    //
    //
    //                                if (i == insArray.length - 1) {
    //                                    //res.end();
    //                                    callback(undefined, "Success");
    //                                }
    //                            }
    //
    //                        }
    //                        else
    //                        {
    //                            console.log("hit No client");
    //                            callback(new Error("No registered Client found"),undefined);
    //                        }
    //                    }
    //                    else
    //                    {
    //                        console.log("Remote Client Instance found");
    //                        DBController.ServerPicker(serverId, function (errServ,resServ) {
    //                            if(errServ)
    //                            {
    //                                console.log("Error in server picking");
    //                                callback(errServ,undefined);
    //                            }
    //                            else if(!resServ)
    //                            {
    //                                console.log("Invalid server ID");
    //                                callback(new Error("Invalid Server ID"),undefined);
    //                            }
    //                            else
    //                            {
    //                                var ServerIP = resServ.URL;
    //                                console.log(ServerIP);
    //
    //
    //                                var httpUrl = util.format('http://%s/DVP/API/%s/NotificationService/Notification/initiate/fromRemoteserver', ServerIP, version);
    //                                console.log("URL "+httpUrl);
    //
    //                                var options = {
    //                                    url : httpUrl,
    //                                    method : 'POST',
    //                                    json : req.body,
    //                                    headers:{
    //                                        'eventName':req.headers.eventname,
    //                                        'eventUuid':req.headers.eventuuid,
    //                                        'authorization':"bearer "+token,
    //                                        'topic':topicID,
    //                                        'companyinfo': compInfo
    //                                    }
    //
    //                                };
    //
    //
    //                                httpReq(options, function (error, response, body)
    //                                {
    //                                    if (!error && response.statusCode == 200)
    //                                    {
    //                                        console.log("no errrs");
    //                                        //console.log(JSON.stringify(response));
    //                                        callback(undefined,"Success")
    //                                    }
    //                                    else
    //                                    {
    //                                        console.log("errrs  "+error);
    //                                        callback(error,undefined);
    //
    //
    //                                    }
    //                                });
    //                            }
    //                        });
    //                    }
    //
    //
    //                });
    //
    //
    //
    //            });
    //            async.parallel(msgSenderArray, function (errBulkSend,resSend) {
    //
    //                if(errBulkSend)
    //                {
    //                    console.log(errBulkSend);
    //                    //res.end(errBulkSend.toString());
    //                }
    //
    //
    //            });
    //
    //        });
    //
    //
    //
    //
    //        res.end(topicID);
    //
    //
    //    }
    //    else
    //    {
    //        console.log("No client found.....................");
    //        if(req.body.Persistency)
    //        {
    //            console.log("No client found,  backing up messages ");
    //
    //            if(inboxMode)
    //            {
    //                DBController.InboxMessageSender(req, function (errInbox,resInbox) {
    //                    if(errInbox)
    //                    {
    //                        console.log("Error in Message Saving ",errInbox);
    //                        res.end();
    //                    }
    //                    else
    //                    {
    //                        console.log("Message saving succeeded ");
    //                        res.end("Message saved to related client's inbox");
    //                    }
    //                });
    //            }
    //            else
    //            {
    //                DBController.PersistenceMessageRecorder(req, function (errSave,resSave) {
    //
    //                    if(errSave)
    //                    {
    //                        console.log("Error in Message Saving ",errSave);
    //                        res.end();
    //                    }
    //                    else
    //                    {
    //                        console.log("Message saving succeeded ",resSave);
    //                        res.end("Message saved until related client is online");
    //                    }
    //                });
    //            }
    //
    //
    //        }
    //        else
    //        {
    //            console.log("No client found, Operation ends without backing up messages");
    //            res.end();
    //        }
    //
    //    }
    //});
    return next();

});

RestServer.post('/DVP/API/:version/NotificationService/Notification/reply',authorization({resource:"notification", action:"write"}),function(req,res,next){

    var jsonString;
    try{

        console.log("Reply received from client ");
        console.log("Message : "+req.body.Message);
        var clientTopic=req.body.Tkey;

        console.log("Token key from Client "+clientTopic);


        redisManager.ResponseUrlPicker(clientTopic,TTL, function (errURL,resURL) {

            if(errURL)
            {
                console.log("Error in searching URL ",errURL);
                jsonString = messageFormatter.FormatMessage(errURL, 'Error in searching URL', false, undefined);
                res.end(jsonString);
            }
            else
            {
                if(!resURL || resURL==null || resURL=="")
                {
                    console.log("Invalid URL records found ",resURL);
                    jsonString = messageFormatter.FormatMessage(undefined, 'Invalid URL records found', false, resURL);
                    res.end(jsonString);
                }
                else
                {
                    var direction = resURL[0];
                    var URL =resURL[1];

                    console.log("URL "+URL);
                    console.log("DIRECTION "+direction);

                    if(direction=="STATEFUL" && URL!=null)
                    {
                        var replyObj={
                            Reply:req.body,
                            Ref:Refs[clientTopic]
                        };

                        console.log("Reply to sender .... "+JSON.stringify(replyObj));

                        var optionsX = {url: URL, method: "POST", json: replyObj};
                        httpReq(optionsX, function (errorX, responseX, dataX) {

                            if(errorX)
                            {
                                console.log("ERROR sending request "+errorX);
                                jsonString = messageFormatter.FormatMessage(errorX, 'ERROR sending request', false, undefined);
                                res.end(jsonString);
                            }
                            else if (!errorX && responseX != undefined ) {

                                console.log("Sent "+req.body+" To "+URL);
                                jsonString = messageFormatter.FormatMessage(errorX, 'Successfully Send', true, undefined);
                                res.end(jsonString);

                            }
                            else
                            {
                                console.log("No Result");
                                jsonString = messageFormatter.FormatMessage(undefined, 'ERROR sending request', false, undefined);
                                res.end(jsonString);
                            }
                        });
                    }
                    else
                    {
                        console.log("Invalid Callback URL found "+resURL);
                        jsonString = messageFormatter.FormatMessage(undefined, 'Invalid Callback URL found', false, resURL);
                        res.end(jsonString);
                    }


                }
            }
        });

    }catch(ex){
        jsonString = messageFormatter.FormatMessage(ex, 'Error Occurred in Notification Reply', false, undefined);
        res.end(jsonString);
    }

});

RestServer.post('/DVP/API/:version/NotificationService/Notification/initiate/:room',authorization({resource:"notification", action:"write"}),function(req,res,next)
{
    console.log(req.params.room);
    if(!req.user.company || !req.user.tenant)
    {
        throw new Error("Invalid company or tenant");
    }

    var Company=req.user.company;
    var Tenant=req.user.tenant;
    var eventName=req.headers.eventname;
    var sender = req.body.From;


    var msgObj={
        "Tenant":Tenant,
        "Company":Company,
        "Message":req.body.message,
        "eventName":eventName,
        "roomName":req.params.room,
        "From":sender
    };

    var uniqueRoomName = util.format('%d:%d:subscribe:%s', Tenant, Company, req.params.room);

    io.to(uniqueRoomName).emit('room:event', msgObj);

    res.end();

    return next();

});

RestServer.post('/DVP/API/:version/NotificationService/Notification/Continue/:Topic',authorization({resource:"notification", action:"write"}),function(req,res,next)
{
    var Obj = req.body;
    var message= Obj.Message;
    var topicKey = req.params.Topic;
    var Persistency = req.body.Persistency;

    if(!req.user.company || !req.user.tenant)
    {
        throw new Error("Invalid company or tenant");
    }

    var Company=req.user.company;
    var Tenant=req.user.tenant;
    var compInfo = Tenant + ':' + Company;



    redisManager.TopicObjectPicker(topicKey,TTL, function (e,r) {

        if(e)
        {
            console.log(e);
            res.end();
        }
        else
        {
            if(r==null || r=="")
            {
                console.log("Invalid or Expired Token given, Please try from initial step");
                res.end("Invalid key");
            }
            else
            {
                // console.log("Got token Data "+r);
                redisManager.CheckClientAvailability(r.Client, function (errAvbl,resAvbl) {

                    console.log("Checking result "+resAvbl);

                    if(resAvbl && Persistency)
                    {
                        console.log("Client is not available.......................");
                        if(errAvbl)
                        {
                            console.log("Error in Checking Availability ",errAvbl);

                        }

                        if(inboxMode)
                        {
                            DBController.InboxMessageSender(req, function (errInbox,resInbox) {
                                if(errInbox)
                                {
                                    console.log("Error in Message Saving ",errInbox);
                                    res.end();
                                }
                                else
                                {
                                    console.log("Message saving succeeded ",resInbox);
                                    res.end("Message saved to related client's inbox");
                                }
                            });
                        }
                        else
                        {

                            DBController.PersistenceMessageRecorder(req, function (errSave, resSave) {

                                if (errSave) {
                                    console.log("Error in Message Saving ", errSave);
                                    res.end();
                                }
                                else {
                                    console.log("Message saving succeeded ", resSave);
                                    res.end();
                                }
                            });
                        }
                    }
                    else
                    {

                        io.to(r.Client).emit('message',msgObj);
                        res.end();

                        //if(Clients[r.Client])
                        //{
                        //    var socket= Clients[r.Client];
                        //    var msgObj={
                        //
                        //        "Message":message,
                        //        "TopicKey":topicKey
                        //    };
                        //    socket.emit('message',msgObj);
                        //    res.end(r.Client);
                        //}
                        //else
                        //{
                        //    redisManager.GetClientsServer(r.Client, function (errGet,resGet) {
                        //
                        //        if(errGet)
                        //        {
                        //            console.log("error in getting client server");
                        //            console.log("Destination user not found");
                        //            res.status(400);
                        //            res.end("No user found "+r.Client);
                        //        }
                        //        else
                        //        {
                        //            console.log("SERVER "+resGet);
                        //            console.log("My ID "+MyID);
                        //            DBController.ServerPicker(resGet, function (errPick,resPick) {
                        //
                        //                if(errPick)
                        //                {
                        //                    console.log("error in Picking server from DB");
                        //                    console.log("Destination user not found");
                        //                    console.log("error "+errPick);
                        //                    res.status(400);
                        //                    res.end("No user found "+clientID);
                        //                }
                        //                else
                        //                {
                        //                    var ServerIP = resPick.URL;
                        //                    console.log(ServerIP);
                        //
                        //
                        //                    var httpUrl = util.format('http://%s/DVP/API/%s/NotificationService/Notification/Continue/'+req.params.Topic, ServerIP, version);
                        //                    var options = {
                        //                        url : httpUrl,
                        //                        method : 'POST',
                        //                        json : req.body,
                        //                        headers:{
                        //                            'eventName':req.headers.eventname,
                        //                            'eventUuid':req.headers.eventuuid,
                        //                            'authorization':"bearer "+token,
                        //                            'companyinfo': compInfo
                        //
                        //                        }
                        //
                        //                    };
                        //
                        //                    console.log(options);
                        //                    try
                        //                    {
                        //                        httpReq(options, function (error, response, body)
                        //                        {
                        //                            console.log("error "+error);
                        //                            console.log("response "+response.statusCode);
                        //                            if (!error && response.statusCode == 200)
                        //                            {
                        //                                console.log("no errrs");
                        //                                res.end();
                        //                            }
                        //                            else
                        //                            {
                        //                                console.log("errrs  "+error);
                        //                                res.end();
                        //                            }
                        //                        });
                        //                    }
                        //                    catch(ex)
                        //                    {
                        //                        console.log("ex..."+ex);
                        //                        res.end();
                        //                    }
                        //
                        //                }
                        //            });
                        //        }
                        //    });
                        //}
                    }


                });


            }

        }

    });


    return next();
});

RestServer.post('/DVP/API/:version/NotificationService/Notification/DisconnectSession/:Topic',authorization({resource:"notification", action:"write"}),function(req,res,next)
{
    var topicKey = req.params.Topic;
    if(!req.user.company || !req.user.tenant)
    {
        throw new Error("Invalid company or tenant");
    }

    var Company=req.user.company;
    var Tenant=req.user.tenant;
    var compInfo = Tenant + ':' + Company;

    redisManager.TopicObjectPicker(topicKey,TTL, function (errTopic,resTopic) {

        if(errTopic)
        {
            console.log(errTopic);
            res.end();
        }
        else
        {
            if(resTopic=="" || resTopic==null)
            {
                console.log("Invalid or Expired Session");
                res.end();
            }
            else
            {
                if(Clients[resTopic.Client])
                {
                    redisManager.SessionRemover(topicKey, function (errRem,resRem) {
                        if(errRem)
                        {
                            console.log(errRem);
                            res.end();
                        }
                        else
                        {
                            if(resRem==null || !resRem || resRem=="")
                            {

                                console.log("Invalid or Expired Session ");
                                res.end();
                            }
                            else
                            {
                                console.log(resRem);
                                console.log("Session Removed Successfully");
                                res.end();
                            }

                        }
                    });
                }
                else
                {
                    redisManager.GetClientsServer(resTopic.Client, function (errGet,resGet) {

                        if(errGet)
                        {
                            console.log("error in getting client server");
                            console.log("Destination user not found");
                            res.status(400);
                            res.end("No user found "+resTopic.Client);
                        }
                        else
                        {
                            console.log("SERVER "+resGet);
                            console.log("My ID "+MyID);
                            DBController.ServerPicker(resGet, function (errPick,resPick) {

                                if(errPick)
                                {
                                    console.log("error in Picking server from DB");
                                    console.log("Destination user not found");
                                    console.log("error "+errPick);
                                    res.status(400);
                                    res.end("No user found "+clientID);
                                }
                                else
                                {
                                    var ServerIP = resPick.URL;
                                    console.log(ServerIP);

                                    var httpUrl = util.format('http://%s/DVP/API/%s/NotificationService/Notification/DisconnectSession/'+resTopic.Client, ServerIP, version);
                                    var options = {
                                        url : httpUrl,
                                        method : 'POST',
                                        json : req.body,
                                        headers:{
                                            'eventName':req.headers.eventname,
                                            'eventUuid':req.headers.eventuuid,
                                            'authorization':"bearer "+token,
                                            'topic':topicKey,
                                            'companyInfo':compInfo
                                        }

                                    };

                                    console.log(options);
                                    try
                                    {
                                        httpReq(options, function (error, response, body)
                                        {
                                            if (!error && response.statusCode == 200)
                                            {
                                                console.log("no errrs");
                                                res.end();
                                            }
                                            else
                                            {
                                                console.log("errrs  "+error);
                                                res.end();
                                            }
                                        });
                                    }
                                    catch(ex)
                                    {
                                        console.log("ex..."+ex);
                                        res.end();
                                    }

                                }
                            });
                        }
                    });
                }
            }
        }
    });
    return next();
});

RestServer.get('/DVP/API/:version/NotificationService/Notification/Server/:id/Availability',authorization({resource:"notification", action:"read"}),function(req,res,next)
{
    if(!req.user.company || !req.user.tenant)
    {
        throw new Error("Invalid company or tenant");
    }

    var Company=req.user.company;
    var Tenant=req.user.tenant;

    res.status(200);
    res.end(true);

    return next();
});

RestServer.post('/DVP/API/:version/NotificationService/Notification/Broadcast',authorization({resource:"notification", action:"write"}),function(req,res,next)
{

    console.log("hit broadcast");
    if(!req.user.company || !req.user.tenant)
    {
        throw new Error("Invalid company or tenant");
    }

    var Company=req.user.company;
    var Tenant=req.user.tenant;
    var compInfo = Tenant + ':' + Company;

    if(req.body.clients)
    {
        BroadcastMessageHandler(req.body,compInfo, function (error,processStatus)
        {
            res.end(JSON.stringify(processStatus));
        });
    }
    else
    {
        res.end("Empty client lit received ");

    }

    return next();
});

RestServer.post('/DVP/API/:version/NotificationService/Notification/Broadcast/:userName',authorization({resource:"notification", action:"write"}),function(req,res,next)
{
    if(!req.user.company || !req.user.tenant)
    {
        throw new Error("Invalid company or tenant");
    }

    var Company=req.user.company;
    var Tenant=req.user.tenant;

    var user = req.params.userName;
    var userData = req.body;

    var BcMsgObj={

                "Message":userData.Message
            };

    io.to(user).emit('broadcast',BcMsgObj);

    res.end();

    //if(Clients[user])
    //{
    //    var socket=Clients[user];
    //    var BcMsgObj={
    //
    //        "Message":userData.Message
    //    };
    //    socket.emit('broadcast',BcMsgObj);
    //    res.end();
    //    //callback(undefined,user);
    //
    //}
    //else
    //{
    //    console.log("Not in clientList "+clientData);
    //    userData.To=user;
    //    if(inboxMode)
    //    {
    //        DBController.InboxMessageSender(req, function (errInbox,resInbox) {
    //            if(errInbox)
    //            {
    //                console.log("Error in Message Saving ",errInbox);
    //                res.end();
    //            }
    //            else
    //            {
    //                console.log("Message saving succeeded ",resInbox);
    //                res.end("Message saved to related client's inbox");
    //            }
    //        });
    //    }
    //    else
    //    {
    //
    //        DBController.PersistenceGroupMessageRecorder(userData, function (errSave, resSave) {
    //            if (errSave) {
    //                //callback(errSave,undefined);
    //                console.log("DB error " + errSave);
    //                res.end();
    //            }
    //            else {
    //                //callback(undefined,resSave);
    //                console.log("DB kk " + resSave);
    //                res.end(resSave);
    //            }
    //
    //        });
    //    }
    //}
});

RestServer.post('/DVP/API/:version/NotificationService/Notification/Subscribe/:username',authorization({resource:"notification", action:"write"}),function(req,res,next)
{
    if(!req.user.company || !req.user.tenant)
    {
        throw new Error("Invalid company or tenant");
    }

    var Company=req.user.company;
    var Tenant=req.user.tenant;

    var userID= req.params.username;
    console.log(req.body.querykey);

    redisManager.QuerySubscriberRecorder(req.body.querykey,userID, function (errSubs,resSubs) {


        if(errSubs)
        {
            console.log("Subcriber record saving error "+errSubs);
            res.end();
        }

        else
        {

            console.log("Successfully subscribed User "+userID);
            res.end();

        }

    });

    return next();
});

RestServer.post('/DVP/API/:version/NotificationService/Notification/Unsubscribe/:username',authorization({resource:"notification", action:"write"}),function(req,res,next)
{
    if(!req.user.company || !req.user.tenant)
    {
        throw new Error("Invalid company or tenant");
    }

    var Company=req.user.company;
    var Tenant=req.user.tenant;

    var userID= req.params.username;
    console.log(req.body.querykey);

    redisManager.QueryUnsubscriber(req.body.querykey,userID, function (errSubs,resSubs) {


        if(errSubs)
        {
            console.log("Unsubcriber record saving error "+errSubs);
            res.end();
        }

        else if(!resSubs)
        {

            console.log("No sunscribed user found "+userID);
            res.end();

        }
        else
        {
            console.log("Successfully unubscribed user: "+userID+" from Query : "+req.body.querykey);
            res.end();

        }

    });

    return next();
});

RestServer.post('/DVP/API/:version/NotificationService/Notification/Publish',authorization({resource:"notification", action:"write"}), function (req,res,next)
{
    console.log("Hit");
    var subscriberArray=[];
    var eventName=req.headers.eventname;
    var eventUuid=req.headers.eventuuid;

    var parellalErrors=[];
    var parellalResults=[];

    try
    {
        if(!req.user.company || !req.user.tenant)
        {
            throw new Error("Invalid company or tenant");
        }

        var Company=req.user.company;
        var Tenant=req.user.tenant;
        var compInfo = Tenant + ':' + Company;

        var queryKey = req.body.querykey;
        var msgObj = req.body.message;

        if(queryKey)
        {
            redisManager.QueryKeySubscriberPicker(queryKey, function (errSubscribers,resSubscribers)
            {
                if(errSubscribers)
                {
                    console.log(errSubscribers);
                    res.end();
                }
                else
                {
                    if(resSubscribers.length==0)
                    {
                        console.log("No Subscribers found");
                        res.end();
                    }
                    else
                    {
                        resSubscribers.forEach(function (clientID) {

                            io.to(clientID).emit(eventName,msgObj);

                            //subscriberArray.push(function createContact(callback)
                            //{
                            //
                            //    redisManager.LocationListPicker(clientID, function (errList,resList)
                            //    {
                            //
                            //        if(resList.length>0)
                            //        {
                            //            if(resList.indexOf(MyID)!=-1 && resList.length==1)
                            //            {
                            //                if(Clients[clientID])
                            //                {
                            //                    var instanceArray = Clients[clientID];
                            //                    for(var i=0;i<instanceArray.length;i++)
                            //                    {
                            //                        var instanceSocket = instanceArray[i];
                            //
                            //                        console.log("Publish : Event Name : "+eventName);
                            //                        console.log("Publish : Event Message : "+msgObj);
                            //
                            //                        instanceSocket.emit(eventName,msgObj);
                            //
                            //                        parellalResults.push("Only registered users in this servers : success");
                            //
                            //                        if(i==instanceArray.length-1)
                            //                        {
                            //                            callback(parellalErrors,parellalResults);
                            //
                            //                        }
                            //
                            //                    }
                            //                }
                            //                else
                            //                {
                            //                    parellalErrors.push("Unregisterd user : "+clientID);
                            //                    if(i==instanceArray.length-1)
                            //                    {
                            //                        callback(parellalErrors,parellalResults);
                            //                    }
                            //                }
                            //            }
                            //            else if(resList.indexOf(MyID)!=-1 && resList.length>1)
                            //            {
                            //                for(var i=0;i<resList.length;i++)
                            //                {
                            //                    if(resList[i]!==MyID)
                            //                    {
                            //                        DBController.ClientServerPicker(resList[i],i, function (errServ,resServ,index) {
                            //                            if(errServ)
                            //                            {
                            //                                console.log("Error in Server picking "+errServ);
                            //                                parellalErrors.push("Error in Server picking "+errServ);
                            //                                if(index==resList.length-1)
                            //                                {
                            //
                            //                                    callback(parellalErrors,parellalResults);
                            //
                            //                                }
                            //                            }
                            //                            else if(!resServ)
                            //                            {
                            //                                console.log("No server found ");
                            //                                parellalErrors.push("No server found ");
                            //                                if(index==resList.length-1)
                            //                                {
                            //
                            //                                    callback(parellalErrors,parellalResults);
                            //                                }
                            //                            }
                            //                            else
                            //                            {
                            //                                var ServerIP = resServ.URL;
                            //                                console.log(ServerIP);
                            //                                req.body.To=clientID;
                            //
                            //
                            //                                var httpUrl = util.format('http://%s/DVP/API/%s/NotificationService/Notification/publish/fromRemoteserver', ServerIP, version);
                            //                                console.log("URL "+httpUrl);
                            //                                var options = {
                            //                                    url : httpUrl,
                            //                                    method : 'POST',
                            //                                    json : req.body,
                            //                                    headers:{
                            //                                        'eventName':eventName,
                            //                                        'eventUuid':eventUuid,
                            //                                        'authorization':"bearer "+token,
                            //                                        'topic':eventUuid,
                            //                                        'companyInfo':compInfo
                            //
                            //                                    }
                            //
                            //                                };
                            //
                            //
                            //                                httpReq(options, function (error, response, body)
                            //                                {
                            //                                    console.log("Error "+error);
                            //                                    console.log("response "+response);
                            //
                            //                                    if (!error && response.statusCode == 200)
                            //                                    {
                            //                                        parellalResults.push("Requested to remote servers Succeess");
                            //                                        if(index= resList.length)
                            //                                        {
                            //                                            callback(parellalErrors,parellalResults);
                            //
                            //                                        }
                            //                                        //console.log(JSON.stringify(response));
                            //
                            //                                    }
                            //                                    else
                            //                                    {
                            //                                        console.log("errors  "+error);
                            //                                        parellalErrors.push("Error found pushing to remote servers "+error);
                            //                                        if(index==resList.length-1)
                            //                                        {
                            //                                            callback(parellalErrors,parellalResults);
                            //
                            //                                        }
                            //
                            //                                    }
                            //
                            //                                });
                            //                            }
                            //
                            //                        });
                            //                    }
                            //                    else
                            //                    {
                            //                        if(Clients[clientID])
                            //                        {
                            //                            var instanceArray = Clients[clientID];
                            //                            for(var j=0;j<instanceArray.length;j++)
                            //                            {
                            //                                var instanceSocket = instanceArray[j];
                            //
                            //                                console.log("Publish : Event Name : "+eventName);
                            //                                console.log("Publish : Event Message : "+msgObj);
                            //                                instanceSocket.emit(eventName,msgObj);
                            //
                            //                            }
                            //                            parellalResults.push("Pushed to Clients of this server "+clientID);
                            //                            if(i==resList.length-1)
                            //                            {
                            //                                callback(parellalErrors,parellalResults);
                            //                            }
                            //                        }
                            //                    }
                            //
                            //
                            //                }
                            //            }
                            //            else
                            //            {
                            //                for(var i=0;i<resList.length;i++)
                            //                {
                            //                    DBController.ClientServerPicker(resList[i],i, function (errServ,resServ,index) {
                            //                        if(errServ)
                            //                        {
                            //                            console.log("Error in Server picking "+errServ);
                            //                            parellalErrors.push("Error found pushing to remote servers "+error);
                            //                            if(index==resList.length-1)
                            //                            {
                            //                                callback(parellalErrors,parellalResults);
                            //                            }
                            //                        }
                            //                        else if(!resServ)
                            //                        {
                            //                            parellalErrors.push("No remote servers found "+resList[i]);
                            //                            if(index==resList.length-1)
                            //                            {
                            //                                callback(parellalErrors,parellalResults);
                            //                            }
                            //                        }
                            //                        else
                            //                        {
                            //                            var ServerIP = resServ.URL;
                            //                            console.log(ServerIP);
                            //                            req.body.To=clientID;
                            //
                            //
                            //                            var httpUrl = util.format('http://%s/DVP/API/%s/NotificationService/Notification/publish/fromRemoteserver', ServerIP, version);
                            //                            console.log("URL "+httpUrl);
                            //                            var options = {
                            //                                url : httpUrl,
                            //                                method : 'POST',
                            //                                json : req.body,
                            //                                headers:{
                            //                                    'eventName':eventName,
                            //                                    'eventUuid':eventUuid,
                            //                                    'authorization':"bearer "+token,
                            //                                    'topic':eventUuid,
                            //                                    'companyInfo':compInfo
                            //                                }
                            //
                            //                            };
                            //
                            //
                            //                            httpReq(options, function (error, response, body)
                            //                            {
                            //                                console.log("Error "+error);
                            //                                console.log("response "+response);
                            //
                            //                                if (!error && response.statusCode == 200)
                            //                                {
                            //                                    parellalResults.push("Pushed to remote server Success : "+ServerIP);
                            //                                    if(index= resList.length)
                            //                                    {
                            //                                        callback(parellalErrors,parellalResults);
                            //                                    }
                            //                                    //console.log(JSON.stringify(response));
                            //
                            //                                }
                            //                                else
                            //                                {
                            //                                    parellalErrors.push("Remote server pushing error "+error);
                            //                                    if(index==resList.length-1)
                            //                                    {
                            //                                        callback(parellalErrors,parellalResults);
                            //                                    }
                            //
                            //                                }
                            //
                            //                            });
                            //                        }
                            //
                            //                    });
                            //                }
                            //            }
                            //
                            //        }
                            //        else
                            //        {
                            //            parellalErrors.push("No servers found");
                            //            callback(parellalErrors,parellalResults);
                            //        }
                            //
                            //    });
                            //
                            //
                            //});
                        });
                        //async.parallel(subscriberArray, function (errBulkSend,resSend) {
                        //
                        //    console.log("Sending to Remote servers Errors: "+errBulkSend);
                        //    res.end();
                        //
                        //});
                    }
                }
            });
            res.end();
        }
        else
        {
            console.log("No Query key found");
            res.end();
        }

    }
    catch (e)
    {
        console.log(e);
        res.end();
    }
    return next();

});

RestServer.post('/DVP/API/:version/NotificationService/Notification/Publish/:username',authorization({resource:"notification", action:"write"}), function (req,res,next)
{

    console.log("HIT publish");
    if(!req.user.company || !req.user.tenant)
    {
        throw new Error("Invalid company or tenant");
    }

    var Company=req.user.company;
    var Tenant=req.user.tenant;

    var clientID=req.params.username;

    io.to(clientID).emit('publish',req.body);

    res.end();

    //if(Clients[clientID])
    //{
    //    console.log(clientID+" in");
    //    var socket=Clients[clientID];
    //    socket.emit('publish',req.body);
    //    res.end("Success");
    //}
    //else {
    //    if (inboxMode) {
    //        DBController.InboxMessageSender(req, function (errInbox, resInbox) {
    //            if (errInbox) {
    //                console.log("Error in Message Saving ", errInbox);
    //                res.end();
    //            }
    //            else {
    //                console.log("Message saving succeeded ", resInbox);
    //                res.end("Message saved to related client's inbox");
    //            }
    //        });
    //    }
    //    else
    //    {
    //        DBController.PersistencePubSubMessageRecorder(req.body, clientID, function (errSave, resSave) {
    //            if (errSave) {
    //                console.log("Error Save " + errSave);
    //                res.end();
    //            }
    //            else {
    //                console.log("Success ");
    //                res.end();
    //            }
    //        });
    //    }
    //}



    return next();
});

RestServer.post('/DVP/API/:version/NotificationService/Notification/test', function (req,res,next)
{

    redisManager.SubsQueryUserAvailabitityChecker("Query:select * agents:1:3:name-saman-age-10","client1", function (e,r) {

        if(e)
        {
            console.log(e);
            res.end("error");
        }
        else
        {
            res.end("success");
        }
    })

});

RestServer.post('/DVP/API/:version/NotificationService/Notification/GCMRegistration',authorization({resource:"notification", action:"write"}), function (req,res,next)
{


    var AppKey=req.headers.appkey;
    var username = req.user.iss;
    var Company=req.user.company;
    var Tenant=req.user.tenant;


    DBController.GCMRegistrator(username,AppKey,res);

    return next();

});

RestServer.post('/DVP/API/:version/NotificationService/Notification/GCM/Unregister',authorization({resource:"notification", action:"write"}), function (req,res,next)
{


    var AppKey=req.body.appkey;
    var username = req.user.iss;
    var Company=req.user.company;
    var Tenant=req.user.tenant;


    DBController.GCMKeyRemover(username,AppKey,res);


    return next();

});

RestServer.post('/DVP/API/:version/NotificationService/Notification/publish/fromRemoteserver',authorization({resource:"notification", action:"write"}), function (req,res,next)
{


    var clientID= req.body.To;
    console.log(clientID);
    var eventName=req.headers.eventname;
    var eventUuid=req.headers.eventuuid;


    if(Clients[clientID])
    {
        var insArray =Clients[clientID];
        for(var i=0;i<insArray.length;i++)
        {
            var instanceSocket = insArray[i];
            instanceSocket.emit(eventName,req.body.message);

            if(i==insArray.length-1)
            {
                res.end();
            }
        }
    }
    else
    {
        console.log("Client "+clientID+" is not registed in this server");
    }

});

RestServer.post('/DVP/API/:version/NotificationService/TestMessage',authorization({resource:"notification", action:"write"}), function (req,res,next)
{

    DBController.InboxMessageSender(req, function (err,response) {
        if(err)
        {
            console.log("Error "+err);
            res.end();
        }
        else
        {
            console.log("Response "+response);
            res.end();
        }


    });

    return next();
});

RestServer.post('/DVP/API/:version/NotificationService/Notice',authorization({resource:"notice", action:"write"}),function(req,res,next)
{

    console.log("Notice service started");
    if(!req.user.company || !req.user.tenant)
    {
        throw new Error("Invalid company or tenant");
    }

    var Company=req.user.company;
    var Tenant=req.user.tenant;


    if(req.body)
    {
        HandleNoticeMessage(req,Company,Tenant, function (error,processStatus)
        {
            res.end(JSON.stringify(processStatus));
        });
    }
    else
    {
        res.end("Empty client list received ");

    }

    return next();
});

RestServer.post('/DVP/API/:version/NotificationService/Notice/:userName',authorization({resource:"notice", action:"write"}),function(req,res,next)
{
    if(!req.user.company || !req.user.tenant)
    {
        throw new Error("Invalid company or tenant");
    }

    var Company=req.user.company;
    var Tenant=req.user.tenant;

    var user = req.params.userName;
    var userData = req.body;


    var BcMsgObj={

        from:req.user.iss,
        title:userData.title,
        message:userData.message,
        attachments:userData.attachments,
        priority:userData.priority,
        company:userData,
        tenant:userData
    };
    io.to(user).emit('notice',BcMsgObj);
    res.end();

    //if(Clients[user])
    //{
    //    var socket=Clients[user];
    //    var BcMsgObj={
    //
    //        from:req.user.iss,
    //        title:userData.title,
    //        message:userData.message,
    //        attachments:userData.attachments,
    //        priority:userData.priority,
    //        company:userData,
    //        tenant:userData
    //    };
    //    socket.emit('notice',BcMsgObj);
    //    res.end();
    //    //callback(undefined,user);
    //
    //}
    //else
    //{
    //    res.end("User not in the list");
    //}



});

RestServer.get('/DVP/API/:version/NotificationService/NoticeBoard',authorization({resource:"notice", action:"read"}),function(req,res,next)
{
    var reqId= uuid.v1();

    console.log("Notice picking service started");
    if(!req.user.company || !req.user.tenant)
    {
        throw new Error("Invalid company or tenant");
    }

    var Company=req.user.company;
    var Tenant=req.user.tenant;

    GetStoredNotices(req,Company,Tenant, function (err,response) {

        if(err)
        {
            logger.error('[DVP-NotificationService.GetStoredNotices] - [%s] - Error occurred on method GetStoredNotices',reqId, err);
            var jsonString = messageFormatter.FormatMessage(err, "EXCEPTION", false, undefined);
            logger.debug('[DVP-APPRegistry.GetStoredNotices] - [%s] - Request response : %s ', reqId, jsonString);
            res.end(jsonString);
        }else
        {

            var jsonString = messageFormatter.FormatMessage(undefined, "SUCCESS", true, response);
            logger.debug('[DVP-APPRegistry.GetStoredNotices] - [%s] - Request response : %s ', reqId, jsonString);
            res.end(jsonString);
        }
    });



    return next();
});

RestServer.get('/DVP/API/:version/NotificationService/SubmittedNotices',authorization({resource:"notice", action:"read"}),function(req,res,next)
{
    var reqId= uuid.v1();

    console.log("Sent Notices searching service started");
    if(!req.user.company || !req.user.tenant)
    {
        throw new Error("Invalid company or tenant");
    }

    var Company=req.user.company;
    var Tenant=req.user.tenant;

    GetSubmitedNotices(req,Company,Tenant, function (err,response) {

        if(err)
        {
            logger.error('[DVP-NotificationService.GetSubmitedNotices] - [%s] - Error occurred on method GetSubmitedNotices',reqId, err);
            var jsonString = messageFormatter.FormatMessage(err, "EXCEPTION", false, undefined);
            logger.debug('[DVP-APPRegistry.GetSubmitedNotices] - [%s] - Request response : %s ', reqId, jsonString);
            res.end(jsonString);
        }else
        {

            var jsonString = messageFormatter.FormatMessage(undefined, "SUCCESS", true, response);
            logger.debug('[DVP-APPRegistry.GetSubmitedNotices] - [%s] - Request response : %s ', reqId, jsonString);
            res.end(jsonString);
        }
    });



    return next();
});

RestServer.del('/DVP/API/:version/NotificationService/Notice/:id',authorization({resource:"notice", action:"read"}),function(req,res,next)
{
    var reqId= uuid.v1();

    console.log("Notice removing service started");
    if(!req.user.company || !req.user.tenant)
    {
        throw new Error("Invalid company or tenant");
    }

    var Company=req.user.company;
    var Tenant=req.user.tenant;

    RemoveNotice(req,Company,Tenant, function (err,response) {

        if(err)
        {
            logger.error('[DVP-NotificationService.RemoveNotice] - [%s] - Error occurred on method RemoveNotice',reqId, err);
            var jsonString = messageFormatter.FormatMessage(err, "EXCEPTION", false, undefined);
            logger.debug('[DVP-APPRegistry.RemoveNotice] - [%s] - Request response : %s ', reqId, jsonString);
            res.end(jsonString);
        }else
        {

            var jsonString = messageFormatter.FormatMessage(undefined, "SUCCESS", true, response);
            logger.debug('[DVP-APPRegistry.RemoveNotice] - [%s] - Request response : %s ', reqId, jsonString);
            res.end(jsonString);
        }
    });



    return next();
});

RestServer.del('/DVP/API/:version/NotificationService/Notifications',authorization({resource:"notice", action:"read"}),function(req,res,next)
{
    var reqId= uuid.v1();

    console.log("Notice removing service started");
    if(!req.user.company || !req.user.tenant)
    {
        throw new Error("Invalid company or tenant");
    }

    var Company=req.user.company;
    var Tenant=req.user.tenant;


    RemoveNotice(req,Company,Tenant, function (err,response) {

        if(err)
        {
            logger.error('[DVP-NotificationService.RemoveNotice] - [%s] - Error occurred on method RemoveNotice',reqId, err);
            var jsonString = messageFormatter.FormatMessage(err, "EXCEPTION", false, undefined);
            logger.debug('[DVP-APPRegistry.RemoveNotice] - [%s] - Request response : %s ', reqId, jsonString);
            res.end(jsonString);
        }else
        {

            var jsonString = messageFormatter.FormatMessage(undefined, "SUCCESS", true, response);
            logger.debug('[DVP-APPRegistry.RemoveNotice] - [%s] - Request response : %s ', reqId, jsonString);
            res.end(jsonString);
        }
    });



    return next();
});

RestServer.get('/DVP/API/:version/NotificationService/PersistenceMessages',authorization({resource:"notification", action:"read"}),function(req,res,next)
{
    var reqId= uuid.v1();

    console.log("Loading PersistenceMessages");
    if(!req.user.company || !req.user.tenant)
    {
        throw new Error("Invalid company or tenant");
    }

    var Company=req.user.company;
    var Tenant=req.user.tenant;

    DBController.GetPersistenceMessages(req.user.iss,Company,Tenant, function (err,response) {

        if(err)
        {
            logger.error('[DVP-NotificationService.GetPersistenceMessages] - [%s] - Error occurred on method QueuedMessagesPicker',reqId, err);
            var jsonString = messageFormatter.FormatMessage(err, "EXCEPTION", false, undefined);
            logger.debug('[DVP-APPRegistry.GetPersistenceMessages] - [%s] - Request response : %s ', reqId, jsonString);
            res.end(jsonString);
        }else
        {

            var jsonString = messageFormatter.FormatMessage(undefined, "SUCCESS", true, response);
            logger.debug('[DVP-APPRegistry.GetPersistenceMessages] - [%s] - Request response : %s ', reqId, jsonString);
            res.end(jsonString);
        }
    });



    return next();
});

RestServer.del('/DVP/API/:version/NotificationService/PersistenceMessage/:id',authorization({resource:"notification", action:"read"}),function(req,res,next)
{
    var reqId= uuid.v1();


    if(!req.user.company || !req.user.tenant)
    {
        throw new Error("Invalid company or tenant");
    }

    var Company=req.user.company;
    var Tenant=req.user.tenant;

    DBController.PersistenceMessageRemover(req.params.id,Company,Tenant, function (err,response) {

        if(err)
        {
            logger.error('[DVP-NotificationService.PersistenceMessageRemover] - [%s] - Error occurred on method PersistenceMessageRemover',reqId, err);
            var jsonString = messageFormatter.FormatMessage(err, "EXCEPTION", false, undefined);
            logger.debug('[DVP-APPRegistry.PersistenceMessageRemover] - [%s] - Request response : %s ', reqId, jsonString);
            res.end(jsonString);
        }else
        {

            var jsonString = messageFormatter.FormatMessage(undefined, "SUCCESS", true, response);
            logger.debug('[DVP-APPRegistry.PersistenceMessageRemover] - [%s] - Request response : %s ', reqId, jsonString);
            res.end(jsonString);
        }
    });



    return next();
});
RestServer.del('/DVP/API/:version/NotificationService/PersistenceMessages',authorization({resource:"notification", action:"read"}),function(req,res,next)
{
    var reqId= uuid.v1();


    if(!req.user.company || !req.user.tenant)
    {
        throw new Error("Invalid company or tenant");
    }

    var Company=req.user.company;
    var Tenant=req.user.tenant;

    DBController.RemoveAllPersistenceMessages(req.user.iss,Company,Tenant, function (err,response) {

        if(err)
        {
            logger.error('[DVP-NotificationService.RemoveAllPersistenceMessages] - [%s] - Error occurred on method RemoveAllPersistenceMessages',reqId, err);
            var jsonString = messageFormatter.FormatMessage(err, "EXCEPTION", false, undefined);
            logger.debug('[DVP-APPRegistry.RemoveAllPersistenceMessages] - [%s] - Request response : %s ', reqId, jsonString);
            res.end(jsonString);
        }else
        {

            var jsonString = messageFormatter.FormatMessage(undefined, "SUCCESS", true, response);
            logger.debug('[DVP-APPRegistry.RemoveAllPersistenceMessages] - [%s] - Request response : %s ', reqId, jsonString);
            res.end(jsonString);
        }
    });



    return next();
});


TopicIdGenerator = function ()
{

    var topicID=uuid.v1();
    console.log("Token Key generated "+topicID);
    return topicID;


};

QueuedInitiateMessageSender = function (messageObj,socketObj,callback) {

    try {
        var clientID = messageObj.To;
        var Persistency = true;
        var callbackObj = JSON.parse(messageObj.Callback);
        var Timeout = callbackObj.Timeout;
        var Direction = callbackObj.Direction;
        var Message = callbackObj.Message;
        var Ref = callbackObj.Ref;
        var callbackURL = "";
        var From = messageObj.From;
        var socket;



        if (!isNaN(Timeout))
        {
            TTL = Timeout;
            console.log("TTL found " + TTL);
        }
        console.log(clientID);
        //
        //if (Clients[clientID])
        //{
        //    socket=socketObj;
            console.log("Destination available");

            var topicID = TopicIdGenerator();
            var direction = Direction;
            callbackURL = "";
            var message = Message;
            var ref = Ref;
            var eventName=callbackObj.eventName;
            var eventUuid=callbackObj.eventUuid;


            Refs[topicID] = ref;

            if (direction == "STATEFUL") {
                callbackURL = callbackObj.CallbackURL;
            }
            var sender = From;


            redisManager.TokenObjectCreator(topicID, clientID, direction, sender, callbackURL, TTL, function (errTobj, resTobj) {
                if (errTobj) {
                    console.log("Error in TokenObject creation " + errTobj);
                    //res.end("Error in TokenObject creation "+errTobj);
                    callback(errTobj, undefined);
                }
                else
                {
                    var msgObj={

                        "Message":message,
                        "TopicKey":topicID,
                        "eventName":eventName,
                        "eventUuid":eventUuid

                    };
                    GooglePushMessageSender(clientID,msgObj, function (errGnotf,resGnotf) {
                        if(errGnotf)
                        {
                            console.log("Error in Google notifications:  "+errGnotf);
                        }
                        else
                        {
                            console.log("Success. Google notifications sent:  "+resGnotf);
                        }

                    });

                    if(eventName=="agent_connected")
                    {
                        io.to(clientID).emit('agent_connected',msgObj);
                        console.log("Event notification sent : "+JSON.stringify(msgObj));
                    }
                    else if(eventName=="agent_disconnected")
                    {
                        io.to(clientID).emit('agent_disconnected',msgObj);
                        console.log("Event notification sent : "+JSON.stringify(msgObj));
                    }
                    else if(eventName=="agent_found") {
                        io.to(clientID).emit('agent_found',msgObj);
                        console.log("Event notification sent : "+JSON.stringify(msgObj));
                    }
                    else if(eventName=="agent_rejected")
                    {
                        io.to(clientID).emit('agent_rejected',msgObj);
                        console.log("Event notification sent : "+JSON.stringify(msgObj));
                    }
                    else
                    {
                        io.to(clientID).emit('message',msgObj);
                        console.log("Message sent : "+JSON.stringify(msgObj));
                    }

                    callback(undefined,topicID);



                }
            });





        //}
        //else
        //{
        //    console.log("Invalid destination")
        //}




    } catch (e) {
        callback(e,undefined);
    }

};

QueuedContinueMessageSender = function (messageObj,socketObj,callback) {


    try
    {
        var callbackObj = JSON.parse(messageObj);
        var message = callbackObj.Message;
        var topicKey = callbackObj.Topic;
        var eventName=callbackObj.eventName;
        var eventUuid=callbackObj.eventUuid;


        redisManager.TopicObjectPicker(topicKey, TTL, function (e, r) {

            if (e)
            {
                console.log(e);
                callback(e, undefined);
            }
            else
            {
                if (r == null || r == "")
                {
                    console.log("Invalid or Expired Token given, Please try from initial step");
                    callback(new Error("Invalid Topic"), undefined);
                }
                else {

                    if(Clients[r.Client])
                    {
                        socket=socketObj;
                        console.log("Destination available");

                        var msgObj={

                            "Message":message,
                            "TopicKey":topicKey,
                            "eventName":eventName,
                            "eventUuid":eventUuid

                        };
                        if(eventName=="agent_connected")
                        {
                            socket.emit('agent_connected',msgObj);
                            console.log("Event notification sent : "+JSON.stringify(msgObj));
                        }
                        else if(eventName=="agent_disconnected")
                        {
                            socket.emit('agent_disconnected',msgObj);
                            console.log("Event notification sent : "+JSON.stringify(msgObj));
                        }
                        else if(eventName=="agent_found") {
                            socket.emit('agent_found',msgObj);
                            console.log("Event notification sent : "+JSON.stringify(msgObj));
                        }
                        else if(eventName=="agent_rejected")
                        {
                            socket.emit('agent_rejected',msgObj);
                            console.log("Event notification sent : "+JSON.stringify(msgObj));
                        }
                        else
                        {
                            socket.emit('message',msgObj);
                            console.log("Message sent : "+JSON.stringify(msgObj));
                        }

                        callback(undefined,"Success");
                    }
                    else
                    {
                        callback(new Error("No Instance found"),undefined);
                    }


                }

            }

        });
    }
    catch (e)
    {
        callback(e,undefined);
    }

};

/*QueuedMessagesPicker = function (clientID,company,tenant,callback) {

    DbConn.PersistenceMessages.find({where:{To:clientID}}).then(function (resMessages)
    {
        callback(undefined,resMessages);

    }).catch(function (errMessages)
    {
        callback(errMessages,undefined);
    });

};*/

/*QueuedMessageOperator = function (msgObj,socketObj) {

    try {
        var topicKey = JSON.parse(msgObj.Callback).Topic;
        var MessageType = JSON.parse(msgObj.Callback).MessageType;
        var msgReciever = msgObj.To;
        var msgID = msgObj.id;

        if (!topicKey)
        {
            if (MessageType == "GENERAL")
            {
                QueuedInitiateMessageSender(msgObj,socketObj, function (errInitiate, resInitiate) {
                    if (errInitiate) {
                        console.log("Error in Queued Message Sending " + errInitiate);
                    }
                    else {
                        DBController.PersistenceMessageRemover(msgID, function (errRem, resRem) {
                            if (errRem) {
                                console.log("Error in Removing Queued Message data : " + msgReciever, errRem);
                            }
                            else {
                                console.log("Queued message Sent and Removed from Queue : " + msgReciever);
                            }
                        });
                    }
                });
            }
            else
            {
                if(MessageType=="BROADCAST")
                {
                    QueuedBroadcastMessageSender(msgObj, function (errBcSend, resBcSend) {

                        if (errBcSend)
                        {
                            console.log("Error in Queued Broadcast Message sending Client :  "+ msgReciever+" Error:"+ errBcSend);
                        }
                        else
                        {
                            DBController.PersistenceMessageRemover(msgID, function (errRem, resRem) {
                                if (errRem)
                                {
                                    console.log("Error in Removing Queued Message To : " + msgReciever+" Error :"+errRem);
                                }
                                else
                                {
                                    console.log("Queued message Sent and Removed from Queue : " + msgReciever);
                                }
                            });
                        }

                    });
                }
                else
                {
                    QueuedPubSubMessageSender(msgObj, function (errPubSubSend,resPubSubSend) {

                        if(errPubSubSend)
                        {
                            console.log("Error in sending Queued Subscribe Messages to Client : "+msgReciever+" Error: "+errPubSubSend);
                        }
                        else
                        {
                            DBController.PersistenceMessageRemover(msgID, function (errRem, resRem) {
                                if (errRem)
                                {
                                    console.log("Error in Removing Queued Message To Client : " + msgReciever+"Error : "+ errRem);
                                }
                                else {
                                    console.log("Queued message Sent and Removed from Queue : " + msgReciever);
                                }
                            });
                        }

                    })
                }

            }

        }
        else
        {
            console.log("Continues Messages");

            QueuedContinueMessageSender(msgObj.Callback,socketObj, function (errConMsg, resConMsg) {

                if (errConMsg)
                {
                    console.log("Error in Sending Continues Messages ", errConMsg);
                }
                else
                {
                    console.log("Continue messages sent successfully ");
                    DBController.PersistenceMessageRemover(msgID, function (errRem, resRem) {
                        if (errRem)
                        {
                            console.log("Error in Removing Queued Message data : " + msgReciever, errRem);
                        }
                        else
                        {
                            console.log("Queued message Sent and Removed from Queue : " + msgReciever);
                        }
                    });
                }

            });
        }
    } catch (e) {
        callback(e,undefined);
    }


};*/

BroadcastMessageHandler = function (messageData,compInfo,callbackResult) {

    var broadcastArray=[];
    var processData=[];

    var clientArray=messageData.clients;


    clientArray.forEach(function (clientData) {


        console.log(clientData);
        var BcMsgObj = {

            "Message": messageData.Message,
            "From":messageData.From
        };
        io.to(clientData).emit('broadcast', BcMsgObj);

        //
        //
        //broadcastArray.push(function createContact(callback)
        //{
        //    redisManager.GetClientsServer(clientData, function (errServer, resServer) {
        //
        //        if (errServer)
        //        {
        //            console.log("Error in server searching for client " + clientData,errServer);
        //            var processStatus =
        //            {
        //                clientStatus:clientData+" : failed"
        //            }
        //            processData.push(processStatus);
        //            callback(null,processData);
        //        }
        //        else
        //        {
        //
        //            var serverData=[];
        //            resServer.forEach(function (serverItem) {
        //
        //
        //                console.log("Server " + resServer + " found for client " + clientData);
        //
        //                console.log("Client " + clientData + " is a registered client");
        //
        //
        //                serverData.push(function createContact(serverCallback)
        //                {
        //
        //
        //
        //
        //                    var BcMsgObj = {
        //
        //                        "Message": messageData.Message,
        //                        "From":messageData.From
        //                    };
        //                    io.to(clientID).emit('broadcast', BcMsgObj);
        //
        //
        //                    console.log("Server id of client "+serverItem);
        //
        //                    if (MyID == serverItem)     {
        //
        //                        console.log("My Client "+clientData);
        //                        if (Clients[clientData])
        //                        {
        //
        //                            var instanceArray = Clients[clientData];
        //
        //                            console.log("My instances "+clientData+":"+instanceArray.length);
        //                            var instanceData=[];
        //                            instanceArray.forEach(function (clientInstance)
        //                            {
        //                                instanceData.push(function createContact(instanceCallback)
        //                                {
        //                                    var socket=clientInstance;
        //                                    console.log("My socket "+clientData);
        //
        //                                    var BcMsgObj = {
        //
        //                                        "Message": messageData.Message,
        //                                        "From":messageData.From
        //                                    };
        //                                    socket.emit('broadcast', BcMsgObj);
        //                                    var processStatus =
        //                                    {
        //                                        clientStatus:clientData+" : success"
        //                                    };
        //                                    processData.push(processStatus);
        //                                    instanceCallback(null,processData);
        //                                });
        //
        //
        //                            });
        //
        //                            async.parallel(instanceData, function (processStatus) {
        //
        //                                console.log("instance sending ends here for "+clientData);
        //                                serverCallback(null,processStatus);
        //
        //
        //                            });
        //
        //
        //                        }
        //                        else
        //                        {
        //                            //record in DB
        //                            console.log("Requested client recorded in this server but not in clientList " + clientData);
        //                            var processStatus =
        //                            {
        //                                clientStatus:clientData+" : failed"
        //                            }
        //                            processData.push(processStatus);
        //                            serverCallback(null,processData);
        //
        //                        }
        //                    }
        //                    else
        //                    {
        //                        console.log("SERVER " + resServer);
        //                        console.log("My ID " + MyID);
        //
        //                        console.log("Client " + clientData + " is not a registered client in this server, serching in other servers");
        //                        DBController.ServerPicker(resServer, function (errSvrPick, resSvrPick) {
        //
        //                            if (errSvrPick) {
        //                                console.log("error in Picking server from DB");
        //                                console.log("Destination user not found");
        //                                console.log("error " + errSvrPick);
        //
        //                                var processStatus =
        //                                {
        //                                    clientStatus:clientData+" : failed"
        //                                }
        //
        //                                processData.push(processStatus);
        //                                serverCallback(null,processData);
        //
        //                            }
        //                            else {
        //                                var ServerIP = resSvrPick.URL;
        //                                console.log(ServerIP);
        //                                var httpUrl = util.format('http://%s/DVP/API/%s/NotificationService/Notification/Broadcast/' + clientData, ServerIP, version);
        //                                var options = {
        //                                    url: httpUrl,
        //                                    method: 'POST',
        //                                    json: messageData,
        //                                    headers:{
        //                                        'authorization':"bearer "+token,
        //                                        'companyInfo':compInfo
        //                                    }
        //
        //
        //                                };
        //
        //                                console.log(options);
        //                                try
        //                                {
        //                                    httpReq(options, function (error, response, body) {
        //                                        if (!error && response.statusCode == 200) {
        //                                            console.log("no errrs in request 200 ok");
        //                                            var processStatus =
        //                                            {
        //                                                clientStatus:clientData+" : success"
        //                                            }
        //
        //                                            processData.push(processStatus);
        //                                            serverCallback(null,processData);
        //
        //                                        }
        //                                        else {
        //                                            console.log("error in request  " + error);
        //                                            var processStatus =
        //                                            {
        //                                                clientStatus:clientData+" : falied"
        //                                            }
        //                                            processData.push(processStatus);
        //                                            serverCallback(null,processData);
        //
        //                                        }
        //                                    });
        //                                }
        //                                catch (ex) {
        //                                    console.log("exception" + ex);
        //                                    var processStatus =
        //                                    {
        //                                        clientStatus:clientData+" : falied"
        //                                    }
        //                                    processData.push(processStatus);
        //                                    serverCallback(null,processData);
        //
        //
        //                                }
        //
        //                            }
        //                        });
        //                    }
        //
        //                });
        //            });
        //
        //            async.parallel(serverData, function (processStatus) {
        //
        //                console.log("Server data ends here");
        //                callback(null,processStatus);
        //
        //
        //            });
        //
        //
        //        }
        //
        //
        //
        //    });
        //
        //});
    });

    callbackResult(null,processData);

    //async.parallel(broadcastArray, function (processStatus) {
    //
    //    console.log("Users ends here");
    //    callbackResult(null,processData);
    //
    //
    //});


};

QueuedBroadcastMessageSender = function (msgObj,callabck) {

    try {
        console.log("Ypoooooo " + JSON.stringify(msgObj));
        var user = msgObj.To;
        var userData = msgObj;
        var userMessage = JSON.parse(userData.Callback).Message;


        var BcMsgObj = {

            "Message": userMessage
        };
        io.to(user).emit('broadcast', BcMsgObj);

        callabck(undefined, "Success");

        //if (Clients[user]) {
        //    var socket = Clients[user];
        //    var BcMsgObj = {
        //
        //        "Message": userMessage
        //    };
        //    socket.emit('broadcast', BcMsgObj);
        //    callabck(undefined, "Success");
        //    //callback(undefined,user);
        //
        //}
        //else {
        //    console.log("Not in clientList " + clientData);
        //    callback(new Error("Invalid Client " + user), undefined);
        //
        //}
    } catch (e) {
        callback(e,undefined);
    }

};

QueuedPubSubMessageSender = function (msgObj,callabck) {

    try {
        console.log("Ypoooooo " + JSON.stringify(msgObj));
        var user = msgObj.To;
        var userData = msgObj;
        var userMessage = JSON.parse(userData.Callback).Message;


        var BcMsgObj = {

            "Message": userMessage
        };
        io.to(user).emit('publish', BcMsgObj);
        callabck(undefined, "Success");

        //if (Clients[user]) {
        //    var socket = Clients[user];
        //    var BcMsgObj = {
        //
        //        "Message": userMessage
        //    };
        //    io.to(user).emit('publish', BcMsgObj);
        //    callabck(undefined, "Success");
        //    //callback(undefined,user);
        //
        //}
        //else {
        //    console.log("Not in clientList " + clientData);
        //    callback(new Error("Invalid Client " + user), undefined);
        //
        //}
    } catch (e) {
        callback(e,undefined);
    }

};

SubscribeDataRecorder = function (dataObj,userId) {



};

PublishToUser = function (clientID,msgObj,compInfo,callback) {


    io.to(clientID).emit('publish', msgObj);
    callback(undefined, 200);

    //try {
    //    redisManager.GetClientsServer(clientID, function (errServer, resServer) {
    //        if (errServer) {
    //            DBController.PersistencePubSubMessageRecorder(msgObj,clientID, function (errSave,resSave) {
    //                if(errSave)
    //                {
    //                    callback(errSave, undefined);
    //                }
    //                else
    //                {
    //                    callback(undefined,resSave);
    //                }
    //            });
    //        }
    //        else {
    //            console.log("Server " + resServer + " found for client " + clientID);
    //
    //            if (MyID == resServer) {
    //                if (Clients[clientID]) {
    //                    var socket = Clients[clientID];
    //                    socket.emit('publish', msgObj);
    //                    callback(undefined, clientID);
    //                }
    //                else {
    //                    console.log("Offline user");
    //
    //                    DBController.PersistencePubSubMessageRecorder(msgObj,clientID, function (errSave,resSave) {
    //                        if(errSave)
    //                        {
    //                            callback(errSave, undefined);
    //                        }
    //                        else
    //                        {
    //                            callback(undefined,resSave);
    //                        }
    //                    });
    //
    //                }
    //
    //            }
    //            else {
    //                DBController.ServerPicker(resServer, function (errSvrPick, resSvrPick) {
    //                    if (errSvrPick) {
    //                        callback(errSvrPick, undefined);
    //                    }
    //                    else {
    //                        var ServerIP = resSvrPick.URL;
    //                        console.log(ServerIP);
    //                        var httpUrl = util.format('http://%s/DVP/API/%s/NotificationService/Notification/Publish/' + clientID, ServerIP, version);
    //                        var options = {
    //                            url: httpUrl,
    //                            method: 'POST',
    //                            json: msgObj,
    //                            headers:{
    //                                'eventName':eventName,
    //                                'eventUuid':eventUuid,
    //                                'authorization':"bearer "+token,
    //                                'companyInfo':compInfo
    //                            }
    //
    //                        };
    //
    //                        console.log(options);
    //                        try {
    //                            httpReq(options, function (error, response, body) {
    //                                if (!error && response.statusCode == 200) {
    //                                    console.log("no errrs in request 200 ok");
    //                                    callback(undefined, response.statusCode);
    //
    //                                }
    //                                else {
    //                                    console.log("errrs in request  " + error);
    //                                    callback(error, undefined);
    //
    //                                }
    //                            });
    //                        }
    //                        catch (ex) {
    //                            console.log("ex..." + ex);
    //                            callback(ex, undefined);
    //
    //                        }
    //
    //                    }
    //                });
    //            }
    //
    //        }
    //    });
    //} catch (e) {
    //    callback(e,undefined);
    //}

};

InitiateSubscriber = function (clientID,msgObj,callback) {


    redisManager.IsRegisteredClient(clientID, function (errReg,status,resReg) {

        if(errReg)
        {
            console.log("Error in client registration checking "+errReg);
            callback(errReg,undefined);
        }
        else
        {
            if(resReg && status)
            {
                var key = "Query:" + uuid.v1();

                redisManager.QuerySubscriberRecorder(key,clientID, function (errSubs,resSubs) {

                    if(errSubs)
                    {
                        console.log("Subcriber record saving error "+errSubs);
                        callback(errSubs,undefined);
                    }
                    else
                    {
                        if(!resSubs)
                        {
                            console.log("Unable to save subs record");
                            callback(new Error("Invalid Data"),undefined)
                        }
                        else
                        {
                            msgObj.RefId=key;
                            var ServerIP="127.0.0.1:8050";
                            var httpUrl = util.format('http://%s/DVP/API/%s/CEP/ActivateQuery', ServerIP, version);
                            // msgObj.callbackURL=util.format('http://%s/DVP/API/%s/NotificationService/Notification/Publish', ServerIP, version);
                            var options = {
                                url : httpUrl,
                                method : 'POST',
                                json : msgObj,
                                headers:{
                                    'eventName':eventName,
                                    'eventUuid':eventUuid,
                                    'authorization':"bearer "+token,
                                }

                            };

                            console.log(options);
                            try
                            {
                                httpReq(options, function (error, response, body)
                                {
                                    if (!error && response.statusCode == 200)
                                    {
                                        console.log("no errrs in request 200 ok");
                                        //callback(undefined,response.statusCode);
                                        callback(undefined,key);

                                    }
                                    else
                                    {
                                        console.log("errrs in request  "+error);
                                        callback(error,undefined);
                                        //callback(error,undefined);

                                    }
                                });
                            }
                            catch(ex)
                            {
                                console.log("ex..."+ex);
                                callback(ex,undefined);
                                //callback(ex,undefined);

                            }


                        }
                    }
                });
            }
            else
            {
                console.log("Client ID  not found  "+clientID);
                callback(new Error("Invalid ClientID"),undefined);
            }
        }
    });
};

GooglePushMessageSender = function (clientId,msgObj,callback) {


    DBController.GoogleNotificationKeyPicker(clientId, function (errKey,resKey) {

        if(errKey)
        {
            callback(new Error(errKey),undefined);
        }
        else
        {
            if(resKey)
            {
                console.log("type: "+typeof (resKey));
                var message = new gcm.Message({data:msgObj});


                message.addNotification('title', msgObj.eventName);
                message.addNotification('icon', 'ic_launcher');

                console.log("Recepients "+resKey);
                console.log("Message "+JSON.stringify(message));
                Sender.send(message, { registrationTokens: resKey }, function (err, response) {


                    console.log(err);
                    console.log(response);
                    callback(err,response);
                });
            }
            else
            {
                callback(undefined,"done");
            }


        }
    });
    //



};

ClientServerPicker = function (clientArray,messageData,callback) {
    var serverResponse=[];
    var processData=[];

    clientArray.forEach(function (clientData)
    {
        serverResponse.push(function createContact(serverCallback)
        {
            redisManager.GetClientsServer(clientData, function (errServer, resServer) {
                if(errServer)
                {
                    console.log("Error in server searching for client " + clientData,errServer);
                    var processStatus =
                    {
                        clientStatus:clientData+" : failed"
                    }
                    processData.push(processStatus);
                    serverCallback(processData);
                }
                else
                {
                    if(resServer.length==1 && resServer.indexOf(MyID)!=-1)
                    {
                        InstanceMessageHandler(clientData,Clients[clientData],messageData, function (instanceCallback) {
                            serverCallback(instanceCallback);
                        });
                    }
                    else if(resServer.length>1 && resServer.indexOf(MyID)!=-1)
                    {

                    }


                }
            });
        });
    });


};

InstanceMessageHandler = function (clientData,instanceArray,messageData,callback) {

    var instanceResponse=[];
    var processData=[];

    instanceArray.forEach(function (instanceItem) {

        instanceResponse.push(function createContact(Instancecallback)
        {
            var socket =instanceItem;
            var BcMsgObj = {

                "Message": messageData.Message
            };
            socket.emit('broadcast', BcMsgObj);
            var processStatus =
            {
                clientStatus:clientData+" : success"
            }
            processData.push(processStatus);

        });
    });

    async.parallel(instanceResponse, function (processStatus)
    {
        callback(processStatus);
    });
};

HandleNoticeMessage = function (req,company,tenant,callbackResult) {

    var broadcastArray=[];
    var processData=[];
    var userListArray=[];
    var compInfo = tenant + ':' + company;
    var clientArray=[];
    var groupList=[];
    var messageData=req.body;
    var fromUser;

console.log("Requested user "+req.user.iss);
    User.findOne({company:company,tenant:tenant,username:req.user.iss,Active:true}, function (err,owner) {

        if(err)
        {
            var processStatus =
            {
                Owner:"Error in searching owner"
            }
            callbackResult(null,processStatus);
        }
        else
        {
            if(owner)
            {
                fromUser=owner.id;

                userListArray.push(function createContact(listCallBack) {

                    if(messageData.toUser && messageData.toUser.length>0)
                    {
                        //clientArray=messageData.toUser;
                        var clientObj =
                        {
                            company:company,
                            tenant:tenant,
                            $or:[]
                        }

                        messageData.toUser.map(function (user) {

                            clientObj.$or.push({username:user});

                        });

                        try
                        {
                            User.find(clientObj,'_id username', function (err,users) {

                                if(err)
                                {
                                    console.log("Error in searching users");
                                    listCallBack(new Error("Error in searching users"),false);
                                }
                                else
                                {
                                    if(users)
                                    {
                                        console.log("Users found");
                                        users.map(function (user) {

                                            clientArray.push(user);
                                        });
                                        listCallBack(undefined,true);
                                    }
                                    else
                                    {
                                        console.log("No users found");
                                        listCallBack(new Error("No users found"),false);
                                    }
                                }
                            });
                        }
                        catch(ex)
                        {
                            console.log(ex);
                        }




                    }
                    else if(messageData.toGroup && messageData.toGroup.length>0)
                    {


                        var grpObj =
                        {
                            company:company,
                            tenant:tenant,
                            $or:[]
                        }

                        messageData.toGroup.map(function (group) {

                            grpObj.$or.push({name:group});

                        });

                        UserGroup.find(grpObj,'_id', function (err,groups) {

                            if(err)
                            {
                                console.log("Error in searching groups");
                                listCallBack(new Error("Error in searching groups"),false);
                            }
                            else
                            {
                                if(groups)
                                {

                                    var groupObj={
                                        company:company,
                                        tenant:tenant,
                                        Active:true,
                                        $or:[]

                                    }

                                    groups.map(function (item) {
                                        groupList.push(item);
                                        groupObj.$or.push({group:new ObjectId(item).path});
                                        console.log(JSON.stringify(new ObjectId(item)));
                                    });

                                    User.find(groupObj,'_id username', function (err,Users) {

                                        if(err)
                                        {
                                            console.log("Error in serching group users");
                                            listCallBack(new Error("Error in serching group users"),false);


                                        }
                                        else
                                        {
                                            if(Users)
                                            {
                                                console.log("group users found");

                                                Users.map(function (user) {
                                                    clientArray.push(user)
                                                });
                                                listCallBack(undefined,true);
                                            }
                                            else
                                            {
                                                console.log("No group users found");
                                                listCallBack(new Error("No group users found"),false);

                                            }

                                        }
                                    });



                                }
                                else
                                {
                                    console.log("No Group found");
                                    listCallBack(new Error("No Group found"),false);

                                }
                            }
                        });


                    }
                    else
                    {
                        console.log("No user or group data");

                        listCallBack(new Error("No user or group data"),false);
                    }
                });
                async.parallel(userListArray, function (processStatus) {


                    if(clientArray && clientArray.length>0)
                    {
                        var NoticeObj = {
                            from:fromUser,
                            title:messageData.title,
                            message:messageData.message,
                            attachments:messageData.attachments,
                            priority:messageData.priority,
                            company:company,
                            tenant:tenant,
                            toUser:null,
                            toGroup:null

                        }
                        if(messageData.toUser)
                        {
                            console.log("User list attached");
                            NoticeObj.toUser=clientArray.map(function (user) {
                                return user._id;
                            });
                        }
                        if(messageData.toGroup)
                        {
                            console.log("group list attached");
                            NoticeObj.toGroup=groupList;
                        }

                        var notice = Notice(NoticeObj);
                        notice.save(function (err,notice) {

                            if(err)
                            {
                                console.log("Error in saving notice data");
                                var processStatus =
                                {
                                    NoticeStatus:"Notice saving failed"
                                }
                                callbackResult(null,processStatus);
                            }
                            else
                            {
                                if(notice)
                                {
                                    console.log("Notice saved");
                                    clientArray.forEach(function (clientDetails) {

                                        var BcMsgObj = {

                                            from:req.user.iss,
                                            title:messageData.title,
                                            message:messageData.message,
                                            message:messageData.message,
                                            attachments:messageData.attachments,
                                            priority:messageData.priority,
                                            company:company,
                                            tenant:tenant

                                        };
                                        io.to(clientDetails.username).emit('notice', BcMsgObj);
                                        //callback(null,processData);

                                        //broadcastArray.push(function createContact(callback)
                                        //{
                                        //    var clientData = clientDetails.username;
                                        //
                                        //    redisManager.GetClientsServer(clientData, function (errServer, resServer) {
                                        //
                                        //        if (errServer)
                                        //        {
                                        //            console.log("Error in server searching for client " + clientData,errServer);
                                        //            var processStatus =
                                        //            {
                                        //                clientStatus:clientData+" : failed"
                                        //            }
                                        //            processData.push(processStatus);
                                        //            callback(null,processData);
                                        //        }
                                        //        else
                                        //        {
                                        //
                                        //            var serverData=[];
                                        //            resServer.forEach(function (serverItem) {
                                        //
                                        //
                                        //                console.log("Server " + resServer + " found for client " + clientData);
                                        //
                                        //                console.log("Client " + clientData + " is a registered client");
                                        //
                                        //
                                        //                serverData.push(function createContact(serverCallback)
                                        //                {
                                        //                    console.log("Server id of client "+serverItem);
                                        //
                                        //
                                        //                    if (MyID == serverItem)     {
                                        //
                                        //                        console.log("My Client "+clientData);
                                        //                        if (Clients[clientData])
                                        //                        {
                                        //
                                        //                            var instanceArray = Clients[clientData];
                                        //
                                        //                            console.log("My instances "+clientData+":"+instanceArray.length);
                                        //
                                        //                            var instanceData=[];
                                        //                            instanceArray.forEach(function (clientInstance)
                                        //                            {
                                        //                                instanceData.push(function createContact(instanceCallback)
                                        //                                {
                                        //                                    var socket=clientInstance;
                                        //                                    console.log("My socket "+clientData);
                                        //
                                        //                                    var BcMsgObj = {
                                        //
                                        //                                        from:req.user.iss,
                                        //                                        title:messageData.title,
                                        //                                        message:messageData.message,
                                        //                                        attachments:messageData.attachments,
                                        //                                        priority:messageData.priority,
                                        //                                        company:company,
                                        //                                        tenant:tenant
                                        //
                                        //                                    };
                                        //                                    socket.emit('notice', BcMsgObj);
                                        //                                    var processStatus =
                                        //                                    {
                                        //                                        clientStatus:clientData+" : success"
                                        //                                    };
                                        //                                    processData.push(processStatus);
                                        //                                    instanceCallback(null,processData);
                                        //                                });
                                        //
                                        //
                                        //                            });
                                        //
                                        //                            async.parallel(instanceData, function (processStatus) {
                                        //
                                        //                                console.log("instance sending ends here for "+clientData);
                                        //                                serverCallback(null,processStatus);
                                        //
                                        //
                                        //                            });
                                        //
                                        //
                                        //                        }
                                        //                        else
                                        //                        {
                                        //                            //record in DB
                                        //                            console.log("Requested client recorded in this server but not in clientList " + clientData);
                                        //                            var processStatus =
                                        //                            {
                                        //                                clientStatus:clientData+" : failed"
                                        //                            }
                                        //                            processData.push(processStatus);
                                        //                            serverCallback(null,processData);
                                        //
                                        //                        }
                                        //                    }
                                        //                    else
                                        //                    {
                                        //                        console.log("SERVER " + resServer);
                                        //                        console.log("My ID " + MyID);
                                        //
                                        //                        console.log("Client " + clientData + " is not a registered client in this server, serching in other servers");
                                        //                        DBController.ServerPicker(resServer, function (errSvrPick, resSvrPick) {
                                        //
                                        //                            if (errSvrPick) {
                                        //                                console.log("error in Picking server from DB");
                                        //                                console.log("Destination user not found");
                                        //                                console.log("error " + errSvrPick);
                                        //
                                        //                                var processStatus =
                                        //                                {
                                        //                                    clientStatus:clientData+" : failed"
                                        //                                }
                                        //
                                        //                                processData.push(processStatus);
                                        //                                serverCallback(null,processData);
                                        //
                                        //                            }
                                        //                            else {
                                        //                                var ServerIP = resSvrPick.URL;
                                        //                                console.log(ServerIP);
                                        //                                var httpUrl = util.format('http://%s/DVP/API/%s/NotificationService/Notification/Broadcast/' + clientData, ServerIP, version);
                                        //                                var options = {
                                        //                                    url: httpUrl,
                                        //                                    method: 'POST',
                                        //                                    json: messageData,
                                        //                                    headers:{
                                        //                                        'authorization':"bearer "+token,
                                        //                                        'companyInfo':compInfo
                                        //                                    }
                                        //
                                        //
                                        //                                };
                                        //
                                        //                                console.log(options);
                                        //                                try
                                        //                                {
                                        //                                    httpReq(options, function (error, response, body) {
                                        //                                        if (!error && response.statusCode == 200) {
                                        //                                            console.log("no errrs in request 200 ok");
                                        //                                            var processStatus =
                                        //                                            {
                                        //                                                clientStatus:clientData+" : success"
                                        //                                            }
                                        //
                                        //                                            processData.push(processStatus);
                                        //                                            serverCallback(null,processData);
                                        //
                                        //                                        }
                                        //                                        else {
                                        //                                            console.log("error in request  " + error);
                                        //                                            var processStatus =
                                        //                                            {
                                        //                                                clientStatus:clientData+" : falied"
                                        //                                            }
                                        //                                            processData.push(processStatus);
                                        //                                            serverCallback(null,processData);
                                        //
                                        //                                        }
                                        //                                    });
                                        //                                }
                                        //                                catch (ex) {
                                        //                                    console.log("exception" + ex);
                                        //                                    var processStatus =
                                        //                                    {
                                        //                                        clientStatus:clientData+" : falied"
                                        //                                    }
                                        //                                    processData.push(processStatus);
                                        //                                    serverCallback(null,processData);
                                        //
                                        //
                                        //                                }
                                        //
                                        //                            }
                                        //                        });
                                        //                    }
                                        //
                                        //                });
                                        //            });
                                        //
                                        //            async.parallel(serverData, function (processStatus) {
                                        //
                                        //                console.log("Server data ends here");
                                        //                callback(null,processStatus);
                                        //
                                        //
                                        //            });
                                        //
                                        //
                                        //        }
                                        //
                                        //
                                        //
                                        //    });
                                        //
                                        //});
                                    });

                                    callbackResult(null,processStatus);

                                    //async.parallel(broadcastArray, function (processStatus) {
                                    //
                                    //    console.log("Users ends here");
                                    //
                                    //    callbackResult(null,processData);
                                    //
                                    //
                                    //});
                                }
                                else
                                {
                                    console.log("Error in saving notice data");
                                    var processStatus =
                                    {
                                        NoticeStatus:"Notice saving failed"
                                    }
                                    callbackResult(null,processStatus);


                                }

                            }
                        });




                    }
                    else
                    {
                        var processStatus =
                        {
                            ClientsList:"Empty Client List"
                        }
                        callbackResult(null,processStatus);
                    }


                });

            }
            else
            {
                var processStatus =
                {
                    Owner:"Invalid owner"
                }
                callbackResult(null,processStatus);
            }
        }
    });



    //var clientArray=messageData.clients

};

GetStoredNotices = function (req,company,tenant,callbackResult) {

    if(req.user.iss)
    {
        User.findOne({company:company,tenant:tenant,username:req.user.iss,Active:true}, function (err,user) {

            if(err)
            {
                callbackResult(err,undefined);
            }
            else
            {
                if(user)
                {
                    var qObj =
                    {
                        company:company,
                        tenant:tenant,
                        $or:[{toUser:null , toGroup:null},{toUser:{$in:[user.id]}}]


                    }
                    if(user.group)
                    {
                        qObj.$or.push({toGroup:{$in:[user.group]}});

                    }


                    Notice.find(qObj).populate("attachments","url type file").exec(function (errNotices,resNotices) {

                        if(errNotices)
                        {
                            callbackResult(errNotices,undefined);
                        }
                        else
                        {
                            callbackResult(undefined,resNotices);
                        }
                    });

                }
                else
                {
                    callbackResult(new Error("No user found"),undefined);
                }
            }
        });
    }
    else
    {
        callbackResult(new Error("No username found"),undefined);
    }



};

GetPersistenceMessages = function (req,company,tenant,callbackResult) {


    DBController.


        User.findOne({company:company,tenant:tenant,username:req.user.iss,Active:true}, function (err,user) {

            if(err)
            {
                callbackResult(err,undefined);
            }
            else
            {
                if(user)
                {
                    var qObj =
                        {
                            company:company,
                            tenant:tenant,
                            $or:[{toUser:null , toGroup:null},{toUser:{$in:[user.id]}}]


                        }



                    Notice.find(qObj).populate("attachments","url type file").exec(function (errNotices,resNotices) {

                        if(errNotices)
                        {
                            callbackResult(errNotices,undefined);
                        }
                        else
                        {
                            callbackResult(undefined,resNotices);
                        }
                    });

                }
                else
                {
                    callbackResult(new Error("No user found"),undefined);
                }
            }
        });




};


GetSubmitedNotices = function (req,company,tenant,callbackResult) {

    if(req.user.iss)
    {
        User.findOne({company:company,tenant:tenant,username:req.user.iss,Active:true}, function (err,user) {

            if(err)
            {
                callbackResult(err,undefined);
            }
            else
            {
                if(user)
                {
                    var qObj =
                    {
                        company:company,
                        tenant:tenant,
                        from:user.id


                    }

                    Notice.find(qObj).populate("attachments","url").populate("toUser","username").populate("toGroup","name").exec(function (errNotices,resNotices) {

                        if(errNotices)
                        {
                            callbackResult(errNotices,undefined);
                        }
                        else
                        {
                            callbackResult(undefined,resNotices);
                        }
                    });

                }
                else
                {
                    callbackResult(new Error("No user found"),undefined);
                }
            }
        });
    }
    else
    {
        callbackResult(new Error("No username found"),undefined);
    }



};

RemoveNotice = function (req,company,tenant,callbackResult) {

    if(req.user.iss)
    {
        User.findOne({company:company,tenant:tenant,username:req.user.iss,Active:true}, function (err,user) {

            if(err)
            {
                callbackResult(err,undefined);
            }
            else
            {
                if(user)
                {
                    var qObj =
                    {
                        company:company,
                        tenant:tenant,
                        from:user.id,
                        _id:new ObjectId(req.params.id).path


                    }

                    Notice.remove(qObj,function (errNotices,resNotices) {

                        if(errNotices)
                        {
                            callbackResult(errNotices,undefined);
                        }
                        else
                        {
                            callbackResult(undefined,resNotices);
                        }
                    });

                }
                else
                {
                    callbackResult(new Error("No user found"),undefined);
                }
            }
        });
    }
    else
    {
        callbackResult(new Error("No username found"),undefined);
    }



};




function Crossdomain(req,res,next){


    var xml='<?xml version=""1.0""?><!DOCTYPE cross-domain-policy SYSTEM ""http://www.macromedia.com/xml/dtds/cross-domain-policy.dtd""> <cross-domain-policy>    <allow-access-from domain=""*"" />        </cross-domain-policy>';

    req.setEncoding('utf8');
    res.end(xml);

}

function Clientaccesspolicy(req,res,next){


    var xml='<?xml version="1.0" encoding="utf-8" ?>       <access-policy>        <cross-domain-access>        <policy>        <allow-from http-request-headers="*">        <domain uri="*"/>        </allow-from>        <grant-to>        <resource include-subpaths="true" path="/"/>        </grant-to>        </policy>        </cross-domain-access>        </access-policy>';
    req.setEncoding('utf8');
    res.end(xml);

}

function CallCRM(company, tenant, object) {

    //console.log(object);

    console.log(config.Services.crmIntegrationHost);
    console.log(config.Services.crmIntegrationPort);
    console.log(config.Services.crmIntegrationVersion);
    console.log(object);
    console.log(object.action);
    console.log((config.Services && config.Services.crmIntegrationHost && config.Services.crmIntegrationPort &&
    config.Services.crmIntegrationVersion && object && object.action))

    //if((config.Services && config.Services.crmIntegrationHost && config.Services.crmIntegrationPort &&
    //    config.Services.crmIntegrationVersion && object && object.action)) {
    try {

        var zohoserviceURL = util.format("http://%s/DVP/API/%s/Zoho/Integration/Emit", config.Services.crmIntegrationHost,
            config.Services.crmIntegrationVersion);
        if (validator.isIP(config.Services.crmIntegrationHost))
            zohoserviceURL = util.format("http://%s:%s/DVP/API/{2}/Zoho/Integration/Emit",
                config.Services.crmIntegrationHost, config.Services.crmIntegrationPort, config.Services.crmIntegrationVersion, object.action);

        console.log("Calling Zoho service URL " + zohoserviceURL);
        httpReq({
            method: "POST",
            url: zohoserviceURL,
            headers: {
                authorization: "bearer "+token,
                companyinfo: util.format("%s:%s", tenant, company)
            },
            json: object
        }, function (_error, _response, datax) {

            try {



                if (!_error && _response && _response.statusCode == 200, _response.body && _response.body.IsSuccess) {

                    //cb(true,_response.body.Result);
                    logger.info("Event emitted to zoho successfully");
                    console.log(_response.body);

                } else {

                    logger.error("There is an error in emitting events to zoho");
                    // cb(false,{});

                }
            }
            catch (excep) {

                // cb(false,{});
                logger.error("There is an error in emitting events to zoho ", excep);

            }
        });
    } catch (_ex) {
        console.log(_ex);
    }
    // }
}


RestServer.get("/crossdomain.xml",Crossdomain);
RestServer.get("/clientaccesspolicy.xml",Clientaccesspolicy);