"use strict";

const { scanContent } = require("../hooks/secret-scan");

const SAFE_CATEGORY = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,79}$/;

function category(value) {
  if (typeof value !== "string" || !SAFE_CATEGORY.test(value)) return "other";
  return scanContent(value).length === 0 ? value : "other";
}

function number(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

module.exports = { category, number };
