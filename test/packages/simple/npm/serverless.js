"use strict";

const pkg = () => ({
  individually: false,
  excludeDevDependencies: true
});

const jetpack = () => ({
  service: process.env.MODE === "trace" ? {
    trace: true
  } : false
});

module.exports = {
  pkg,
  jetpack
};
