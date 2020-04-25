const db = require("./dbadapter");

const ACCESS_TOKEN_EXPIRE = 7 * 24 * 60 * 60;
const REFRESH_TOKEN_EXPIRE = 30 * 24 * 60 * 60;

module.exports = async (params,authorization) => {
    console.debug(JSON.stringify(params));
    if(!(authorization === "Basic " + Buffer.from(`${process.env.ALEXA_USER_CLIENT_ID}:${process.env.ALEXA_USER_SECRET}`).toString("base64"))){
        return {
            statusCode: 401
        }
    }
    if (params.grant_type === "authorization_code") {
        try {
            const authorizationCode = await db.getAuthorizationCode(params.code);
            if (authorizationCode &&
                params.client_id === authorizationCode.client_id &&
                decodeURIComponent(params.redirect_uri) === authorizationCode.redirect_uri){
                    // アクセストークンの登録
                    const accessToken = db.putAccessToken(authorizationCode.user_id, params.client_id, ACCESS_TOKEN_EXPIRE);

                    // リフレッシュトークンの登録
                    const refreshToken =db.putRefreshToken(authorizationCode.user_id,params.client_id, REFRESH_TOKEN_EXPIRE);

                    const result = await Promise.all([accessToken,refreshToken]);
                    return {
                        statusCode: 200,
                        body: JSON.stringify({
                            access_token: result[0],
                            token_type: "bearer",
                            expires_in: 7 * 24 * 60 * 60,
                            refresh_token: result[1]
                        }),
                        headers: {
                            Pragma: "no-cache",
                            "Content-Type": "application/json;charset UTF-8",
                            "Cache-Control": "no-store"
                        }
                    }
            } else {
                console.error(`Invalid Parameters: db-> ${JSON.stringify(authorizationCode)},params->${JSON.stringify(params)}`);
            }
        } catch(err) {
            console.error(err);
            return {
                statusCode: 500
            }
        }
    } else if(params.grant_type === "refresh_token") {
        try {
            const user_info = await db.getRefreshToken(params.refresh_token);
            if(user_info && user_info.client_id === params.client_id) {
                const access_token = db.putAccessToken(user_info.user_id,params.client_id ,ACCESS_TOKEN_EXPIRE);
                const refresh_token = db.putRefreshToken(user_info.user_id, params.client_id, REFRESH_TOKEN_EXPIRE);
                const result = await Promise.all([access_token,refresh_token]);
                return {
                    statusCode: 200,
                    body: JSON.stringify({
                        access_token: result[0],
                        expires_in: 7 * 24 * 60 * 60,
                        refresh_token: result[1],
                        token_type: "bearer"
                    }),
                    headers: {
                        Pragma: "no-cache",
                        "Content-Type": "application/json;charset UTF-8",
                        "Cache-Control": "no-store"
                    }
                }
            }
        } catch(err) {
            console.error(err);
            return {
                statusCode: 500
            }
        }
    }
    return {
        statusCode: 400
    }
}