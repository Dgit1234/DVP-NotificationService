module.exports = {
    "DB": {
        "Type":"SYS_DATABASE_TYPE",
        "User":"SYS_DATABASE_POSTGRES_USER",
        "Password":"SYS_DATABASE_POSTGRES_PASSWORD",
        "Port":"SYS_SQL_PORT",
        "Host":"SYS_DATABASE_HOST",
        "Database":"SYS_DATABASE_POSTGRES_USER"
    },


    "Redis":
    {
        "ip": "SYS_REDIS_HOST",
        "port": "SYS_REDIS_PORT",
        "db":"SYS_REDIS_DB"

    },
    "Security":
    {
        "ip": "SYS_REDIS_HOST",
        "port": "SYS_REDIS_PORT",
        "user": "SYS_REDIS_USER",
        "password": "SYS_REDIS_PASSWORD"

    },

    "Host":
    {
        "domain": "HOST_NAME",
        "port": "HOST_NOTIFICATIONSERVICE_PORT",
        "version": "HOST_VERSION",
        "logfilepath": "LOG4JS_CONFIG"
    },
    "Services" : {
        "accessToken": "HOST_TOKEN",
        "crmIntegrationHost": "SYS_CRMINTEGRATION_HOST",
        "crmIntegrationPort": "SYS_CRMINTEGRATION_PORT",
        "crmIntegrationVersion": "SYS_CRMINTEGRATION_VERSION"
    },
    "TTL":
    {
        "ttl":"SYS_TTL"
    },
    "PERSISTENCY":
    {
        "inbox_mode":"SYS_INBOX_MODE"
    },
    "Mongo":
    {
        "ip":"SYS_MONGO_HOST",
        "port":"SYS_MONGO_PORT",
        "dbname":"SYS_MONGO_DB",
        "password":"SYS_MONGO_PASSWORD",
        "user":"SYS_MONGO_USER"
    },
    "ID":"SYS_NS_ID",
    "Token":"HOST_TOKEN"
};

//NODE_CONFIG_DIR
