// Minimal ESLint flat config for Stagecraft.
//
// Intentionally light. The goal is to catch silent style drift and a small
// class of bugs (unused vars, missing await, accidental globals) as the
// codebase grows past 1.0 — not to impose a heavy style regime. Add
// rules conservatively; every rule must justify its noise budget.
//
// Run: npm run lint

const js = require("@eslint/js");

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
      },
    },
  },
];
