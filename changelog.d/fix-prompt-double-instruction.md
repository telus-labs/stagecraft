- **Inlined prompts no longer tell the model to re-read what they already
  contain.** Since 37.2 the stage prompt inlines AGENTS.md, the rules files,
  and the role brief, but two instructions survived from the pointer era: the
  layer-2 sentence "Read the role prompt at `<path>` before acting" and, inside
  the inlined brief, its own "## Read First" list naming AGENTS.md and the
  rules files layer 1 had just inlined. A live omp stage-01 dispatch obeyed
  both — 8 of its 13 file reads were re-reads of inlined content, each a full
  model round trip re-sending the growing context (19 tool calls, 2m08s,
  583K input tokens to write a brief).
  Markdown hosts (codex, antigravity, omp, plugin hosts) now render "Role brief
  for `<role>` (inlined below; source: `<path>` — already in this prompt, no
  need to read it)" when inlining; claude-code keeps its subagent sentence,
  which does real work there. In every host's inlined brief, Read-First
  bullets for files layer 1 inlined are replaced by one line saying so;
  bullets for volatile files (`pipeline/context.md`, `pipeline/brief.md`, …)
  stay. The brief on disk is unchanged, and `prompts.inline_framework: false`
  restores the original pointer and list. `core/adapters/render-helpers.js`
  exports `annotateInlinedReadFirst`; `tests/prompt-double-instruction.test.js`
  pins the behaviour for omp, codex, and claude-code.
