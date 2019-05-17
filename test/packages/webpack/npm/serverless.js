"use strict";

const pkg = () => ({
  individually: false,
  excludeDevDependencies: true
});

const webpack = () => ({
  packager: process.env.MODE
});

module.exports = {
  pkg,
  webpack
};
