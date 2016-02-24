/**
 * Created by Pawan on 10/1/2015.
 */
var redis=require('redis');
var config = require('config');
var port = config.Redis.port || 3000;
var client = redis.createClient(config.Redis.port,config.Redis.ip);
//var io = require('socket.io')(config.Host.port);
client.on("error", function (err) {
    console.log("Error " + err);
});

client.on("connect", function (err) {
    client.select(config.Redis.db, redis.print);
});


SocketObjectManager = function(TopicID,socketID,clientID,direction,From,clbk,state,ttl,callback)
{
    console.log("Redis Callback "+clbk);

    var key ="notification:"+TopicID;

    client.hmset(key,["From",From,"Client",clientID,"Socket",socketID,"Direction",direction,"Callback",clbk,"State",state],function(errHmset,resHmset)
    {
        if(errHmset)
        {
            callback(errHmset,undefined);
        }
        else
        {
            TouchSession(key, ttl);
            callback(undefined,resHmset);
        }
    });


};

SocketFinder = function(TopicID,ttl,callback)
{
    var key ="notification:"+TopicID;

    client.hmget(TopicID,"Client","Socket","Direction","Callback",function(errUser,resUser)
    {
        if(errUser)
        {
            callback(errUser,undefined);
        }
        else
        {
            if(!resUser)
            {
                callback(new Error("No Session Object Found"),undefined);
            }
            else
            {
                TouchSession(key,ttl);
                callback(undefined,resUser);
            }

        }
    });
};

SocketStateChanger = function(TopicID,State,ttl,callback)
{
    var key ="notification:"+TopicID;

    client.hmget(key,"Client","Socket","Direction","Callback",function(errUser,resUser)
    {
        if(errUser)
        {
            callback(errUser,undefined);
        }
        else
        {
            if(!resUser)
            {
                callback(new Error("No Session Object Found"),undefined);
            }
            else
            {
                client.hmset(key,"State",State,function(errSt,resSt)
                {
                    if(errSt)
                    {
                        callback(errSt,undefined);
                    }else
                    {
                        if(!resSt || resSt=="")
                        {
                            callback(new Error("State updation failed "),undefined);
                        }
                        else
                        {
                            TouchSession(key,ttl);
                            callback(undefined,resUser[3]);
                        }

                    }

                });
            }

        }
    });

};

TouchSession =function(TopicID,TTL)
{
    client.expire(TopicID, TTL);
};

SocketObjectUpdater = function(TopicID,SocketID,callback)
{
    console.log("TopicID "+TopicID);
    console.log("SOCKET "+SocketID);

    var key ="notification:"+TopicID;


    SocketFinder(key,1000,function(errObj,resObj)
    {
        if(errObj)
        {
            callback(errObj,undefined);
        }
        else
        {
            if(!resObj)
            {
                callback("NOOBJ",undefined);
            }
            else
            {
                client.hmset(key,"Socket",SocketID,function(errUpdt,resUpdt)
                {
                    if(errUpdt)
                    {
                        callback(errUpdt,undefined);
                    }
                    else
                    {

                        if(resUpdt=="" || !resUpdt)
                        {

                            callback(new Error("Nothing to update"),undefined);
                        }else
                        {
                            callback(undefined,resUpdt);
                        }
                    }
                });
            }

        }

    });


};

TokenObjectCreator = function(topicID,clientID,direction,sender,resURL,ttl,callback)
{
    console.log("Token Object creating");
    var key ="notification:"+topicID;
//notification:topic
    client.hmset(key,["From",sender,"Client",clientID,"Direction",direction,"Callback",resURL],function(errHmset,resHmset)
    {
        if(errHmset)
        {
            callback(errHmset,undefined);
        }
        else
        {
            TouchSession(key, ttl);
            callback(undefined,resHmset);
        }
    });

};

ResourceObjectCreator = function(clientID,TopicID,ttl,callback)
{
    console.log("Token Object creating");
    var objKey="notification:"+clientID+":"+TopicID;

    client.set(objKey,TopicID,function(errSet,resSet)
    {
        if(errSet)
        {
            callback(errSet,undefined);
        }
        else
        {
            if(resSet=="" || !resSet || resSet== "NULL")
            {
                callback(new Error("Invalid key to Update " + objKey),undefined);
            }
            else
            {
                console.log("yap...............................");
                TouchSession(objKey, ttl);
                callback(undefined,resSet);
            }
        }
    });

};

ResourceObjectPicker = function(clientID,topicID,ttl,callback)
{
    console.log("Token Object searching");
    var objKey="notification:"+clientID+":"+topicID;
    var key ="notification:"+topicID;

    client.get(objKey,function(errGet,resGet)
    {
        if(errGet)
        {
            callback(errGet,undefined);
        }
        else
        {
            if(resGet=="" || !resGet || resGet == "NULL")
            {
                callback(new Error("No such key found " + objKey),undefined);
            }

            else
            {
                TouchSession(objKey, ttl);
                //callback(undefined,resGet);
                ResponseUrlPicker(key,ttl,function(errURL,resURL)
                {
                    if(errURL)
                    {
                        console.log("Error in searching ResponceURL "+errURL);
                        callback(errURL,undefined);
                    }
                    else
                    {
                        console.log("Response URL found "+resURL);
                        callback(undefined,resURL);
                    }
                });
            }
        }
    });

};

