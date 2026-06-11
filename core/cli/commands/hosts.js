"use strict";

const path = require("node:path");
const { listHosts } = require(path.join(__dirname, "..", "..", "router"));

const name = "hosts";
const flags = {};

function run() {
  const hosts = listHosts();
  if (hosts.length === 0) {
    console.log("(no host adapters installed under hosts/)");
    return;
  }
  for (const h of hosts) console.log(h);
}

module.exports = { name, flags, run };
