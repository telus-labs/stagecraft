---
name: platform-build
description: "Platform Developer: Stage 4 build task. Docker Compose setup, infra config, PR summary authoring, and Stage 4 gate writing for the platform workstream."
---

# Platform Build Task (Stage 4)

Use this skill when you are the Platform Developer executing the Stage 4 build
stage — setting up infra, CI, and the deploy rails for a new feature.

## Procedure

1. Read `pipeline/design-spec.md` — set up infra and CI to support what's being built.
2. Append an `## Assumptions` block to `pipeline/context.md` for non-obvious
   infra choices (ports, volumes, healthcheck targets) per coding-principles §1.
   Write the **Plan** preamble at the top of `pipeline/pr-platform.md` per §4.
3. Write or update `docker-compose.yml` in the project root:
   - Define a service for each component in the design spec
   - Add a `healthcheck:` to every HTTP service so `docker compose up --wait` works
   - Use `.env` for all secrets and environment-specific values — never hardcode
   - Mount source directories as volumes for local dev hot-reload where appropriate
4. Write or update any supporting infra config (`.env.example`, nginx config, etc.).
   Keep changes inside `src/infra/` and root compose/env files; cross-boundary
   edits need a `CONCERN:` line first (coding-principles §3).
5. Finish `pipeline/pr-platform.md`. Include `## Out of Scope — Noticed`. Also:

   - **`## Verify`** — required before writing a PASS gate. One bullet per
     infrastructure criterion you claim to have satisfied, in this exact shape:

     ```markdown
     ## Verify

     - **AC-7**: docker-compose brings the stack up cleanly
       - `docker compose up --wait`
       - → `Network created`, `Container api healthy`, `Container db healthy`,
         exit 0 after 14s
     - **AC-8**: nginx forwards /api to backend on port 3000
       - `curl -i http://localhost/api/health`
       - → `HTTP/1.1 200 OK`, body `{"status":"ok"}`, no nginx 502
     ```

     Each bullet ties one acceptance-criterion ID to (a) the exact command you
     ran and (b) the observed output — `docker compose ps` output, a
     `curl -i` response, a health-check status. Not "infra is set up." A PASS
     gate whose `## Verify` is empty, missing, or lists ACs you didn't
     actually exercise is invalid and will be flagged at peer review.
6. Write `pipeline/gates/stage-04.platform.json` with `"status": "PASS"`. PASS
   is only honest when every AC has a `## Verify` bullet with a real command
   and a real observed output. If even one AC is unverified, the right status
   is FAIL or escalate back to the PM for clarification — not PASS.
