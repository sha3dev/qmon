## Refactor Contract

Use this contract during rebuild and verification phases, not as phase-1 analysis input unless the plan proves it is necessary.

This workflow is a refactor, not a migration-by-copy. You MUST load `skills/refactor-workflow/SKILL.md` and follow it as the primary procedural guide for execution order, prohibitions, and reporting.
You MUST also load `skills/feature-shaping/SKILL.md`, `skills/simplicity-audit/SKILL.md`, and `skills/change-synchronization/SKILL.md` as part of the default refactor workflow.

## Requirements

- You MUST preserve only the contracts explicitly marked for preservation.
- You MUST use the snapshot under `.code-standards/refactor-source/latest/` as reference, not as a structure to copy blindly.
- You MUST treat the freshly regenerated managed files in the project root as authoritative.
- If the refactor changes meaningful behavior, you MUST load `skills/test-scope-selection/SKILL.md`.
- If the refactor rebuilds or documents HTTP transport behavior, you MUST load `skills/http-api-conventions/SKILL.md`.
- If the refactor rewrites `README.md`, you MUST load `skills/readme-authoring/SKILL.md`.
- You MUST execute `npm run check` yourself before finishing.
- If `npm run check` fails, you MUST fix the issues and rerun it until it passes.
- As the final step, you MUST create or update `SCAFFOLD-FEEDBACK.md` in the project root with concrete feedback about scaffold problems, unclear instructions, friction, missing patterns, and suggested improvements.

Finish with:

- changed files
- preserved contracts checklist
- intentionally broken or non-preserved items, if any
- proof that `npm run check` passed
- confirmation that `SCAFFOLD-FEEDBACK.md` was created or updated
