"use strict";

// Simple wrapper to runtime swap plugins.
const Jetpack = require("../../index");
const NoopPlugin = require("./noop");

// If we're in `deps` or `trace` mode, then use Jetpack
module.exports = process.env.MODE ? Jetpack : NoopPlugin;
