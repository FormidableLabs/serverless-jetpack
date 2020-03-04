"use strict";

const pkg = () => ({
  individually: false,
  excludeDevDependencies: true
});

const jetpack = () => ({
  service: {
    trace: process.env.MODE === "trace",
    concurrency: 2
  }
});

module.exports = {
  pkg,
  jetpack
};
