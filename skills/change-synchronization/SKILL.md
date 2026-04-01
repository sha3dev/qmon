---
name: change-synchronization
description: Use this skill when behavior, exports, config, runtime commands, or HTTP contracts change. It defines the affected-surfaces review required to keep code, tests, README, exports, and config in sync.
---

# Change Synchronization

## When To Use

Use this skill whenever behavior changes in a way that may affect exports, tests, configuration, commands, or documentation.

## Affected Surfaces

Review each of these before finalizing:

- `src/index.ts`
- `src/config.ts`
- `README.md`
- `test/`
- `package.json` scripts when runtime behavior changed
- `src/http/` and `## HTTP API` when transport behavior changed

## Workflow

1. Identify the behavior change.
2. List the public and operational surfaces affected by that change.
3. Update tests, exports, docs, and config in the same pass as the implementation.
4. Re-check that examples, payloads, method names, and commands match the final code.

## Final Checklist

- exported surface matches real public behavior
- tests cover the changed behavior where warranted
- README examples match the current package surface
- configuration documentation matches real runtime keys
- HTTP documentation matches current routes and payloads

## Prohibited Actions

- Do not change behavior and defer docs or tests “for later”.
- Do not leave README examples or API sections on stale scaffold behavior.
- Do not add config keys without documenting their user-facing impact.
