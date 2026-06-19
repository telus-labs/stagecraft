"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { sha256 } = require("../reproducibility");
const { writeGitignoreBlock } = require("../gitignore");

const IDENTITY_RELATIVE_PATH = path.join(".devteam", "evidence-project-id");
const RAW_ID_PATTERN = /^[0-9a-f]{32}$/;

function identityPath(cwd) {
  return path.join(cwd, IDENTITY_RELATIVE_PATH);
}

function projectRef(rawId) {
  if (!RAW_ID_PATTERN.test(rawId)) throw new Error("evidence project identity is malformed");
  return sha256(`stagecraft-evidence-project-v1\0${rawId}`);
}

function readIdentity(cwd) {
  const file = identityPath(cwd);
  let stat;
  try { stat = fs.lstatSync(file); } catch (error) {
    if (error.code === "ENOENT") return { exists: false, project_ref: null };
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error("evidence project identity must be a regular, non-symlink file");
  }
  const rawId = fs.readFileSync(file, "utf8").trim();
  return { exists: true, project_ref: projectRef(rawId), raw_id: rawId };
}

function newRawId() {
  return crypto.randomBytes(16).toString("hex");
}

function writeIdentity(cwd, rawId, opts = {}) {
  const file = identityPath(cwd);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${rawId}\n`, {
    encoding: "utf8",
    flag: opts.replace ? "w" : "wx",
    mode: 0o600,
  });
  try { fs.chmodSync(file, 0o600); } catch { /* Windows permissions are advisory */ }
  return { exists: true, project_ref: projectRef(rawId), path: file };
}

function getOrCreateIdentity(cwd) {
  const existing = readIdentity(cwd);
  if (existing.exists) return { ...existing, created: false };
  writeGitignoreBlock(cwd);
  return { ...writeIdentity(cwd, newRawId()), created: true };
}

function rotateIdentity(cwd) {
  const existing = readIdentity(cwd);
  if (!existing.exists) throw new Error("no evidence project identity exists to rotate");
  writeGitignoreBlock(cwd);
  return { ...writeIdentity(cwd, newRawId(), { replace: true }), rotated: true };
}

function deleteIdentity(cwd) {
  const existing = readIdentity(cwd);
  if (!existing.exists) return { deleted: false, project_ref: null };
  fs.unlinkSync(identityPath(cwd));
  return { deleted: true, project_ref: existing.project_ref };
}

module.exports = {
  IDENTITY_RELATIVE_PATH,
  identityPath,
  projectRef,
  readIdentity,
  getOrCreateIdentity,
  rotateIdentity,
  deleteIdentity,
};
