"use strict";

const Jetpack = require("../..");
const {
  resolveFilePathsFromPatterns
} = require("serverless/lib/plugins/package/lib/packageService");

describe("globbing (include/exclude) logic", () => {
  let plugin;

  beforeEach(() => {
    plugin = new Jetpack({}, {});
  });

  it("TODO START TEST", () => {
    console.log({
      plugin,
      resolveFilePathsFromPatterns
    });
  });

  it("should handle empty matches");
  it("should handle empty patterns");
});
