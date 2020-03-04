"use strict";

// Simple wrapper to runtime swap plugins.
const Jetpack = require("../../index");
const NoopPlugin = require("./noop");

module.exports = process.env.PKG ? Jetpack : NoopPlugin;
