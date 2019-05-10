"use strict";

const DEFAULT_PORT = 3000;
const PORT = parseInt(process.env.SERVER_PORT || DEFAULT_PORT, 10);
const HOST = process.env.SERVER_HOST || "0.0.0.0";
const STAGE = process.env.STAGE || "localdev";
const BASE_URL = "/base";
const FULL_BASE_URL = STAGE === "localdev" ? BASE_URL : `/${STAGE}${BASE_URL}`;

module.exports.handler = (event, context, callback) => {
   callback(null, {
    statusCode: 200,
    body: JSON.stringify({
      msg: "Simple reference serverless app!"
    })
  });
};
