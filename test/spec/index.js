"use strict";

/**
 * Plugin tests.
 */

const mock = require("mock-fs");
const sinon = require("sinon");

const Serverless = require("serverless");
const Jetpack = require("../..");

// Helpers.
// Create a mostly-real serverless object for config parsing.
const createServerless = async (sandbox) => {
  const serverless = new Serverless();
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

describe("index", () => {
  let sandbox;

  beforeEach(() => {
    mock({});
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
    mock.restore();
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

      const plugin = new Jetpack(await createServerless(sandbox));
      await plugin.package();
      expect(Jetpack.prototype.globAndZip)
        .to.have.callCount(1).and
        .to.be.calledWithMatch({ traceInclude: ["one.js", "two.js"] });
    });

    it.only("traces with service config and skips individually + trace=false functions", async () => {
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
              # Because individually packaged, trace=false will apply.
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

      // TODO: HERE -- Getting a return of the Previous test file! `.only` bandaids.
      // TODO: Also the test is failing! (because calling with `traceInclude: ["two.js"]`)

      const plugin = new Jetpack(await createServerless(sandbox));
      await plugin.package();
      expect(Jetpack.prototype.globAndZip)
        .to.have.callCount(2).and
        .to.be.calledWithMatch({ traceInclude: ["one.js"] }).and
        .to.be.calledWithMatch({ traceInclude: undefined })
    });

    it("pattern matches service with only individually + trace=true functions traced"); // TODO
    it("traces for service-level individually and trace"); // TODO
    it("traces for service-level individually and mixed trace and pattern"); // TODO
    it("traces with ignore options"); // TODO
    it("traces with include options"); // TODO
  });
});
