---
name: readme-authoring
description: Use this skill when creating or updating README.md. It defines the required documentation workflow, evidence to collect from the public API, and quality checks for package-grade README output.
---

# README Authoring

## When To Use

Use this skill when the task creates, rewrites, or updates `README.md`.

## Read First

- `AGENTS.md`
- `ai/contract.json`
- `ai/rules.md`
- `README.md`
- `src/index.ts`
- `src/config.ts`

## Workflow

1. Inspect the real public exports from `src/index.ts`.
2. Inspect public class methods that are reachable through the package boundary.
3. Inspect `src/config.ts` and extract each user-facing configuration key and its impact.
4. Inspect scripts, runtime constraints, and actual usage flow before writing prose.
5. Rewrite `README.md` so it matches the real behavior rather than the scaffold.

## Writing Rules

- Write the README in English.
- Write like the package maintainer speaking to another engineer.
- Lead with fast value, runnable commands, and practical examples.
- Keep the README focused on real package or runtime behavior.
- Document every public export from `src/index.ts`.
- If a public export is a class, document each public method with purpose, return value, and behavior notes.
- Include runnable examples that import from the real package boundary.
- Describe configuration in user terms, not as a raw constant dump.

## Avoid

- Do not leave placeholder language, TODOs, or scaffold narration.
- Do not describe the project as generated or templated outside the `AI Workflow` section.
- Do not force the reader to inspect source files to understand the public API.
- Do not claim support, behavior, or setup steps that the code does not implement.

## Validation

- Verify the README still matches the current public API and commands.
- Verify examples are copy-pasteable and aligned with the actual package surface.
- Verify the README reflects the final behavior after code changes, not before them.
