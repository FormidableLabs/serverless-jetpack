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
    // TODO: Remove sinon if we're not actually sandboxing.
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("serverless trace configurations", () => {
    beforeEach(() => {
      mock({});

      sandbox.stub(Jetpack.prototype, "globAndZip").returns(Promise.resolve({
        buildTime: 0
      }));
    });

    afterEach(() => {
      mock.restore();
    });

    it("traces all functions at service level, even if trace disabled in fn", async () => {
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

    it("traces service level with individually functions not traced"); // TODO
    it("pattern matches service while traces individually functions"); // TODO
    it("traces for service-level individually and trace"); // TODO
    it("traces for service-level individually and mixed trace and pattern"); // TODO
    it("traces with ignore options"); // TODO
    it("traces with include options"); // TODO
  });
});
