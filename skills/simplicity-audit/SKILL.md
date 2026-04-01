---
name: simplicity-audit
description: Use this skill before and after non-trivial implementation work. It defines the required anti-complexity review that removes gratuitous files, layers, wrappers, and speculative configuration before finalizing code.
---

# Simplicity Audit

## When To Use

Use this skill before finalizing non-trivial implementation, especially when adding files, abstractions, classes, configuration, or transport layers.

## Audit Pass

Ask these questions in order:

1. Can the same behavior be implemented with fewer files?
2. Can a helper stay as a private or static method instead of becoming a new file?
3. Does each abstraction solve a real current complexity problem?
4. Does the design still look as direct as the template baseline?
5. Did any new config key, type, or wrapper appear without a real consumer?

## Remove First

- speculative factories
- wrapper services
- unused option objects
- premature `*.types.ts` files
- helper files that should stay inside a class
- transport or domain layers with only pass-through behavior
- configuration added for unimplemented scenarios

## Keep Only When Justified

- role-specific extra files with a clear current responsibility
- true cross-feature modules
- validation schemas with non-trivial validation logic
- public types that materially clarify the contract

## Final Check

Before finishing, compare the final structure to the simplest plausible design that still respects current boundaries. If the simpler design is still correct, the simpler design wins.
