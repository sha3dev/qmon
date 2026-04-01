# Project Rules

Read this file together with `AGENTS.md` and `ai/contract.json` before making implementation changes.

## Core Rules

- Treat `ai/contract.json` as the machine-readable source of truth.
- Treat `AGENTS.md` as blocking local policy.
- Treat `SKILLS.md` and `skills/*` as specialized workflow guidance that applies when the task matches that workflow.
- Keep managed files read-only unless the user explicitly requests a standards update.
- Managed files are ignored by Biome by default; do not remove those ignores just to lint contract or prompt artifacts during feature work.
- Run `npm run check` yourself before finishing and fix any failures before you stop.
- Fix every `error`, review every `warning`, and report every `audit` item.

## Simplicity

- Choose the simplest correct design for the current requirement.
- Do not add speculative abstractions, helper layers, wrappers, or extension points without immediate need.
- Do not use simplicity as a reason to remove valid responsibility boundaries.

## Compactness

- Let Biome decide the final line wrapping.
- Prefer compact code when writing or refactoring, but do not force single-line objects, callbacks, or other constructs that Biome keeps multiline.
- Do not split code into multiple lines just because it is “safer”, and do not manually collapse formatter-preserved multiline layouts.
- `verify` must not be treated as authority over code layout when Biome can rewrite that layout.

## Simple Callbacks

- Prefer concise arrow callbacks in `map`, `filter`, `reduce`, `some`, `every`, `find`, and `forEach` when writing new code.
- Do not rewrite Biome-stable block-bodied callbacks solely to satisfy a style preference.

## Errors

- Throw plain `Error` by default.
- Use custom error types only when other code must distinguish failure kinds.
- Do not add error hierarchies without a real consumer.

## Transport Pragmatism

- `single-return` stays strict across `src/` except for `src/http/**`.
- In `src/http/**`, prefer the clearest handler flow for validation, auth, and response branching, including early returns when they reduce nesting.

## Type Files

- Keep small or local types close to the code that uses them.
- Create `*.types.ts` only when shared feature types are substantial enough to justify a dedicated file.

## Feature Classes

- Inside `src/<feature>/`, files MUST expose exactly one public class unless the file is `*.types.ts`.
- Do not implement feature modules as exported function collections.
- If a file exposes a public class, helper logic MUST stay inside that class as private or static methods instead of module-scope functions.
- Large classes MUST be decomposed into smaller cohesive units before they become monolithic files.

## Active Deterministic Rules

- `single-return`: Functions and methods outside src/http/ must use a single return statement. (severity: error, enforced by: verify, confidence: high)
- `async-await-only`: Asynchronous code in src/ must use async/await instead of promise chains. (severity: error, enforced by: verify, confidence: high)
- `one-public-class-per-file`: Each source file may expose at most one public class. (severity: error, enforced by: verify, confidence: high)
- `feature-class-only`: Files inside src/<feature>/ must expose exactly one public class, except .types.ts files. (severity: error, enforced by: verify, confidence: high)
- `class-section-order`: Files that expose a public class must include valid ordered @section markers and omit empty section blocks. (severity: error, enforced by: verify, confidence: high)
- `canonical-config-import`: Imports of config.ts must use the config identifier and include the .ts extension. (severity: error, enforced by: verify, confidence: high)
- `domain-specific-identifiers`: New identifiers must avoid generic names such as data, obj, tmp, val, thing, helper, utils, and common. (severity: error, enforced by: verify, confidence: high)
- `boolean-prefix`: Boolean variables and properties must start with is, has, can, or should. (severity: error, enforced by: verify, confidence: high)
- `feature-filename-role`: Feature files must use the feature name plus an explicit role suffix such as .service.ts or .types.ts. (severity: error, enforced by: verify, confidence: high)
- `no-module-functions-in-class-files`: Files that expose a public class must not keep helper functions at module scope; that logic must live inside the class as private or static methods. (severity: error, enforced by: verify, confidence: high)
- `typescript-only`: Implementation and test code must stay in TypeScript files only. (severity: error, enforced by: verify, biome, confidence: high)
- `kebab-case-paths`: Source and test paths must use kebab-case names for files and directories unless explicitly reserved. (severity: error, enforced by: verify, confidence: high)
- `singular-feature-folders`: Feature folder names under src/ must be singular unless they are reserved structural folders. (severity: error, enforced by: verify, confidence: high)
- `test-file-naming`: Tests must live under test/ and use the .test.ts suffix. (severity: error, enforced by: verify, confidence: high)
- `module-constant-case`: Module-level constants must use SCREAMING_SNAKE_CASE except for the canonical config and logger exports. (severity: error, enforced by: verify, confidence: high)
- `local-constant-case`: Local constants must use camelCase names. (severity: error, enforced by: verify, confidence: high)
- `config-default-export-name`: src/config.ts must export a default object named config. (severity: error, enforced by: verify, confidence: high)
- `no-any`: Explicit any is forbidden in source and tests. (severity: error, enforced by: verify, confidence: high)
- `explicit-export-return-types`: Exported functions and public methods of exported classes must declare explicit return types. (severity: error, enforced by: verify, confidence: high)
- `type-only-imports`: Imports used only in type positions must use import type. (severity: error, enforced by: verify, confidence: high)
- `prefer-types-over-interfaces`: Interfaces are forbidden for local modeling unless they are part of the public contract exported from src/index.ts. (severity: error, enforced by: verify, confidence: high)
- `control-flow-braces`: if, else, for, while, and do blocks must always use braces. (severity: error, enforced by: verify, confidence: high)
- `cross-feature-entrypoint-imports`: Cross-feature imports must go through an explicit feature entrypoint rather than another feature's internal file. (severity: error, enforced by: verify, confidence: high)
- `ambiguous-feature-filenames`: Feature code must not use ambiguous file names such as helpers.ts, utils.ts, or common.ts. (severity: error, enforced by: verify, confidence: high)
- `typed-error-must-be-used`: Custom error types must be consumed by logic that distinguishes them from plain failures. (severity: error, enforced by: verify, confidence: high)
- `no-silent-catch`: Catch blocks must rethrow, transform, or report errors instead of silently swallowing them. (severity: error, enforced by: verify, confidence: high)
- `node-test-runner-only`: Test files must use node:test instead of alternative runners. (severity: error, enforced by: verify, confidence: high)
- `assert-strict-preferred`: Tests must use node:assert/strict for assertions. (severity: error, enforced by: verify, confidence: high)
- `no-ts-ignore-bypass`: TypeScript and Biome ignore directives must not be used to bypass real issues in source or tests. (severity: error, enforced by: verify, confidence: high)
- `readme-sections`: README.md must keep the required sections for setup, API, config, troubleshooting, and AI workflow. (severity: error, enforced by: verify, confidence: high)
- `readme-config-coverage`: README must document each top-level configuration key exposed from src/config.ts. (severity: error, enforced by: verify, confidence: high)
- `required-scripts`: Generated projects must expose the required standards, lint, format, typecheck, test, and check scripts. (severity: error, enforced by: verify, confidence: high)
- `standards-check-script`: npm run standards:check must execute code-standards verify. (severity: error, enforced by: verify, confidence: high)
- `package-exports-alignment`: Generated projects must stay aligned with @sha3/code-standards biome and tsconfig exports. (severity: error, enforced by: verify, confidence: high)

