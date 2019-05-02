"use strict";

const pkg = () => ({
  individually: true,
  excludeDevDependencies: true
});

const jetpack = () => ({
  mode: process.env.MODE
});

module.exports = {
  jetpack,
  pkg
};
