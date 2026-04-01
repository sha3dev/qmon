## Init Contract

Use this contract during implementation and verification phases, not as phase-1 planning input unless the plan proves it is necessary.

- This workflow is an init-based implementation. You MUST load `skills/init-workflow/SKILL.md` and follow it as the primary procedural guide for execution order and reporting.
- You MUST load `skills/feature-shaping/SKILL.md`, `skills/simplicity-audit/SKILL.md`, and `skills/change-synchronization/SKILL.md` as part of the default init workflow.
- If the task introduces meaningful behavior changes, you MUST load `skills/test-scope-selection/SKILL.md`.
- You MUST preserve the scaffold structure and naming conventions.
- You MUST add or update tests for behavior changes.
- In class-oriented source files, you MUST keep helper logic inside the class as private or static methods rather than module-scope functions.
- You MUST split oversized classes into smaller cohesive units instead of keeping large monolithic class files.
- If the task creates or updates `README.md`, you MUST load `skills/readme-authoring/SKILL.md` and follow it.
- If the project is a `node-service` or the task changes HTTP endpoints, you MUST load `skills/http-api-conventions/SKILL.md` and follow its transport conventions.
- You MUST execute `npm run standards:check` yourself, fix every `error`, review every `warning`, report every `audit` item, and rerun until the default verification passes.
- You MUST let Biome decide final layout and wrapping.
- You MUST execute `npm run check` yourself before finishing.
- If `npm run check` fails, you MUST fix the issues and rerun it until it passes.
- As the final step, you MUST create or update `SCAFFOLD-FEEDBACK.md` in the project root with concrete feedback about scaffold problems, unclear instructions, friction, missing patterns, and suggested improvements.

When you respond after implementation, include:

- changed files
- a short compliance checklist
- proof that `npm run check` passed
- confirmation that `SCAFFOLD-FEEDBACK.md` was created or updated
