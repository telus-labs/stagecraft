// Minimal ESLint flat config for Stagecraft.
//
// Intentionally light. The goal is to catch silent style drift and a small
// class of bugs (unused vars, missing await, accidental globals) as the
// codebase grows past 1.0 — not to impose a heavy style regime. Add
// rules conservatively; every rule must justify its noise budget.
//
// Run: npm run lint

const js = require("@eslint/js");
const security = require("eslint-plugin-security");

module.exports = [
  // Files NOT to lint.
  {
    ignores: [
      "node_modules/**",
      "docs/audit/**",
      "docs/audit-archive/**",
      "pipeline/**",
      // Don't lint files the user is auditing in their target project
      // when this repo happens to be the target — defense in depth.
      ".devteam/**",
      ".claude/**",
      ".codex/**",
      ".gemini/**",
    ],
  },

  // Base recommended rules.
  js.configs.recommended,

  // Security rules. Targeted subset of eslint-plugin-security focused on
  // the shell-injection-shape class CodeQL caught post-merge three times
  // in the last week (PRs #31, #34, #38). Pre-push catch is the goal;
  // the plugin's broader defaults flag many false positives on
  // legitimate buffer/regex/property-access code, so we enable only the
  // rules that pay their noise budget here.
  //
  // Rules deliberately OFF and why:
  //   detect-unsafe-regex — flagged 7 regexes that parse file-system
  //     content under operator control (DDL keywords, Gherkin grammar,
  //     AC identifiers, YAML config). All bounded inputs, all
  //     line-by-line parses; no realistic ReDoS surface. Inline
  //     suppression on each was rejected as noisier than the rule.
  //   detect-non-literal-fs-filename — Stagecraft legitimately reads
  //     dynamic paths everywhere (per-stage gate files, per-host
  //     install payloads).
  //   detect-non-literal-regexp — false-positives on legit cases like
  //     normalized-input regex constructors in tests.
  //   detect-non-literal-require — adapter loader genuinely needs this.
  //   detect-object-injection — very high false-positive rate on
  //     legitimate property access (gate field reads, config lookups).
  //   detect-possible-timing-attacks — Stagecraft doesn't do auth
  //     comparisons; rule fires on every === between strings.
  {
    plugins: { security },
    rules: {
      "security/detect-child-process": "error",
      "security/detect-eval-with-expression": "error",
      "security/detect-pseudoRandomBytes": "error",
      "security/detect-new-buffer": "error",
      "security/detect-bidi-characters": "error",
    },
  },

  // Project-wide rules.
  {
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "commonjs",
      globals: {
        // Node.js globals — explicit so eslint:recommended's no-undef
        // doesn't false-flag them.
        process: "readonly",
        Buffer: "readonly",
        console: "readonly",
        require: "readonly",
        module: "readonly",
        exports: "writable",
        __dirname: "readonly",
        __filename: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        setImmediate: "readonly",
        clearImmediate: "readonly",
        global: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        Atomics: "readonly",
        SharedArrayBuffer: "readonly",
        Int32Array: "readonly",
        TextEncoder: "readonly",
        TextDecoder: "readonly",
        AbortController: "readonly",
        AbortSignal: "readonly",
        fetch: "readonly",
        queueMicrotask: "readonly",
        structuredClone: "readonly",
      },
    },
    rules: {
      // Allow leading underscore for intentionally unused args/vars.
      "no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          // Test files often import helpers for type/contract reasons
          // even when not every binding is used in every test.
        },
      ],
      // Strict equality everywhere. Trivial to enforce, prevents real bugs.
      "eqeqeq": ["error", "always", { null: "ignore" }],
      // Allow console — Stagecraft is a CLI; console.log / console.error
      // are the primary output channels.
      "no-console": "off",
      // Allow process.exit — same reason, CLI entry points exit by exit code.
      "no-process-exit": "off",
    },
  },

  // Browser globals for the UI's static JS.
  {
    files: ["core/ui/static/**/*.js"],
    languageOptions: {
      sourceType: "script",
      globals: {
        window: "readonly",
        document: "readonly",
        EventSource: "readonly",
        fetch: "readonly",
        console: "readonly",
        location: "readonly",
        history: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        navigator: "readonly",
      },
    },
  },
];
