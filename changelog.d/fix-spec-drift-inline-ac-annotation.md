### Fixed

- **Spec drift false positive when AC line carries an inline backtick annotation** (e.g. `` **AC-10** `[deploy-deferred]` — … ``): `AC_LINE_RE` in `core/spec/verify.js` now optionally consumes a `` `[tag]` `` token between the AC identifier and the separator, so the drift checker extracts the correct AC count and stage-03b no longer halts with `orphan_scenarios=1`. Closes #274.
