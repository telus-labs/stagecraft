// Embedding provider for the memory store.
//
// Default: local — @huggingface/transformers running BGE-small (384 dim).
// ~150MB model downloaded once on first use, cached under
// ~/.cache/huggingface/. Works offline thereafter. Aligns with Stagecraft's
// model-agnostic ethos (D1 + this both default to "no external account
// required" with opt-in API providers when set).
//
// Opt-in providers (not yet implemented; placeholder for the future):
//   DEVTEAM_EMBEDDING_PROVIDER=openai  + OPENAI_API_KEY → text-embedding-3-small
//   DEVTEAM_EMBEDDING_PROVIDER=cohere  + COHERE_API_KEY  → embed-english-v3.0
//
// Tests: DEVTEAM_EMBEDDING_PROVIDER=stub gives a deterministic
// hash-based vector — fast, offline, no model load required.
//
// API:
//   const { getEmbedder } = require("./embed");
//   const e = await getEmbedder();
//   const v = await e.embed("text");          // → Float32Array
//   const vs = await e.embedBatch(["a","b"]); // → Float32Array[]
//   e.modelId, e.dimensions

const DEFAULT_MODEL = "Xenova/bge-small-en-v1.5";
const DEFAULT_DIM = 384;

let _cached = null;

async function getEmbedder(opts = {}) {
  if (_cached && !opts.fresh) return _cached;
  const provider = process.env.DEVTEAM_EMBEDDING_PROVIDER || "local";
  switch (provider) {
    case "local":  _cached = await makeLocal(opts);  return _cached;
    case "stub":   _cached = makeStub(opts);          return _cached;
    case "openai": throw new Error("openai embedding provider not yet implemented (planned for v0.3); set DEVTEAM_EMBEDDING_PROVIDER=local for now");
    case "cohere": throw new Error("cohere embedding provider not yet implemented (planned for v0.3); set DEVTEAM_EMBEDDING_PROVIDER=local for now");
    default:       throw new Error(`Unknown DEVTEAM_EMBEDDING_PROVIDER: ${provider}`);
  }
}

// ---------------------------------------------------------------------------
// Local — @huggingface/transformers
// ---------------------------------------------------------------------------

async function makeLocal(opts = {}) {
  const modelId = opts.modelId || process.env.DEVTEAM_EMBEDDING_MODEL || DEFAULT_MODEL;
  let pipeline;
  try {
    const transformers = require("@huggingface/transformers");
    pipeline = transformers.pipeline;
  } catch (err) {
    throw new Error(
      `@huggingface/transformers not installed; cannot load local embedder. ` +
      `Install with: npm install @huggingface/transformers --save\n` +
      `(or set DEVTEAM_EMBEDDING_PROVIDER=stub for tests)`,
    );
  }
  // Quiet the library's progress chatter unless DEBUG asks for it.
  if (!process.env.DEBUG) {
    process.env.TRANSFORMERS_VERBOSITY = process.env.TRANSFORMERS_VERBOSITY || "error";
  }
  const extractor = await pipeline("feature-extraction", modelId, { quantized: true });

  async function embed(text) {
    const out = await extractor(text, { pooling: "mean", normalize: true });
    return new Float32Array(out.data);
  }
  async function embedBatch(texts) {
    if (!Array.isArray(texts) || texts.length === 0) return [];
    const out = await extractor(texts, { pooling: "mean", normalize: true });
    // out is a Tensor [batch, dim]. Split into per-row Float32Arrays.
    const dim = out.dims[out.dims.length - 1];
    const result = [];
    for (let i = 0; i < texts.length; i++) {
      result.push(new Float32Array(out.data.slice(i * dim, (i + 1) * dim)));
    }
    return result;
  }
  return { modelId, dimensions: DEFAULT_DIM, provider: "local", embed, embedBatch };
}

// ---------------------------------------------------------------------------
// Stub — deterministic hash-based vectors for tests
// ---------------------------------------------------------------------------

function makeStub(opts = {}) {
  const dim = opts.dimensions || 16;
  function hashVec(text) {
    const v = new Float32Array(dim);
    // Lightweight DJB2-ish hash mixed across dims.
    let h = 5381;
    for (let i = 0; i < text.length; i++) {
      h = ((h << 5) + h) ^ text.charCodeAt(i);
    }
    for (let i = 0; i < dim; i++) {
      const k = (h ^ (i * 2654435761)) >>> 0;
      v[i] = ((k & 0xffff) / 65535) * 2 - 1;
    }
    // L2-normalize so cosine = dot for the test.
    let n = 0;
    for (let i = 0; i < dim; i++) n += v[i] * v[i];
    n = Math.sqrt(n) || 1;
    for (let i = 0; i < dim; i++) v[i] /= n;
    return v;
  }
  async function embed(text) { return hashVec(text); }
  async function embedBatch(texts) { return texts.map(hashVec); }
  return { modelId: "stub", dimensions: dim, provider: "stub", embed, embedBatch };
}

function resetCache() { _cached = null; }

module.exports = { getEmbedder, resetCache, DEFAULT_MODEL, DEFAULT_DIM };
