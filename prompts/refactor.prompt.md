This is phase 1 of the refactor workflow. Analyze only. Do not rebuild yet.

Read only the minimum context needed to plan the rewrite:

- `PROMPT.md`
- `AGENTS.md`
- `ai/contract.json`
- `ai/rules.md`
- `skills/refactor-workflow/SKILL.md`
- `skills/feature-shaping/SKILL.md`
- `skills/simplicity-audit/SKILL.md`
- `skills/change-synchronization/SKILL.md`
- `.code-standards/refactor-source/public-contract.json`
- `.code-standards/refactor-source/preservation.json`
- `.code-standards/refactor-source/analysis-summary.md`

Load optional skills only if the request in `PROMPT.md` triggers them:

- `skills/test-scope-selection/SKILL.md` for meaningful behavior changes
- `skills/http-api-conventions/SKILL.md` when transport behavior is being preserved or rebuilt
- `skills/readme-authoring/SKILL.md` when `README.md` must change

Return only:

1. The preserved contracts and risks that matter for the rewrite.
2. A compact rebuild plan that names the minimum legacy files worth opening next.
3. A short list named `Phase 2 reads` with only the files the LLM should load for the rebuild.

Do not edit files, do not run final verification, and do not restate the full contract.
Phase 2 continues in `prompts/refactor-phase-2-rebuild.md`.
