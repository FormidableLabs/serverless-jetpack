"use strict";

class EchoPlugin {
  constructor(serverless, options) {
    // eslint-disable-next-line no-console
    console.log("ECHO: constructor");

    const ALL_HOOKS = Object.keys(serverless.pluginManager.hooks);
    const PKG_HOOKS = ALL_HOOKS.filter((h) => (/(^|\:)package\:/).test(h));

    this.serverless = serverless;
    this.options = options;
    this.hooks = PKG_HOOKS.reduce((m, h) => ({ ...m,
      [h]: this.echo.bind(this, h) }), {});
  }

  echo(msg) {
    // eslint-disable-next-line no-console
    console.log(`ECHO: ${msg}`);
  }
}

module.exports = EchoPlugin;
