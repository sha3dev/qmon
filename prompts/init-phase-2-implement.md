This is phase 2 of the init workflow. Implement the task now.

Read only:

- `PROMPT.md`
- `prompts/init-contract.md`
- the approved phase 1 output
- every file listed under `Phase 2 reads`

Load optional skills only if they are actually needed for the approved plan:

- `skills/test-scope-selection/SKILL.md` for meaningful behavior changes
- `skills/readme-authoring/SKILL.md` when `README.md` changes
- `skills/http-api-conventions/SKILL.md` for `node-service` projects or HTTP endpoint work

Execution rules:

- Follow `prompts/init-contract.md` and `skills/init-workflow/SKILL.md`.
- Keep the scaffold-native structure unless the request explicitly requires a standards update.
- Inspect more files only when the approved plan proves they are necessary.
- Implement the smallest correct change in `src/` and `test/`.
- Rewrite `README.md` only after behavior is stable.
- Do not finish the task in this phase.

Return only:

1. What changed.
2. Any unresolved risks or follow-up needed before verification.
3. The exact commands or checks that phase 3 should run.
