# Observability

Stagecraft emits [OpenTelemetry](https://opentelemetry.io) spans for every pipeline operation. Drop them into Jaeger, Tempo, Honeycomb, Datadog, New Relic, or anything else that speaks OTLP/HTTP.

## Quick start

Tracing is **opt-in**. With no environment variables set, the orchestrator uses OTel's no-op tracer — zero runtime overhead.

To turn it on, set the standard OTel endpoint:

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
devteam stage build
```

That's it. The OTLP HTTP exporter ships spans to that endpoint. Any OTLP-compatible backend works.

## Local Jaeger in 30 seconds

```bash
docker run --rm -d --name jaeger \
  -p 16686:16686 \
  -p 4318:4318 \
  jaegertracing/all-in-one:latest

export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
devteam stage requirements --feature "test"
# → open http://localhost:16686, search service "devteam"
```

## Environment variables

All standard [OTel env vars](https://opentelemetry.io/docs/specs/otel/configuration/sdk-environment-variables/) work. The ones you'll typically set:

| Variable | Default | Purpose |
|---|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | (unset → no tracing) | Where to ship spans. e.g. `http://localhost:4318` for local Jaeger, `https://api.honeycomb.io` for Honeycomb. |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | (unset) | Trace-specific override of the above. |
| `OTEL_EXPORTER_OTLP_HEADERS` | (unset) | Auth headers, e.g. `x-honeycomb-team=YOUR_KEY` |
| `OTEL_SERVICE_NAME` | `devteam` | Service name shown in your tracing UI. |
| `OTEL_RESOURCE_ATTRIBUTES` | (unset) | Comma-separated `k=v` pairs, e.g. `deployment.environment=staging,team=infra` |
| `DEVTEAM_OTEL_DISABLE` | `0` | Force-disable even if the endpoint is set. Useful in tests. |

## What gets traced

The orchestrator emits spans for every significant operation. A `devteam stage build` run for a multi-role stage produces:

```
pipeline.stage                   stage="stage-04" track="full" workstream_count=4
├── pipeline.workstream          role="backend" workstream.id="stage-04.backend"
│   └── adapter.renderStagePrompt   host="codex"
├── pipeline.workstream          role="frontend" workstream.id="stage-04.frontend"
│   └── adapter.renderStagePrompt   host="claude-code"
├── pipeline.workstream          role="platform" workstream.id="stage-04.platform"
│   └── adapter.renderStagePrompt   host="claude-code"
└── pipeline.workstream          role="qa" workstream.id="stage-04.qa"
    └── adapter.renderStagePrompt   host="claude-code"
```

Other spans:

| Span name | When | Key attributes |
|---|---|---|
| `pipeline.stage` | Every `devteam stage <name>` | `devteam.stage`, `devteam.stage.name`, `devteam.track`, `devteam.workstream_count`, `devteam.feature` |
| `pipeline.stage.headless` | Every `devteam stage <name> --headless` | Same as above + per-workstream `adapter.invoke` children |
| `pipeline.workstream` | Each role within a multi-role stage (or once for single-role) | `devteam.workstream.role`, `devteam.host`, `devteam.workstream.id` |
| `adapter.renderStagePrompt` | When the orchestrator asks an adapter to render the prompt | `devteam.host`, `devteam.workstream.role` |
| `adapter.invoke` | Headless host-CLI invocation | `devteam.host`, `devteam.workstream.role`, `devteam.invoke.exit_code`, `devteam.invoke.duration_ms`, `devteam.invoke.gate_written` |
| `pipeline.merge` | `devteam merge <stage>` | `devteam.stage`, `devteam.merge.result` (`merged` or `missing`), `devteam.merge.status`, `devteam.merge.blockers_count`, `devteam.merge.warnings_count` |
| `pipeline.next` | `devteam next` | `devteam.track`, `devteam.next.action`, `devteam.next.stage`, `devteam.next.name` |

Spans capture exceptions automatically. If anything throws, the span gets `status=ERROR` and the exception is recorded as a span event.

## What's NOT traced (yet)

- **The validator** (`core/gates/validator.js`) — runs as a short-lived child process from hooks and calls `process.exit()` on every branch. Tracing it cleanly needs a refactor. Worked around for now: the orchestrator traces validate calls it makes itself (via the `pipeline.next` and `pipeline.merge` spans).
- **The approval-derivation hook** — same story; spawned by Claude Code's PostToolUse hook, exits immediately.
- **LLM calls themselves** — we don't make them. The host (Claude Code, Codex) does. Their tracing surface is theirs; we just observe what they wrote (gate files).

Roadmap entries (`docs/BACKLOG.md`):
- **D2 — gate-pass-rate dashboards** consumes these spans.
- **D4 — per-role per-model performance scores** also consumes them (derive metrics from the duration + status attributes).
- **D5 — adaptive routing** uses D4's metrics to choose hosts automatically.

## Backend-specific cookbooks

### Honeycomb

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=https://api.honeycomb.io
export OTEL_EXPORTER_OTLP_HEADERS=x-honeycomb-team=YOUR_API_KEY
export OTEL_SERVICE_NAME=devteam-${USER}
devteam stage build
# → Honeycomb dataset "devteam-${USER}"
```

### Datadog (via the agent)

Run the Datadog Agent locally with OTLP enabled, then:

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
export OTEL_SERVICE_NAME=devteam
export OTEL_RESOURCE_ATTRIBUTES=deployment.environment=staging
devteam stage build
```

### Console exporter (for debugging the trace itself)

The current SDK setup ships to OTLP only. For raw stdout output, override at the SDK level — out of scope for the framework's default, but easily customizable in `core/observability.js`.

## Testing your instrumentation

`tests/observability.test.js` exercises the orchestrator span tree with an `InMemorySpanExporter`. To add a new instrumented operation:

1. Wrap the operation in `withSpan("name", attrs, () => ...)` from `core/observability.js`.
2. Add an assertion in `tests/observability.test.js` that runs the operation through a test tracer provider and verifies the expected span name + attributes.
3. Document the new span in this file's "What gets traced" table.

## Cost / overhead

When unconfigured (no env var), tracing uses OTel's no-op tracer: a single function call that returns immediately. Negligible cost.

When configured, span creation + attribute attachment is on the hot path. In our usage (`pipeline.stage` wraps a CLI command that takes seconds to minutes), the OTel overhead is in the microsecond range. Negligible.

The OTLP HTTP exporter buffers spans and flushes on a background timer + on process exit. CLI runs sometimes exit before the flush — the framework wires `beforeExit` + `SIGINT` + `SIGTERM` handlers to call `sdk.shutdown()`, but very-short-lived runs (sub-second) can still lose the tail of a trace. The orchestrator's normal usage is long-lived enough that this rarely matters.
