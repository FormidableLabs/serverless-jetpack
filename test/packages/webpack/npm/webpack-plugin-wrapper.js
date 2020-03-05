"use strict";

// Simple wrapper to runtime swap plugins.
const Webpack = require("serverless-webpack");
const NoopPlugin = require("../../../plugins/noop");

// Noop if using jetpack
module.exports = process.env.MODE !== "baseline" ? NoopPlugin : Webpack;
