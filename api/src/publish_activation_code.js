const AWS = require('aws-sdk');
const property = require("./property.js");
const common = require("trash-common");
const logger = common.getLogger();

const generateActivationCode = async()=>{
   const documentClient = new AWS.DynamoDB .DocumentClient({region: process.env.DB_REGION});
    let limit = 0;
    while(limit < 5) {
        const code = [];
        for(let i=0; i<10; i++) {
            code.push(Math.random()*9|0);
        }
        const activation_code = code.join("");
        const result = await documentClient.get({
            TableName: property.ACTIVATE_TABLE_NAME,
            Key: {
                code: activation_code
            }
        }).promise()
        if(!result.Item) {
            return activation_code;
        }
        limit++;
    }
    throw new Error("Failed generate activation code.")
}
module.exports = async(params)=>{
    logger.debug(JSON.stringify(params));
    const documentClient = new AWS.DynamoDB.DocumentClient({ region: process.env.DB_REGION });

    try {
        const result = await documentClient.get({
            TableName: property.TRASH_SCHEDULE_TABLE_NAME,
            Key: {
                id: params.id
            }
        }).promise();
        logger.debug(`Target Schedule -> ${JSON.stringify(result)} `);
        if (result.Item) {
            const code = await generateActivationCode();
            logger.debug(`Publish Activation Code -> ${code}`);
            //TTLを5分間に設定
            const ttl = Math.ceil(new Date().getTime() / 1000 + (5 * 60));
            await documentClient.put({
                TableName: property.ACTIVATE_TABLE_NAME,
                Item: {
                    code: code,
                    user_id: params.id,
                    TTL: ttl
                }
            }).promise();
            return { statusCode: 200, body: JSON.stringify({ code: code }) };
        } else {
            throw new Error(`ID Not Found: ${params.id}`);
        }
    } catch (err) {
        logger.error(err);
        return { statusCode: 400 }
    }
}