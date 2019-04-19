"use strict";

// Simple wrapper to runtime swap plugins.
const EchoPlugin = require("./echo");
const NoopPlugin = require("./noop");

module.exports = process.env.PLUGIN === "true" ? EchoPlugin : NoopPlugin;
