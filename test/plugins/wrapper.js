"use strict";

// Simple wrapper to runtime swap plugins.
const PackagerPlugin = require("../../index");
const NoopPlugin = require("./noop");

module.exports = process.env.PLUGIN === "true" ? PackagerPlugin : NoopPlugin;