ResponseUrlPicker = function(topicID,ttl,callback)
{
    console.log("ResponseURL of "+topicID+ "picking ");
    var key ="notification:"+topicID;


    client.hmget(key,"Direction","Callback",function(errGet,resGet)
    {
        if(errGet)
        {
            callback(errGet,undefined);
        }
        else
        {
            if( !resGet )
            {
                callback(new Error("No such key found " + topicID),undefined);
            }
            else if(resGet=="" || resGet == "NULL")
            {
                TouchSession(topicID, ttl);
                callback(undefined,"STATELESS");
            }
            else
            {
                TouchSession(key, ttl);
                callback(undefined,resGet);
            }
        }
    });
};


// sprint DUO V6 Voice UI 2

RecordUserServer = function (clientName,server,callback)
{

    var key="notification:loc:"+clientName+":"+server;//notification:loc....

    client.set(key,server,function(errSet,resSet)
    {
        if(errSet)
        {
            callback(errSet,undefined);
        }
        else
        {
            if(resSet=="" || !resSet || resSet== "NULL")
            {
                callback(new Error("Invalid key to set "),undefined);
            }
            else
            {
                callback(undefined,resSet);
            }
        }
    });
};

GetClientsServer = function (clientName,callback) {

    var key="notification:loc:"+clientName+":*";

    client.keys(key,function(errGet,resGet)
    {
        if(errGet)
        {
            callback(errGet,undefined);
        }
        else
        {
            if(resGet=="" || !resGet || resGet== "NULL")
            {
                callback(new Error("Invalid key to get "),undefined);
            }
            else
            {
                var serverID = resGet.split(" ")[0];

                callback(undefined,serverID);
            }
        }
    });
};

TopicObjectPicker = function (topicId,ttl,callback) {

    TouchSession(topicId,ttl);
    var key = "notification:"+topicId;
    client.hgetall(key, function (errTkn,resTkn) {
        callback(errTkn,resTkn);

    });

};

ClientLocationDataRemover = function (clientID,server,callback) {

    var key = "notification:loc:"+clientID+":"+server;
    client.del(key, function (e,r) {
        callback(e,r);
    })
};

SessionRemover = function (topicKey,callback) {

    var key ="notification:"+topicKey;
    client.del(key, function (e,r) {
        callback(e,r);
    });
};

CheckClientAvailability = function (clientId,callback) {

    var key = "notification:loc:"+clientId+":*";

    console.log(key);
    client.hgetall(key, function (errClient,resClient) {

        if(errClient)
        {
            callback(errClient,false);
        }
        else
        {
            if(!resClient || resClient=="" || resClient == null)
            {
                callback(undefined,true);
            }
            else
            {
                callback(undefined,false);
            }


        }

    });
};

ResetServerData = function (serverID,callback) {

    var key= "notification:loc:*"+serverID;
    client.keys(key, function (errKeys,resKeys) {
        if(errKeys)
        {
            callback(errKeys,undefined);
        }
        else
        {
            if(!resKeys || resKeys=="" || resKeys ==null)
            {
                callback(undefined,"Already Cleared")
            }
            else
            {
                console.log(resKeys);
                var delKeys="";
                /* for(var i=0;i<resKeys.length;i++)
                 {
                 delKeys=delKeys.concat(" ");
                 delKeys=delKeys.concat(resKeys[i]);

                 if(i==resKeys.length-1)
                 {
                 //callback(undefined,delKeys);
                 console.log("HIT");
                 RemoveKeys(delKeys, function (e,r) {
                 callback(e,r);
                 })
                 }
                 }*/

                client.del(resKeys, function (e,r) {
                    callback(e,r);
                })

            }
        }
    });

};

RemoveKeys = function (keys,callback) {

    client.del(keys, function (e,r) {
        callback(e,r);
    });

};

module.exports.SocketObjectManager = SocketObjectManager;
module.exports.SocketFinder = SocketFinder;
module.exports.SocketStateChanger = SocketStateChanger;
module.exports.SocketObjectUpdater = SocketObjectUpdater;
module.exports.TokenObjectCreator = TokenObjectCreator;
module.exports.ResourceObjectCreator = ResourceObjectCreator;
module.exports.ResourceObjectPicker = ResourceObjectPicker;
module.exports.ResponseUrlPicker = ResponseUrlPicker;
module.exports.RecordUserServer = RecordUserServer;
module.exports.GetClientsServer = GetClientsServer;
module.exports.TopicObjectPicker = TopicObjectPicker;
module.exports.ClientLocationDataRemover = ClientLocationDataRemover;
module.exports.SessionRemover = SessionRemover;
module.exports.CheckClientAvailability = CheckClientAvailability;
module.exports.ResetServerData = ResetServerData;

