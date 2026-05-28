# 01 — Architecture map

> Phase 0.2 output. Read `00-project-context.md` first. Replace placeholders with findings.

## Summary

One paragraph: the shape of the architecture in plain language. If someone asked "what's the high-level design?", what's the 30-second answer?

## Component inventory

Every major module / package / service.

| Component | Purpose | Entry point | Internal deps |
|---|---|---|---|
| | | | |

## Dependency graph

Either ASCII / Mermaid or a clear textual description of how components depend on each other.

```
componentA → componentB → componentC
              ↓
            componentD
```

### Circular dependencies

List any cycles found.

### High fan-in components

Components that many others depend on. These are the highest-blast-radius places to change.

## External integrations

Third-party libraries, APIs, databases, cloud services.

| Integration | Used by | Abstracted (port/adapter) or direct? |
|---|---|---|
| | | |

## Data flow

The primary user-facing flows traced end to end. If there's only one, name it. If there are multiple (e.g. read path vs. write path, sync vs. async), trace each.

### Flow 1: <name>

```
HTTP request → handler → service → repo → database
            ↓
         response
```

Notable transformations, validation layers, side effects.

### Flow 2: <name>

…

## Configuration surface

Where settings live and where they're consumed.

| Setting | Defined in | Consumed by | Sensitive? |
|---|---|---|---|
| | | | |

Environment variables, config files (`.env`, YAML/JSON config, …), secrets management, feature flags.

## What's working well

Sound architectural decisions to preserve and extend. Not just gaps — positive findings are auditable too, and the next refactor shouldn't blow them away.

- <positive finding>

## Project-Specific

> *(Appended by extensions if applicable.)*
