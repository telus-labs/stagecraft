"use strict";

const path = require("node:path");
const { stageNames } = require(path.join(__dirname, "..", "..", "pipeline", "stages"));

const name = "stages";
const flags = {};

function run() {
  for (const n of stageNames()) console.log(n);
}

module.exports = { name, flags, run };
