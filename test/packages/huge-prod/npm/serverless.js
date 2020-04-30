"use strict";

const pkg = () => ({
  individually: false,
  excludeDevDependencies: true
});

const jetpack = () => ({
  service: {
    trace: process.env.MODE !== "trace" ? false : {
      dynamic: {
        resolutions: {
          "express/lib/view.js": []
        }
      }
    }
  }
});

module.exports = {
  pkg,
  jetpack
};
