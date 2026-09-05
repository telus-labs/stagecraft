- **omp dispatches no longer lose ten minutes to a foreground server.** A real
  `loop` QA dispatch through omp timed out at the 600 s ceiling: the build had
  shipped an `index.js` that listens on import and no tests, so QA tried to
  start the server and probe it — ten `bash` calls, each blocking until omp's
  60 s auto-background threshold. Three guards, in order of leverage:
  1. **Host notes in every omp prompt** (`capabilities.promptNotes`, rendered by
     `core/adapters/render-helpers.js` `renderHostNotes` at the end of layer 2
     so they stay in the cacheable prefix): never start a server, watcher, or
     REPL in the foreground; use the bash tool's `async: true`, probe with curl,
     stop it when done. Any host may declare `promptNotes`; hosts without the
     key render nothing.
  2. **A per-run omp settings overlay**, `.devteam/omp/dispatch.yml`, written by
     `devteam init --host omp` and passed via `--config` on every dispatch. It
     caps any single tool call at 120 s (`tools.maxTimeout`). omp hard-errors if
     the overlay is missing, so `status()`/`doctor` report it and a non-force
     re-install preserves an operator's edits.
  3. **Backend brief rule:** server entry points must be importable without
     side effects — export the app and call `listen()` only when run directly —
     so QA can test in-process on an ephemeral port instead of spawning and
     polling processes. The first hello-world run did this and QA took 1m36s;
     the second did not and QA timed out.
- **omp transcripts show what each tool was asked to do.** `[tool bash]` lines
  now carry the command (one line, ≤160 chars); read/write/edit/glob/grep show
  the path or pattern. The timed-out dispatch's log was ten bare `[tool bash]`
  lines with nothing to diagnose from.
