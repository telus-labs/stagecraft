"use strict";

// Disk-based backup/restore for `devteam replay`.
//
// The headless dispatch that replay invokes will overwrite the workstream
// gate at its canonical path. Without a disk backup, a crash between
// dispatch and restore leaves the original silently replaced (the old code
// acknowledged this in a comment: "atomicity isn't critical for a replay
// flow"). This module eliminates that race: snapshot to disk *before*
// dispatch, restore from disk, delete on success, and surface leftovers on
// next startup. (3.1 PR 3 / 3.7.4)

const fs = require("node:fs");
const path = require("node:path");

const BACKUP_DIR = ".replay-backup";

function _backupDir(gatesDir) {
  return path.join(gatesDir, BACKUP_DIR);
}

// Write rawContent to .replay-backup/<gateName> before dispatch.
// Returns the backup path.
function snapshotGate(gatesDir, gateName, rawContent) {
  const dir = _backupDir(gatesDir);
  fs.mkdirSync(dir, { recursive: true });
  const backupPath = path.join(dir, gateName);
  fs.writeFileSync(backupPath, rawContent, "utf8");
  return backupPath;
}

// Read the backup for gateName. Returns { backupPath, content } or null.
function readBackup(gatesDir, gateName) {
  const backupPath = path.join(_backupDir(gatesDir), gateName);
  if (!fs.existsSync(backupPath)) return null;
  return { backupPath, content: fs.readFileSync(backupPath, "utf8") };
}

// Restore the original gate from the backup, then delete the backup.
// Returns true on success; false if no backup exists.
function restoreFromBackup(gatesDir, gateName, originalPath) {
  const backup = readBackup(gatesDir, gateName);
  if (!backup) return false;
  fs.writeFileSync(originalPath, backup.content, "utf8");
  _deleteBackupFile(backup.backupPath);
  return true;
}

// Delete the backup on clean success (no crash between dispatch and restore).
function deleteBackup(gatesDir, gateName) {
  const backupPath = path.join(_backupDir(gatesDir), gateName);
  _deleteBackupFile(backupPath);
}

function _deleteBackupFile(backupPath) {
  try { fs.unlinkSync(backupPath); } catch { /* already gone */ }
  // Remove the dir if empty (best-effort — failure is harmless).
  try {
    const dir = path.dirname(backupPath);
    if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
  } catch { /* */ }
}

// Scan gatesDir/.replay-backup/ for leftover .json files from a previous
// crashed replay. Returns an array of { name, backupPath, originalPath }.
function findLeftoverBackups(gatesDir) {
  const dir = _backupDir(gatesDir);
  if (!fs.existsSync(dir)) return [];
  try {
    return fs.readdirSync(dir)
      .filter((n) => n.endsWith(".json"))
      .map((n) => ({
        name: n,
        backupPath: path.join(dir, n),
        originalPath: path.join(gatesDir, n),
      }));
  } catch {
    return [];
  }
}

// Move the newly-produced gate at srcPath to the replay archive directory
// (pipeline/gates/replay/<stageId>.<timestamp>.json). Returns the archive path.
function archiveReplayGate(gatesDir, stageId, rawContent) {
  const replayDir = path.join(gatesDir, "replay");
  fs.mkdirSync(replayDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const replayPath = path.join(replayDir, `${stageId}.${ts}.json`);
  fs.writeFileSync(replayPath, rawContent, "utf8");
  return replayPath;
}

// When replay runs against a gate that did NOT exist before dispatch (no
// original to restore), remove the file the headless run wrote so the
// canonical path is left in its pre-replay state (absent). Best-effort.
function clearOriginalGate(originalPath) {
  try { fs.unlinkSync(originalPath); } catch { /* */ }
}

module.exports = {
  snapshotGate,
  readBackup,
  restoreFromBackup,
  deleteBackup,
  findLeftoverBackups,
  archiveReplayGate,
  clearOriginalGate,
  BACKUP_DIR,
};
