"use strict";

/* eslint no-magic-numbers: ["error", { "ignore": [0, 1, 2, 3] }]*/

/**
 * Plugin tests.
 */

const mock = require("mock-fs");
const sinon = require("sinon");

const Serverless = require("serverless");
const { getServerlessConfigFile } = require("serverless/lib/utils/getServerlessConfigFile");
const Jetpack = require("../..");

describe("index", () => {
  let sandbox;
  let serverless;

  // [BRITTLE]: Create a mostly-real serverless object for config parsing.
  const createServerless = async () => {
    serverless = new Serverless();
    serverless.processedInput = {
      options: {},
      commands: []
    };
    serverless.cli = {
      log: sandbox.stub()
    };
    await serverless.pluginManager.loadConfigFile();
    await serverless.service.load();

    return serverless;
  };

  beforeEach(() => {
    mock({});
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
    mock.restore();

    // [BRITTLE]: Manually reset the serverless lodash cache.
    getServerlessConfigFile.cache = new Map();
  });

  describe("serverless trace configurations", () => {
    beforeEach(() => {
      sandbox.stub(Jetpack.prototype, "globAndZip").returns(Promise.resolve({
        buildTime: 0
      }));
    });

    it("traces with service config even if non-individually function is false", async () => {
      mock({
        "serverless.yml": `
          service: sls-mocked

          custom:
            jetpack:
              trace: true

          provider:
            name: aws
            runtime: nodejs12.x

          functions:
            one:
              handler: one.handler
            two:
              handler: two.handler
              # Because not individually packaged, trace=false will have no effect.
              jetpack:
                trace: false
        `,
        "one.js": `
          exports.handler = async () => ({
            body: JSON.stringify({ message: "one" })
          });
        `,
        "two.js": `
          exports.handler = async () => ({
            body: JSON.stringify({ message: "two" })
          });
        `
      });

      const plugin = new Jetpack(await createServerless());
      await plugin.package();
      expect(Jetpack.prototype.globAndZip)
        .to.have.callCount(1).and
        .to.be.calledWithMatch({ traceInclude: ["one.js", "two.js"] });
    });

    it("traces with service config and skips individually + trace=false functions", async () => {
      mock({
        "serverless.yml": `
          service: sls-mocked

          custom:
            jetpack:
              trace: true

          provider:
            name: aws
            runtime: nodejs12.x

          functions:
            one:
              handler: one.handler
            two:
              handler: two.handler
              # Because individually packaged, service trace=true will apply.
              package:
                individually: true
            three:
              handler: three.handler
              # Because individually packaged, fn trace=false will apply.
              package:
                individually: true
              jetpack:
                trace: false
        `,
        "one.js": `
          exports.handler = async () => ({
            body: JSON.stringify({ message: "one" })
          });
        `,
        "two.js": `
          exports.handler = async () => ({
            body: JSON.stringify({ message: "two" })
          });
        `
      });

      const plugin = new Jetpack(await createServerless());
      await plugin.package();
      expect(Jetpack.prototype.globAndZip)
        .to.have.callCount(3).and
        .to.be.calledWithMatch({ traceInclude: ["one.js"] }).and
        .to.be.calledWithMatch({ traceInclude: ["two.js"] }).and
        .to.be.calledWithMatch({ traceInclude: undefined });
    });

    it("pattern matches service with only individually + trace=true functions traced", async () => {
      mock({
        "serverless.yml": `
          service: sls-mocked

          package:
            individually: true

          provider:
            name: aws
            runtime: nodejs12.x

          functions:
            one:
              handler: one.handler
            two:
              handler: two.handler
              # Default service-level false for individually. This will trace.
              jetpack:
                trace: true
            three:
              handler: three.handler
              # Explicit false should also not trace.
              jetpack:
                trace: false
        `,
        "two.js": `
          exports.handler = async () => ({
            body: JSON.stringify({ message: "two" })
          });
        `
      });

      const plugin = new Jetpack(await createServerless());
      await plugin.package();
      expect(Jetpack.prototype.globAndZip)
        .to.have.callCount(3).and
        .to.be.calledWithMatch({ traceInclude: ["two.js"] }).and
        .to.be.calledWithMatch({ traceInclude: undefined });
    });

    it("traces for service-level individually and trace"); // TODO
    it("traces for service-level individually and mixed trace and pattern"); // TODO
    it("traces with ignore options"); // TODO
    it("traces with include options"); // TODO
  });
});
