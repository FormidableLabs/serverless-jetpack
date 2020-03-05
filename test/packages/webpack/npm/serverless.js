"use strict";

const pkg = () => ({
  individually: false,
  excludeDevDependencies: true,
  include: [
    process.env.MODE === "deps" ? "src/**/*.js" : null
  ].filter(Boolean)
});

const jetpack = () => ({
  service: {
    preInclude: ["!**"],
    trace: process.env.MODE === "trace"
  }
});

const webpack = () => ({
  service: {
    packager: process.env.PKG
  }
});

module.exports = {
  pkg,
  jetpack,
  webpack
};
