"use strict";

/**
 * Concatenate all lock files to a single file to create a suitable cache
 * key hash part for CI.
 *
 * **Note**: Runs _before_ dependencies are installed, so **no deps** here!
 */
const path = require("path");
const { promisify } = require("util");
const fs = require("fs");

const { log } = console;
const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);

const DEST = path.resolve(__dirname, "../all-lock-files.txt");

// Generate with:
//
// ```sh
// $ ls test/packages/*/*/{yarn.lock,package-lock.json} | cat | sort
// $ ls test/packages/*/*/{lib,functions,layers/with-deps}/*/package-lock.json | cat | sort
// ```
const LOCK_FILES = [
  // Project root.
  "yarn.lock",
  // Package deps.
  "test/packages/complex/npm/package-lock.json",
  "test/packages/complex/yarn/yarn.lock",
  // "test/packages/dashboard/npm/package-lock.json",
  // "test/packages/dashboard/yarn/yarn.lock",
  // "test/packages/huge/npm/package-lock.json",
  // "test/packages/huge/yarn/yarn.lock",
  // "test/packages/huge-prod/npm/package-lock.json",
  // "test/packages/huge-prod/yarn/yarn.lock",
  // "test/packages/individually/npm/package-lock.json",
  // "test/packages/individually/yarn/yarn.lock",
  // "test/packages/monorepo/npm/package-lock.json",
  // "test/packages/monorepo/yarn/yarn.lock",
  "test/packages/simple/npm/package-lock.json",
  "test/packages/simple/yarn/yarn.lock"
  // "test/packages/webpack/npm/package-lock.json",
  // "test/packages/webpack/yarn/yarn.lock",
  // "test/packages/complex/npm/layers/with-deps/nodejs/package-lock.json"
  // "test/packages/monorepo/npm/functions/another/package-lock.json",
  // "test/packages/monorepo/npm/functions/base/package-lock.json",
  // "test/packages/monorepo/npm/lib/camel/package-lock.json"
];

const main = async () => {
  const bufs = await Promise.all(LOCK_FILES.map((f) => readFile(path.resolve(__dirname, "..", f))));
  const data = bufs
    .map((b) => b.toString())
    .join("\n");

  await writeFile(DEST, data);
};

if (require.main === module) {
  main().catch((err) => {
    log(err);
    process.exit(1); // eslint-disable-line no-process-exit
  });
}
