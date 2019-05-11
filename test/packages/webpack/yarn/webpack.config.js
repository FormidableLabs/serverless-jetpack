"use strict";

const path = require("path");
const slsw = require("serverless-webpack");

module.exports = {
  mode: "development",
  target: "node",
  entry: slsw.lib.entries,
  output: {
    filename: "[name].js",
    libraryTarget: "commonjs2",
    path: path.join(__dirname, ".webpack")
  },
  devtool: false
};
