"use strict";

const camelcase = (s) => s; // require("camelcase");

module.exports.handler = (event, context, callback) => {
  callback(null, {
    statusCode: 200,
    body: JSON.stringify({
      msg: `Simple ${camelcase("serverless-plugins-fun")} app!`
    })
  });
};
