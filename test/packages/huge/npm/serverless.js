"use strict";

const pkg = () => ({
  individually: false,
  excludeDevDependencies: true
});

const jetpack = () => ({
  mode: process.env.MODE
});

module.exports = {
  jetpack,
  pkg
};
