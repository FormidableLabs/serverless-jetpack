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
  let fixtures;

  before(async () => {
    const lists = await globby([".test-zips/**/*.zip.files.txt"]);
    const contents = await Promise.all(lists.map((file) => readFile(file)));

    // Create object of `"combo.file = data"
    fixtures = contents.reduce((memo, data, i) => {
      const combo = lists[i].replace(".test-zips/", "").split("/");
      const key = combo.slice(0, 4).join("/"); // eslint-disable-line no-magic-numbers
      const file = combo.slice(4); // eslint-disable-line no-magic-numbers

      memo[key] = memo[key] || {};
      memo[key][file] = data.toString().split("\n");

      return memo;
    }, {});
  });

  MATRIX.forEach(({ scenario, mode, lockfile }) => {
    const combo = `${scenario}/${mode}/${lockfile}`;

    it(combo, async () => {
      Object.keys(fixtures[`${combo}/baseline`]).forEach((fileName) => {
        const baselineLines = fixtures[`${combo}/baseline`][fileName];
        const pluginLines = fixtures[`${combo}/jetpack`][fileName];

        console.log("TODO HERE", {
          fileName,
          baselineLen: baselineLines.length,
          pluginLen: pluginLines.length
        });
      });
    });
  });
});
