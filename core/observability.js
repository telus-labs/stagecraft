// OpenTelemetry bootstrap + tracer helpers.
//
// Tracing is OPT-IN via the standard OTEL_EXPORTER_OTLP_ENDPOINT env var.
// When unset, the OTel API's no-op tracer is used — zero runtime overhead.
// When set, the OTLP HTTP exporter ships spans to that endpoint (Jaeger,
// Tempo, Honeycomb, Datadog Agent, anything that speaks OTLP/HTTP).
//
// Environment variables we honor (all standard):
//   OTEL_EXPORTER_OTLP_ENDPOINT  → http://localhost:4318 etc.
//   OTEL_SERVICE_NAME            → defaults to "devteam"
//   OTEL_RESOURCE_ATTRIBUTES     → standard k=v,k=v
//   DEVTEAM_OTEL_DISABLE         → set to "1" to force-disable even if endpoint set
//                                  (useful in tests that import core modules)
//
// Usage in core/adapter code:
//   const { trace, withSpan } = require("./observability");
//   await withSpan("pipeline.stage", { stage: "stage-04" }, async () => { ... });
//
// withSpan() captures duration, records exceptions as span events, sets
// status=ERROR on throw. Synchronous bodies are supported too.

const otel = require("@opentelemetry/api");

const TRACER_NAME = "ai-dev-team";
const TRACER_VERSION = (() => {
  try { return require("../package.json").version; } catch { return "0.0.0"; }
})();

let _initialized = false;
function maybeInitSDK() {
  if (_initialized) return;
  _initialized = true;
  if (process.env.DEVTEAM_OTEL_DISABLE === "1") return;
  if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT && !process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT) {
    // No endpoint configured — leave the no-op tracer in place.
    return;
  }
  try {
    const { NodeSDK } = require("@opentelemetry/sdk-node");
    const { OTLPTraceExporter } = require("@opentelemetry/exporter-trace-otlp-http");
    const { Resource } = require("@opentelemetry/resources");
    const { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } = require("@opentelemetry/semantic-conventions");

    const sdk = new NodeSDK({
      resource: new Resource({
        [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || "devteam",
        [ATTR_SERVICE_VERSION]: TRACER_VERSION,
      }),
      traceExporter: new OTLPTraceExporter(),
    });
    sdk.start();
    // Flush on exit so short-lived CLI runs export their spans before
    // the process dies. Without this, last few spans are lost.
    process.on("beforeExit", () => sdk.shutdown());
    process.on("SIGINT", () => { sdk.shutdown().finally(() => process.exit(130)); });
    process.on("SIGTERM", () => { sdk.shutdown().finally(() => process.exit(143)); });
  } catch (err) {
    // SDK packages missing? Run with no tracing instead of crashing.
    process.stderr.write(`[devteam] OTel SDK init failed: ${err.message}; running without tracing\n`);
  }
}

maybeInitSDK();

function tracer() {
  return otel.trace.getTracer(TRACER_NAME, TRACER_VERSION);
}

// Wrap a function (sync or async) in a span. Records duration, captures
// thrown exceptions as span events + sets status=ERROR.
function withSpan(name, attributes, fn) {
  return tracer().startActiveSpan(name, { attributes }, (span) => {
    let result;
    try {
      result = fn(span);
    } catch (err) {
      span.recordException(err);
      span.setStatus({ code: otel.SpanStatusCode.ERROR, message: err && err.message });
      span.end();
      throw err;
    }
    // Async case
    if (result && typeof result.then === "function") {
      return result.then(
        (value) => { span.end(); return value; },
        (err) => {
          span.recordException(err);
          span.setStatus({ code: otel.SpanStatusCode.ERROR, message: err && err.message });
          span.end();
          throw err;
        },
      );
    }
    span.end();
    return result;
  });
}

// Convenience: drop attributes onto the current active span if one exists.
// Useful when a function deep in the call stack learns something the
// span at the top of the stack should record.
function setSpanAttributes(attrs) {
  const s = otel.trace.getActiveSpan();
  if (s) s.setAttributes(attrs);
}

module.exports = {
  trace: otel.trace,
  withSpan,
  setSpanAttributes,
  tracer,
};
