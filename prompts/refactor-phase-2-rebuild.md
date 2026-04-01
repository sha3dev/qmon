This is phase 2 of the refactor workflow. Rebuild the domain code now.

Read only:

- `PROMPT.md`
- `prompts/refactor-contract.md`
- the approved phase 1 output
- every file listed under `Phase 2 reads`

Load optional skills only if they are actually needed for the approved plan:

- `skills/test-scope-selection/SKILL.md` for meaningful behavior changes
- `skills/http-api-conventions/SKILL.md` when transport behavior is being preserved or rebuilt
- `skills/readme-authoring/SKILL.md` when `README.md` changes

Execution rules:

- Follow `prompts/refactor-contract.md` and `skills/refactor-workflow/SKILL.md`.
- Preserve only the explicit contracts and preservation decisions.
- Use `.code-standards/refactor-source/latest/` as reference material, not as a structure to copy.
- Keep the fresh scaffold authoritative and simplify where preservation does not require legacy complexity.
- Rewrite `README.md` only after behavior is stable.
- Do not finish the task in this phase.

Return only:

1. What was rebuilt.
2. Any preserved contracts still at risk.
3. The exact commands or checks that phase 3 should run.
