const TRANSITION_CONTROLS = Object.freeze({
  CONTINUE: "continue",
  HALT: "halt",
  COMPLETE: "complete",
});

const VALID_CONTROLS = new Set(Object.values(TRANSITION_CONTROLS));

/**
 * Common result returned by autonomous-driver action handlers.
 *
 * Handlers decide what changes; run() remains responsible for applying those
 * changes and retaining ownership of the loop, persistence, and lock lifecycle.
 */
function transitionResult(control, {
  summaryPatch = {},
  statePatch = {},
  logEvents = [],
  emittedEvents = [],
} = {}) {
  if (!VALID_CONTROLS.has(control)) {
    throw new TypeError(`invalid driver transition control: ${control}`);
  }
  if (!summaryPatch || typeof summaryPatch !== "object" || Array.isArray(summaryPatch)) {
    throw new TypeError("driver transition summaryPatch must be an object");
  }
  if (!statePatch || typeof statePatch !== "object" || Array.isArray(statePatch)) {
    throw new TypeError("driver transition statePatch must be an object");
  }
  if (!Array.isArray(logEvents) || !Array.isArray(emittedEvents)) {
    throw new TypeError("driver transition events must be arrays");
  }

  return { control, summaryPatch, statePatch, logEvents, emittedEvents };
}

function applyTransitionResult(result, {
  summary,
  state,
  logEvent,
  onEvent,
}) {
  Object.assign(summary, result.summaryPatch);
  Object.assign(state, result.statePatch);
  for (const entry of result.logEvents) logEvent(entry);
  for (const entry of result.emittedEvents) onEvent(entry);
  return result.control;
}

module.exports = {
  TRANSITION_CONTROLS,
  transitionResult,
  applyTransitionResult,
};
