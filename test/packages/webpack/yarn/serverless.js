"use strict";

const pkg = () => ({
  individually: false,
  excludeDevDependencies: true
});

const webpack = () => ({
  packager: process.env.PKG
});

module.exports = {
  pkg,
  webpack
};
