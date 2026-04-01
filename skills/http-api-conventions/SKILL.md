---
name: http-api-conventions
description: Use this skill when a project exposes HTTP endpoints. It defines the standard route design, parameter naming, validation, response shapes, status codes, and README/test expectations for scaffolded HTTP APIs.
---

# HTTP API Conventions

## When To Use

Use this skill whenever a `node-service` project adds, changes, or documents HTTP endpoints.

## Framework And Placement

- Use `hono` only.
- Keep transport concerns under `src/http/`.
- Keep very small route wiring in `src/http/http-server.service.ts` when that remains clear.
- Extract `*.controller.ts` or `*.schema.ts` only when endpoint count or validation complexity justifies them.
- Keep business logic in feature or app services, not in transport handlers.

## Route Design

- Prefer pure REST resource routes.
- Use plural resource names in URL paths.
- Use `kebab-case` path segments.
- Keep code feature folders singular even when route paths are plural.
- Reserve `GET /` for service info, health, or root metadata when the template already uses it.
- Put business routes under `/api/<resource-plural>`.

Examples:

- `GET /`
- `GET /api/users`
- `GET /api/users/:userId`
- `POST /api/users`
- `PATCH /api/users/:userId`
- `DELETE /api/users/:userId`

## Method Rules

- `GET` for retrieval
- `POST` for creation
- `PUT` only for real full replacement
- `PATCH` for partial updates
- `DELETE` for deletion

Defaults:

- prefer `PATCH` over `PUT` unless full replacement semantics are real
- avoid action verbs in paths when a resource-oriented route works
- if a non-REST action is unavoidable, use `POST /api/<resource-plural>/:resourceId/<action-kebab-case>`

## Parameters

### Path Params

- use lowerCamelCase names with `Id` suffix for identifiers
- use semantic names such as `userId` or `invoiceId`
- do not use generic names such as `id`, `item`, or `value`

### Query Params

Use query params only for read modifiers:

- filtering
- pagination
- sorting
- search

Canonical names:

- `page`
- `pageSize`
- `sort`
- `search`
- feature-specific names such as `status`, `fromDate`, `toDate`

Rules:

- keep query params flat
- avoid nested query structures
- avoid ad hoc operator syntax unless current behavior truly requires it

## Request Bodies

- `GET` and `DELETE` must not accept bodies
- `POST`, `PUT`, and `PATCH` use JSON bodies
- bodies should be plain objects by default
- avoid generic `{ data: ... }` wrappers unless there is a current need for metadata

## Success Responses

- return plain JSON payloads by default
- do not introduce a generic transport envelope without current need
- return arrays directly for simple collections
- return metadata objects only when metadata actually exists

Status defaults:

- `GET`: `200`
- `POST` create: `201`
- `PATCH` and `PUT`: `200`
- `DELETE`: `204` with no body
- `POST` async accepted work: `202` only when genuinely asynchronous

For `201` responses:

- include a `Location` header when a canonical resource URL exists and doing so is straightforward

## Error Responses

Use this transport error shape:

```json
{
  "code": "invalid_request",
  "message": "Human-readable explanation"
}
```

Optional:

- `details` only when validation detail is genuinely useful

Canonical error codes:

- `invalid_request`
- `not_found`
- `conflict`
- `internal_error`

Status mapping:

- invalid path, query, body, or header input: `400`
- missing resource: `404`
- state conflict: `409`
- unexpected failure: `500`

Defaults:

- prefer `400` over `422` unless there is an explicit product reason
- keep error responses small and stable
- never leak stack traces or internals

## Validation

- validate path params, query params, and bodies at the HTTP boundary
- keep validation near transport
- use `<feature>.schema.ts` only when validation is non-trivial enough to justify it
- inline trivial validation when it stays compact and obvious
- validation failures must return the standard `400` error shape
- validation logic must not drift into domain services

## README And Tests

Whenever HTTP behavior changes:

- update `## HTTP API`
- document method and path
- document params
- document success status
- document response shape
- document meaningful failure statuses
- keep examples aligned with actual routes and payloads

For meaningful endpoint changes, tests should cover:

- success status
- success payload
- validation failure when applicable
- not-found or conflict behavior when applicable
- `204` no-body behavior when applicable
