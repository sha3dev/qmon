---
name: test-scope-selection
description: Use this skill when code changes may affect behavior. It defines how to decide whether tests are required, which behavior deserves coverage, and what the minimum adequate test scope is.
---

# Test Scope Selection

## When To Use

Use this skill when implementation changes introduce meaningful logic, regression risk, public contract changes, or runtime behavior changes.

## Decision Rules

Add or update tests when the change affects:

- observable behavior
- public API output
- transport contracts
- configuration-driven behavior
- branching logic
- regression-prone workflows

Do not add ad hoc tests for:

- trivial renames
- purely mechanical edits
- formatting-only changes
- behavior-neutral managed file regeneration

## Coverage Selection

Choose the smallest test set that proves the changed behavior:

1. cover the main success path
2. cover meaningful failure or edge behavior when it exists
3. avoid implementation-detail assertions
4. avoid duplicate tests that protect the same behavior

## Transport Notes

For HTTP changes, cover:

- status code
- response payload
- validation failure when applicable
- not-found or conflict behavior when applicable

## Final Check

If a behavior change would be risky to change again without a test, it should have a test.
