"use strict";

const pkg = () => ({
  individually: false,
  excludeDevDependencies: true
});

const jetpack = () => ({
  mode: process.env.MODE,
  lockfile: process.env.LOCKFILE === "false" ? null : undefined // undefined === default
});

const webpack = () => ({
  packager: process.env.MODE
});

module.exports = {
  jetpack,
  pkg,
  webpack
};
