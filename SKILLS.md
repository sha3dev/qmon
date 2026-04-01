# Project Skills

`ai/contract.json` remains the machine-readable source of truth and `AGENTS.md` remains the always-on policy layer.
This file lists specialized workflows that should be loaded only when the task calls for them.

## How To Use Skills

1. Read `AGENTS.md`, `SKILLS.md`, and the relevant assistant adapter before implementation.
2. Open only the `skills/<skill-name>/SKILL.md` file that matches the task.
3. Load extra references only when that skill explicitly calls for them.
4. If a skill conflicts with `ai/contract.json` or `AGENTS.md`, the higher-priority contract wins.

## Default Workflow Skills

- `init-workflow`: Use when implementing the first behavior in a freshly generated scaffold. Read `skills/init-workflow/SKILL.md`.
- `refactor-workflow`: Use when refactoring an existing project or rebuilding legacy code on top of a regenerated scaffold. Read `skills/refactor-workflow/SKILL.md`.
- `feature-shaping`: Use when mapping a requested behavior into the scaffold and choosing the minimum justified structure. Read `skills/feature-shaping/SKILL.md`.
- `simplicity-audit`: Use before finalizing non-trivial changes to remove gratuitous complexity. Read `skills/simplicity-audit/SKILL.md`.
- `change-synchronization`: Use when behavior changes may affect tests, exports, config, scripts, or documentation. Read `skills/change-synchronization/SKILL.md`.

## Conditional Implementation Skills

- `readme-authoring`: Use when creating or updating `README.md` so the package documentation matches the real public behavior. Read `skills/readme-authoring/SKILL.md`.
- `test-scope-selection`: Use when deciding whether behavior changes need tests and what scope those tests should cover. Read `skills/test-scope-selection/SKILL.md`.
- `http-api-conventions`: Use when a project exposes HTTP endpoints and route design, params, validation, and responses must follow the standard service conventions. Read `skills/http-api-conventions/SKILL.md`.
