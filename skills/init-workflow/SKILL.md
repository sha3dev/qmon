---
name: init-workflow
description: Use this skill when implementing the first behavior in a freshly generated scaffold. It defines the required execution order, scaffold-preservation rules, and final reporting for init-based work.
---

# Init Workflow

## When To Use

Use this skill when the project was generated with `code-standards init` and the task is to implement new behavior inside the fresh scaffold.

## Read First

- `AGENTS.md`
- `SKILLS.md`
- `ai/contract.json`
- `ai/rules.md`
- `prompts/init-contract.md`
- `src/index.ts`
- `src/config.ts`

## Required Execution Order

1. Inspect the generated scaffold before changing code so the public shape and feature layout stay aligned with the template.
2. Map the requested behavior onto the existing `src/` and `test/` structure before adding files.
3. Implement the smallest correct change inside the scaffold-native structure.
4. Update or add tests for the behavior change.
5. If `README.md` changes, load `skills/readme-authoring/SKILL.md` and rewrite the README after behavior is stable.
6. Run `npm run standards:check`.
7. Fix every `error`, review every `warning`, report every `audit` item, and rerun until the default verification passes.
8. Run `npm run check`.
9. Fix failures and rerun `npm run check` until it passes.

## Prohibited Actions

- Do not replace scaffold structure with an unrelated architecture.
- Do not edit managed files unless the user explicitly asked for a standards update.
- Do not introduce helper layers, wrappers, or extra files unless the current requirement justifies them.
- Do not leave `README.md` as scaffold text when the task changes real behavior.

## Implementation Focus

- Preserve scaffold naming conventions and feature boundaries.
- Keep helper logic inside classes as private or static methods in class-oriented source files.
- Split oversized classes into smaller cohesive units instead of keeping monolithic files.
- Keep generated and edited content in English, including code comments, README text, and examples.

## Final Response Checklist

- List changed files.
- Include a short compliance checklist.
- Provide proof that `npm run check` passed.
