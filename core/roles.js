// Source of truth for the available role names.
//
// The list is derived from `roles/*.md` — adding a role brief there makes
// it visible to every host adapter automatically. Previously each adapter
// declared its own role list; auditor's addition surfaced the friction
// (three places to update for one new role).
//
// Per-host *customization* (claude-code's ROLE_FRONTMATTER with model,
// tools, permissionMode) still lives in the adapter, keyed by these
// names. This module covers only the list itself.

const fs = require("node:fs");
const path = require("node:path");

const ROLES_DIR = path.resolve(__dirname, "..", "roles");

function listRoles() {
  if (!fs.existsSync(ROLES_DIR)) return [];
  return fs.readdirSync(ROLES_DIR)
    .filter((f) => f.endsWith(".md") && f !== "README.md")
    .map((f) => f.replace(/\.md$/, ""))
    .sort();
}

module.exports = { listRoles, ROLES_DIR };
