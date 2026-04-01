---
name: refactor-workflow
description: Use this skill when refactoring an existing project or rebuilding legacy code on top of a regenerated scaffold. It defines the required execution order, forbidden actions, and final reporting for scaffold-first refactor work.
---

# Refactor Workflow

## When To Use

Use this skill when the task is to refactor an existing project, rebuild a legacy implementation on top of a regenerated scaffold, or work from `.code-standards/refactor-source/`.

## Read First

- `AGENTS.md`
- `ai/contract.json`
- `ai/rules.md`
- `.code-standards/refactor-source/public-contract.json`
- `.code-standards/refactor-source/preservation.json`
- `.code-standards/refactor-source/analysis-summary.md`

## Required Execution Order

1. Analyze the legacy code and extract only required behavior, preserved contracts, business rules, and edge cases.
2. Treat the snapshot under `.code-standards/refactor-source/latest/` as reference material only.
3. Rebuild the solution in the fresh scaffold under `src/` and `test/`.
4. Compare the planned target structure against the active standards before writing final code.
5. Run `npm run check`.
6. Fix failures in `src/` and `test/` and rerun `npm run check` until it passes.

## Prohibited Actions

- Do not copy legacy files into the new scaffold and make only superficial edits.
- Do not reproduce the legacy folder tree, helper layers, wrappers, plural feature folders, typed errors, or abstraction patterns unless preserved contracts force them.
- Do not restore `AGENTS.md`, `SKILLS.md`, `skills/*`, `ai/*`, `prompts/*`, `.vscode/*`, `biome.json`, `tsconfig*.json`, `package.json`, or lockfiles from the snapshot.
- Do not use `git checkout`, `git restore`, or snapshot copies to roll managed files back.
- Do not preserve unjustified legacy complexity by inertia.

## Implementation Focus

- Prefer the scaffold-native design when legacy structure conflicts with current standards.
- Fold helper logic into private or static class methods in class-oriented source files.
- Split oversized classes into smaller cohesive units instead of keeping monolithic files.
- Keep all generated and edited content in English, including README and code comments.

## Final Response Checklist

- List changed files.
- Include the preserved contracts checklist.
- Note intentionally non-preserved legacy items, if any.
- Provide proof that `npm run check` passed.
