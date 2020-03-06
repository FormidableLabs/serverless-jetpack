"use strict";

const jetpack = () => ({
  service: {
    preInclude: ["!**"],
    trace: process.env.MODE === "trace"
  }
});

module.exports = {
  jetpack
};
