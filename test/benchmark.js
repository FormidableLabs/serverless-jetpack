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

// Filter known false positives.
//
// Serverless does a traversal and inference of prod vs. dev dependencies
// throughout installed `node_modules`, but this is tricky to get right and
// there are known cases of bad matches that we exclude from consideration.
const BAD_MATCHES = new Set([
  // All binaries.
  "node_modules/.bin"
]);

// eslint-disable-next-line no-magic-numbers
const notBadMatch = (f) => !BAD_MATCHES.has(f.split("/").slice(0, 2).join("/"));

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
        // Get all of the lines from our file lists.
        const baselineLines = fixtures[`${combo}/baseline`][fileName];
        const baselineSet = new Set(baselineLines);
        const pluginLines = fixtures[`${combo}/jetpack`][fileName];
        const pluginSet = new Set(pluginLines);

        // Figure out what is missing from each.
        const missingInBaseline = pluginLines
          .filter((l) => !baselineSet.has(l))
          .filter(notBadMatch);
        const missingInPlugin = baselineLines
          .filter((l) => !pluginSet.has(l))
          .filter(notBadMatch);

        expect(missingInBaseline, "extra files in jetpack").to.eql([]);
        expect(missingInPlugin, "missing files in jetpack").to.eql([]);
      });
    });
  });
});
