"use strict";

/**
 * Tests validating jetpack vs. built-in serverless packaging.
 *
 * **Note**: requires a full `yarn benchmark` run first to generate file
 * lists.
 */
const { MATRIX } = require("./script");
const globby = require("globby");
const { readFile } = require("fs-extra");

describe("benchmark", () => {
  let lists;

  before(async () => {
    lists = (await globby([".test-zips/**/*.zip.files.txt"]))
      .map((f) => f.replace(".test-zips/", ""));
  });

  MATRIX.forEach(({ scenario, mode, lockfile }) => {
    const combo = `${scenario}/${mode}/${lockfile}`;

    it(combo, () => {
      lists.filter((f) => f.indexOf(`${combo}/baseline`) > -1).forEach((file) => {
        console.log(`TODO ${file}`);
      });
    });
  });
});
