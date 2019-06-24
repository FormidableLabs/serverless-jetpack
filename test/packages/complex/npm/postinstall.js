"use strict";

const path = require("path");

// Hacky. Reuse execa from root install.
const execa = require("execa");

// Infer command from directory. (Hokey, but works given our structure).
const INSTALL_CMD = path.basename(process.cwd());
const cwd = path.resolve("layers/with-deps/nodejs");

const main = async () => {
  // eslint-disable-next-line no-console
  console.log(`Custom ${INSTALL_CMD} install in ${cwd}`);
  await execa(INSTALL_CMD, ["install"], {
    cwd,
    stdio: "inherit"
  });
};

if (require.main === module) {
  main().catch((err) => {
    console.error(err); // eslint-disable-line no-console
    process.exit(1); // eslint-disable-line no-process-exit
  });
}
