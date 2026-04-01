This is phase 1 of the init workflow. Do not implement yet.

Read only the minimum context needed to produce an execution plan:

- `PROMPT.md`
- `AGENTS.md`
- `ai/contract.json`
- `ai/rules.md`
- `skills/init-workflow/SKILL.md`
- `skills/feature-shaping/SKILL.md`
- `skills/simplicity-audit/SKILL.md`
- `skills/change-synchronization/SKILL.md`
- the assistant-specific adapter in `ai/`, if present

Load optional skills only if the request in `PROMPT.md` triggers them:

- `skills/test-scope-selection/SKILL.md` for meaningful behavior changes
- `skills/readme-authoring/SKILL.md` when `README.md` must change
- `skills/http-api-conventions/SKILL.md` for `node-service` projects or HTTP endpoint work

Return only:

1. A compact implementation plan with the minimum files that need inspection next.
2. Open questions or assumptions that could change the design.
3. A short list named `Phase 2 reads` with only the files the LLM should load for implementation.

Do not edit files, do not run verification, and do not restate the full contract.
Phase 2 continues in `prompts/init-phase-2-implement.md`.
