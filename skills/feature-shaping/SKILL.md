---
name: feature-shaping
description: Use this skill when mapping a requested behavior into the scaffold. It defines how to choose the canonical feature boundary, file set, and public surface while rejecting unnecessary layers and files.
---

# Feature Shaping

## When To Use

Use this skill when adding a feature, creating a new module or service, or deciding whether work belongs in an existing feature folder or a new one.

## Read First

- `AGENTS.md`
- `SKILLS.md`
- `ai/contract.json`
- `ai/rules.md`
- `src/index.ts`
- `src/config.ts`

## Workflow

1. Identify the behavior being added and the public impact it creates.
2. Decide whether the behavior belongs in an existing feature or a new feature folder.
3. Choose the smallest file set that can hold the change cleanly.
4. Place logic in the canonical boundary:
   - `src/<feature>/` for feature code
   - `src/app/` only for justified composition
   - `src/http/` only for transport concerns
   - `src/shared/` only for real cross-feature reuse
5. Confirm that the planned structure is no more complex than the template baseline for the same requirement.

## Core Rules

- Prefer extending an existing cohesive feature over creating a new boundary.
- Add new files only when the current requirement justifies them.
- Keep business logic out of transport adapters.
- Define the intended public API impact before implementation, even if that impact is “none”.

## Prohibited Actions

- Do not create helper, wrapper, factory, repository, mapper, schema, or shared files by default.
- Do not create `src/app/` or `src/shared/` for hypothetical future reuse.
- Do not split one cohesive behavior across multiple files for aesthetics alone.
- Do not let feature boundaries follow implementation accidents instead of domain meaning.