## Active Heuristic Rules

- `concise-simple-callbacks`: Prefer concise arrow callbacks when Biome already keeps them concise; do not rewrite formatter-stable block callbacks just for style. (severity: warning, enforced by: guidance, confidence: medium)
- `compact-single-line-constructs`: Prefer compact layouts, but let Biome decide final wrapping instead of forcing single-line constructs the formatter keeps multiline. (severity: warning, enforced by: guidance, confidence: medium)
- `feature-first-layout`: Projects with feature modules must keep domain code under feature folders instead of mixing flat modules at src/ root. (severity: warning, enforced by: verify, confidence: medium)
- `restricted-shared-boundaries`: src/app and src/shared should exist only when real composition or cross-feature sharing justifies them. (severity: warning, enforced by: verify, confidence: medium)
- `types-file-justification`: Dedicated .types.ts files should only exist when they contain substantial shared feature types. (severity: warning, enforced by: verify, confidence: medium)
- `plain-error-default`: Plain Error must be used by default; custom error types require a real control-flow consumer. (severity: warning, enforced by: guidance, confidence: medium)
- `actionable-error-messages`: Error messages should include actionable context rather than empty or generic text. (severity: warning, enforced by: verify, confidence: medium)
- `test-determinism-guards`: Tests should avoid uncontrolled time, randomness, real network calls, and un-restored process.env mutation. (severity: warning, enforced by: verify, confidence: medium)
- `readme-no-placeholder-language`: README content must not look like a scaffold placeholder or contain TODO-style filler text. (severity: warning, enforced by: verify, confidence: medium)
- `readme-runnable-examples`: README must include plausible runnable code or command examples instead of abstract placeholders. (severity: warning, enforced by: verify, confidence: medium)
- `no-speculative-abstractions`: Factories, options types, wrappers, and helper layers should not exist without a real current consumer or complexity reduction. (severity: warning, enforced by: guidance, confidence: medium)
- `single-responsibility-heuristic`: Long functions and methods should be split when they appear to mix multiple responsibilities. (severity: warning, enforced by: verify, confidence: medium)
- `large-class-heuristic`: Very large classes should be decomposed into smaller cohesive units instead of accumulating unrelated responsibilities in one file. (severity: warning, enforced by: verify, confidence: medium)

## Active Audit Rules

- `managed-files-read-only`: Managed contract and tooling files must not be edited during normal feature work. (severity: audit, enforced by: verify, confidence: medium)
- `behavior-change-tests`: Behavior changes must update or add tests, and tests should focus on observable behavior. (severity: audit, enforced by: verify, confidence: medium)
- `simplicity-audit`: Projects should avoid needless layers, wrappers, and extra files when a smaller direct implementation would suffice. (severity: audit, enforced by: guidance, confidence: medium)
- `comments-policy-audit`: Non-trivial logic should include explicit comments when the profile requires extensive comments. (severity: audit, enforced by: verify, confidence: medium)
