"use strict";

class NoopPlugin {
  constructor(serverless) {
    serverless.cli.log("[noop-plugin]");
  }
}

module.exports = NoopPlugin;
