"use strict";

/**
 * Glob testing.
 *
 * TODO_REMOVE: Just a temporary debugging script to help with patterns.
 *
 * ```sh
 * $ node tmp-glob-test.js
 * ```
 */
const path = require("path");
const globby = require("globby");
const nanomatch = require("nanomatch");

const cwd = path.resolve(__dirname, "test/packages/monorepo/yarn");

let patterns = [
  // Built-in starting point.
  "**",

  // Jetpack included
  "!functions/base/node_modules",
  "functions/base/node_modules/diff",
  "!functions/base/node_modules/diff/node_modules",

  // Normal sls include
  "!**/.DS_Store",
  "!**/yarn.lock",
  "!**/package-lock.json",
  "!**/node_modules/{@*/*,*}/CHANGELOG.md",
  "!**/node_modules/{@*/*,*}/HISTORY.md",
  "!**/node_modules/{@*/*,*}/LICENSE",
  "!**/node_modules/{@*/*,*}/README.md",
  // WEIRD: Removes `functions/base/node_modules/diff/` **only** if
  // `process.cwd() === cwd` in actual practice!!!
  "!functions",
  // PROBABLY REMOVE: Removes `functions/base/node_modules/diff/` categorically
  // "!functions/**",
  "functions/base/src/**",
  "!functions/**/exclude-me.js"
];

// Preinclude simulation
patterns = [
  // Built-in starting point.
  "**",

  // PREINCLUDE
  "!functions",
  "!functions/**",

  // Jetpack included
  "!functions/base/node_modules",
  "functions/base/node_modules/diff",
  "!functions/base/node_modules/diff/node_modules",

  // TEMP TODO REMOVE
  "!functions/base/node_modules/diff{,/**}",

  // Normal sls include
  "!**/.DS_Store",
  "!**/yarn.lock",
  "!**/package-lock.json",
  "!**/node_modules/{@*/*,*}/CHANGELOG.md",
  "!**/node_modules/{@*/*,*}/HISTORY.md",
  "!**/node_modules/{@*/*,*}/LICENSE",
  "!**/node_modules/{@*/*,*}/README.md",

  "functions/base/src/**",
  "!functions/**/exclude-me.js"
];

const files = [
  "functions/base/package.json",
  "functions/base/src/base.js",
  "functions/base/src/exclude-me.js",
  "functions/base/node_modules/diff/lib/index.js",
  "functions/base/node_modules/diff/README.md",
  "functions/base/node_modules/another/index.js",
  "functions/base/node_modules/another/README.md"
];

const fileMatch = async () => {
  const included = await globby(patterns, {
    cwd,
    dot: true,
    silent: true,
    follow: true,
    nodir: true
  });

  return {
    // Simulation: filter our list to what's in our `files` + actually on disk.
    included: included.filter((f) => files.includes(f)).sort(),
    excluded: files.filter((f) => !included.includes(f)).sort()
  };
};

const patternMatch = async (matchedFiles) => {
  matchedFiles = matchedFiles || files;
  const filesMap = matchedFiles.reduce((m, n) => ({ ...m, [n]: true }), {});
  patterns.forEach((pattern) => {
    // Do a positive match, but track "keep" or "remove".
    const includeFile = !pattern.startsWith("!");
    const positivePattern = includeFile ? pattern : pattern.slice(1);
    nanomatch(matchedFiles, [positivePattern], { dot: true }).forEach((file) => {
      filesMap[file] = includeFile;
    });
  });

  const included = Object.keys(filesMap).filter((n) => filesMap[n]).sort();
  return {
    included,
    excluded: matchedFiles.filter((f) => !included.includes(f)).sort()
  };
};

const main = async () => {
  const matchedFiles = await fileMatch();
  return {
    fileMatch: matchedFiles,
    // This one simulates output of sls with jetpack.
    patternMatchLimited: await patternMatch(matchedFiles.included),
    patternMatch: await patternMatch()
  };
};

if (require.main === module) {
  main()
    .then((data) => { // eslint-disable-line promise/always-return
      // eslint-disable-next-line no-console,no-magic-numbers
      console.log(JSON.stringify(data, null, 2));
    })
    .catch((err) => {
      console.log(err); // eslint-disable-line no-console
      process.exit(1); // eslint-disable-line no-process-exit
    });
}
