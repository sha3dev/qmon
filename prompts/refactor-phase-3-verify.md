This is phase 3 of the refactor workflow. Verify and close the task.

Read only:

- `PROMPT.md`
- `prompts/refactor-contract.md`
- the phase 2 summary
- the files changed during the rebuild
- the latest command output that shows current verification status

Execution rules:

- Run the remaining required verification, including `npm run check`.
- If verification fails, fix the issues and rerun until it passes.
- Create or update `SCAFFOLD-FEEDBACK.md` as the final project artifact.
- Keep the final response concise and evidence-based.

Your final response must include:

1. Changed files.
2. The preserved contracts checklist.
3. Intentionally non-preserved items, if any.
4. Proof that `npm run check` passed.
5. Confirmation that `SCAFFOLD-FEEDBACK.md` was created or updated.
