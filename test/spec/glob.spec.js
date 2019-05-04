"use strict";

/**
 * Tests to ensure that serverless-jetpack mostly matches the file exclude and
 * include globbing logic of serverless.
 */

const mock = require("mock-fs");

const Jetpack = require("../..");
const {
  resolveFilePathsFromPatterns
} = require("serverless/lib/plugins/package/lib/packageService");

// Serverless mixes in the function, so we do for a mock.
class Sls {
  constructor(serverless) {
    this.serverless = serverless;
    this.resolveFilePathsFromPatterns = resolveFilePathsFromPatterns;
  }
}

describe("globbing (include/exclude) logic", () => {
  let plugin;
  let sls;

  // Bridge to compare equality between jetpack and serverless.
  const compare = async ({ pkgInclude, pkgExclude, fnInclude, fnExclude }) => {
    const pluginError = "No file matches include / exclude patterns";
    let slsError;

    try {
      await sls.resolveFilePathsFromPatterns({
        include: [],
        exclude: []
      });
    } catch (slsErr) {
      slsError = slsErr;
    }

    expect(slsError).to.have.property("message", pluginError);
  };

  beforeEach(() => {
    mock();

    plugin = new Jetpack({}, {});

    sls = new Sls({
      config: {
        servicePath: ""
      },
      classes: {
        Error
      }
    });
  });

  afterEach(() => {
    mock.restore();
  });

  it("should error on no patterns, no matches", async () => {
    await compare({});
  });

  it("should handle empty matches"); // TODO
  it("should handle empty patterns"); // TODO
});
