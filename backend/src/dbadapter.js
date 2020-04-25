const property = require("./property");
const common = require("trash-common");
const AWS = require("aws-sdk");
const documentClient = new AWS.DynamoDB.DocumentClient({ region: process.env.DB_REGION });
const firebase_admin = require("firebase-admin");
firebase_admin.initializeApp({
    credential: firebase_admin.credential.applicationDefault()
});
const firestore = firebase_admin.firestore();
const crypto = require("crypto");

const toHash = (value) => {
    return crypto.createHash("sha512").update(value).digest("hex");
}

const getRefreshToken = async(refresh_token)=> {
    const result = await documentClient.get({
        TableName: property.REFRESH_TABLE,
        Key: {
            refresh_token: toHash(refresh_token)
        }
    }).promise();
    console.debug("Get RefreshToken:" + JSON.stringify(result));
    return result.Item;
}

const putAccessToken = async(user_id,client_id,expires_in)=>{
    let limit = 0;
    while(limit < 5) {
        const accessToken = common.generateRandomCode(20);
        try {
            await documentClient.put({
                TableName: property.TOKEN_TABLE,
                Item: {
                    access_token: toHash(accessToken),
                    expires_in: Math.ceil((Date.now()/1000))+expires_in,
                    user_id: user_id,
                    client_id: client_id
                },
                ConditionExpression: "attribute_not_exists(access_token)"
            }).promise();
            console.debug(`Put AccessToken:${accessToken}`);
            return accessToken;
        } catch(err) {
            console.warn(err);
        }
        limit++;
    }
    throw new Error("Put Access Token Failed.");
}

const putRefreshToken = async(user_id,client_id,expires_in)=>{
    let limit = 0;
    while(limit < 5) {
        const refreshToken = common.generateRandomCode(20);
        try {
            await documentClient.put({
                TableName: property.REFRESH_TABLE,
                Item: {
                    refresh_token: toHash(refreshToken),
                    expires_in: Math.ceil(Date.now()/1000) + expires_in,
                    user_id: user_id,
                    client_id: client_id
                },
                ConditionExpression: "attribute_not_exists(refresh_token)"
            }).promise();
            console.debug(`Put RefreshToken:${refreshToken}`);
            return refreshToken;
        } catch(err) {
            console.warn(err);
        }
        limit++;
    }
    throw new Error("Put Refresh Token Failed.");
}
const saveSession = async (session) => {
    session.expire = Math.ceil(Date.now()/1000) + property.SESSION_MAX_AGE;
    console.debug("save session", session);
    return documentClient.put({
        TableName: property.SESSION_TABLE,
        Item: session
    }).promise().then(() => {
        return true;
    }).catch(err => {
        console.error(err);
        return false;
    });
}

const getDataBySigninId = async(signinId)=>{
    console.debug("get data by signinId:"+signinId);
    return documentClient.query({
        TableName: property.SCHEDULE_TABLE,
        IndexName: "signinId-index",
        ExpressionAttributeNames: { "#i": "signinId" } ,
        ExpressionAttributeValues: { ":val": signinId },
        KeyConditionExpression: "#i = :val"
    }).promise().then((data)=>{
        if(data.Count > 0) {
            console.debug("get data",data.Items[0]);
            return data.Items[0];
        }
        return {};
    }).catch(err=>{
        console.error(err);
        throw new Error("Get Data Failed");
    });
}

const deleteSession = async(sessionId)=>{
    await documentClient.delete({
        TableName: property.SESSION_TABLE,
        Key:{
            id: sessionId
        }
    }).promise();
    return true;
}

const getAuthorizationCode = async(code)=>{
    const result = await documentClient.get({
        TableName: property.AUTHORIZE_TABLE,
        Key: {
            code: code
        }
    }).promise();
    return result.Item;
}

const putAuthorizationCode = async(user_id,client_id,redirect_uri,expires_in)=>{
    let limit = 0;
    while(limit < 5) {
        const codeItem = {
            code: common.generateRandomCode(),
            user_id: user_id,
            client_id: client_id,
            redirect_uri: redirect_uri,
            expires_in: Math.ceil(Date.now() / 1000 + expires_in)
        };
        try {
            await documentClient.put({
                TableName: property.AUTHORIZE_TABLE,
                Item: codeItem,
                ConditionExpression: "attribute_not_exists(code)"
            }).promise();
            return codeItem;
        } catch(err) {
            console.warn(err);
        }
        limit++;
    }
    throw new Error("Put Authorization Code Failed(Over limit)");
}

const putTrashSchedule = async(item, regist_data) =>{
    const params = {
        TableName: property.SCHEDULE_TABLE,
        Item: item
    };
    console.debug("regist parameter:", params);
    await documentClient.put(params).promise();
    console.info(`Regist user(${JSON.stringify(item)})`);

    // Googleアシスタントの登録はfirestore登録後にリダイレクトする
    if (item.platform === "google") {
        console.debug(`regist firestore: ${item.id},${JSON.stringify(regist_data)}`);
        await firestore.collection("schedule").doc(item.id).set({
            data: regist_data
        });
    }
    return true;
}

const publishId = async()=>{
    let user_id = null;
    // 初回登録は最大5回まで重複のないIDの採番を試みる
    let retry = 0;
    while(retry < 5) {
        user_id = common.generateUUID("-");
        try {
            const result = await documentClient.get({
                TableName: property.SCHEDULE_TABLE,
                Key: {
                    id: user_id
                }
            }).promise();
            if(!result.Item) {
                console.debug("generate new id:", user_id);
                return user_id;
            }
            console.warn("duplicate id:",user_id);
            user_id = null;
            retry++;
        } catch(err) {
            console.error(err);
        }
    }
    throw new Error("PublishId Failed(Over limit)");
}

const getSession = async(sessionId) => {
    const params = {
        Key: {
            id: sessionId
        },
        TableName: property.SESSION_TABLE
    }
    return documentClient.get(params).promise().then(async(data)=>{
        return data.Item;
    }).catch(error=>{
        console.error("Failed getSession.");
        console.error(error);
        return null;
    })
}

const publishSession = async()=>{
    const new_session =  {
        id: common.generateRandomCode(20),
        expire: Math.ceil((new Date()).getTime() / 1000) + property.SESSION_MAX_AGE
    }
    console.info("publish new session:",new_session);
    return documentClient.put({
        TableName: property.SESSION_TABLE,
        Item: new_session,
        ConditionExpression: "attribute_not_exists(id)"
    }).promise().then(()=>{
        return new_session;
    }).catch((e)=>{
        console.error("Failed session value.")
        console.error(e.message);
        return null;
    });
};

module.exports = {
    saveSession: saveSession,
    getDataBySigninId: getDataBySigninId,
    deleteSession: deleteSession,
    putTrashSchedule: putTrashSchedule,
    getAuthorizationCode: getAuthorizationCode,
    putAuthorizationCode: putAuthorizationCode,
    publishId: publishId,
    getSession: getSession,
    publishSession: publishSession,
    putAccessToken: putAccessToken,
    putRefreshToken: putRefreshToken,
    getRefreshToken: getRefreshToken
}