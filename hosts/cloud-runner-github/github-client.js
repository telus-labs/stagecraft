"use strict";

// GitHub API client for the cloud-runner-github adapter (ADR-013).
//
// Uses only Node built-ins (http/https). No third-party HTTP library.
// The base URL defaults to https://api.github.com but is overridable via
// STAGECRAFT_GITHUB_API_URL (set to http://localhost:PORT in tests).
//
// All functions accept a `cfg` object; shared fields:
//   owner (string)   — GitHub org or user
//   repo  (string)   — repository name
//   token (string)   — Bearer token (fine-grained PAT or OAuth)
//   baseUrl (string) — API base URL (optional, overrides env var)

const http = require("node:http");
const https = require("node:https");
const { setTimeout: delay } = require("node:timers/promises");

const DEFAULT_BASE_URL = "https://api.github.com";
const MAX_REDIRECTS = 5;

function resolveBase(cfg) {
  return cfg.baseUrl || process.env.STAGECRAFT_GITHUB_API_URL || DEFAULT_BASE_URL;
}

// ---------------------------------------------------------------------------
// Core HTTP wrapper
// ---------------------------------------------------------------------------

function request(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === "https:" ? https : http;
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: opts.method || "GET",
      headers: {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "stagecraft-cloud-runner/1",
        ...opts.headers,
      },
    };

    const req = lib.request(options, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on("error", reject);
    });
    req.on("error", reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

async function requestWithRedirects(url, opts = {}, depth = 0) {
  const res = await request(url, opts);
  if ((res.status === 301 || res.status === 302 || res.status === 307 || res.status === 308)
      && res.headers.location && depth < MAX_REDIRECTS) {
    // Redirects (e.g. artifact download → S3) usually don't need auth headers
    const redirectOpts = res.status === 307 || res.status === 308
      ? { ...opts, headers: { ...opts.headers } }
      : { method: "GET" };
    return requestWithRedirects(res.headers.location, redirectOpts, depth + 1);
  }
  return res;
}

function authHeaders(token) {
  return token ? { "Authorization": `Bearer ${token}` } : {};
}

function parseJson(body) {
  try { return JSON.parse(body.toString("utf8")); } catch { return null; }
}

function assertOk(res, context) {
  if (res.status < 200 || res.status >= 300) {
    const detail = parseJson(res.body);
    const msg = (detail && detail.message) ? detail.message : res.body.toString("utf8").slice(0, 200);
    throw Object.assign(
      new Error(`GitHub API ${context}: HTTP ${res.status} — ${msg}`),
      { httpStatus: res.status, context },
    );
  }
}

// ---------------------------------------------------------------------------
// API methods
// ---------------------------------------------------------------------------

async function dispatchWorkflow(cfg) {
  const base = resolveBase(cfg);
  const url = `${base}/repos/${cfg.owner}/${cfg.repo}/actions/workflows/${encodeURIComponent(cfg.workflow)}/dispatches`;
  const body = JSON.stringify({ ref: cfg.ref || "main", inputs: cfg.inputs || {} });
  const res = await requestWithRedirects(url, {
    method: "POST",
    headers: { ...authHeaders(cfg.token), "Content-Type": "application/json" },
    body,
  });
  // 204 No Content is success; 404/422 are structural failures
  if (res.status === 204) return;
  assertOk(res, `dispatchWorkflow(${cfg.owner}/${cfg.repo}/${cfg.workflow})`);
}

async function listRuns(cfg) {
  const base = resolveBase(cfg);
  let url = `${base}/repos/${cfg.owner}/${cfg.repo}/actions/runs?event=workflow_dispatch&per_page=50`;
  if (cfg.created) url += `&created=>=${cfg.created}`;
  const res = await requestWithRedirects(url, { headers: authHeaders(cfg.token) });
  assertOk(res, `listRuns(${cfg.owner}/${cfg.repo})`);
  return parseJson(res.body);
}

async function getRunStatus(cfg) {
  const base = resolveBase(cfg);
  const url = `${base}/repos/${cfg.owner}/${cfg.repo}/actions/runs/${cfg.runId}`;
  const res = await requestWithRedirects(url, { headers: authHeaders(cfg.token) });
  assertOk(res, `getRunStatus(${cfg.owner}/${cfg.repo}/${cfg.runId})`);
  return parseJson(res.body);
}

async function cancelRun(cfg) {
  const base = resolveBase(cfg);
  const url = `${base}/repos/${cfg.owner}/${cfg.repo}/actions/runs/${cfg.runId}/cancel`;
  const res = await requestWithRedirects(url, {
    method: "POST",
    headers: authHeaders(cfg.token),
  });
  // 202 Accepted or 409 (already done) are both acceptable
  if (res.status !== 202 && res.status !== 409) assertOk(res, `cancelRun(${cfg.runId})`);
}

async function listArtifacts(cfg) {
  const base = resolveBase(cfg);
  const url = `${base}/repos/${cfg.owner}/${cfg.repo}/actions/runs/${cfg.runId}/artifacts`;
  const res = await requestWithRedirects(url, { headers: authHeaders(cfg.token) });
  assertOk(res, `listArtifacts(${cfg.runId})`);
  return parseJson(res.body);
}

async function downloadArtifactZip(cfg) {
  const base = resolveBase(cfg);
  const url = `${base}/repos/${cfg.owner}/${cfg.repo}/actions/artifacts/${cfg.artifactId}/zip`;
  const res = await requestWithRedirects(url, { headers: authHeaders(cfg.token) });
  assertOk(res, `downloadArtifact(${cfg.artifactId})`);
  return res.body;  // Buffer containing the zip
}

// ---------------------------------------------------------------------------
// Higher-level polling helpers
// ---------------------------------------------------------------------------

const CORRELATION_INTERVAL_MS = 3000;
const CORRELATION_MAX_MS = 60_000;
const STATUS_INTERVAL_MS = 3000;

/**
 * Poll runs list until a run named `correlationId` appears.
 * Returns the run ID (number) or null on timeout.
 */
async function correlateRun(cfg) {
  const intervalMs = cfg.pollIntervalMs ?? CORRELATION_INTERVAL_MS;
  const maxMs = cfg.correlationTimeoutMs ?? CORRELATION_MAX_MS;
  const deadline = Date.now() + maxMs;

  while (Date.now() < deadline) {
    const data = await listRuns({
      ...cfg,
      created: cfg.dispatchedAt ? cfg.dispatchedAt.slice(0, 19).replace("T", " ") : undefined,
    });
    const runs = (data && data.workflow_runs) ? data.workflow_runs : [];
    const match = runs.find((r) => r.name === cfg.correlationId);
    if (match) return match.id;
    if (intervalMs > 0) await delay(intervalMs);
  }
  return null;
}

/**
 * Poll a run until it reaches a terminal state or the deadline is hit.
 * Returns { conclusion, timedOut }.
 * conclusion values: "success" | "failure" | "cancelled" | "timed_out" | null
 */
async function pollRunToCompletion(cfg) {
  const intervalMs = cfg.pollIntervalMs ?? STATUS_INTERVAL_MS;
  const deadline = Date.now() + (cfg.pollTimeoutMs ?? 600_000);

  while (Date.now() < deadline) {
    const run = await getRunStatus(cfg);
    if (run.status === "completed") {
      return { conclusion: run.conclusion || null, timedOut: false };
    }
    if (intervalMs > 0) await delay(intervalMs);
  }
  return { conclusion: null, timedOut: true };
}

module.exports = {
  dispatchWorkflow,
  listRuns,
  getRunStatus,
  cancelRun,
  listArtifacts,
  downloadArtifactZip,
  correlateRun,
  pollRunToCompletion,
};
