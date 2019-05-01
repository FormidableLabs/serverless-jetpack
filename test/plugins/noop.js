"use strict";

class NoopPlugin {
  constructor() {
    // eslint-disable-next-line no-console
    console.log("NOOP: plugin");
  }
}

module.exports = NoopPlugin;
