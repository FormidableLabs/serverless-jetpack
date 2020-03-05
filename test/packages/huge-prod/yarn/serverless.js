"use strict";

const pkg = () => ({
  individually: false,
  excludeDevDependencies: true
});

const jetpack = () => ({
  service: {
    trace: process.env.MODE === "trace"
  }
});

module.exports = {
  pkg,
  jetpack
};
