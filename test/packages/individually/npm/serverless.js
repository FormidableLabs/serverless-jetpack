"use strict";

const pkg = () => ({
  individually: true,
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
