# API Contract Rules

Every time you call a backend API endpoint, follow these rules to avoid 400 validation errors.

## 1. Check the Zod Schema First

Before writing any `customFetch()` call, read the backend route file in `artifacts/api-server/src/routes/` to find the exact `z.object({...})` schema. The frontend payload MUST match the Zod types exactly.

## 2. Null vs Undefined

This is the most common source of bugs. Zod distinguishes between `.optional()` and `.nullable()`:

| Zod type | Accepts | Rejects |
|---|---|---|
| `z.string().optional()` | `string \| undefined` | `null` |
| `z.string().nullable().optional()` | `string \| null \| undefined` | — |
| `z.number().optional()` | `number \| undefined` | `null` |
| `z.number().nullable().optional()` | `number \| null \| undefined` | — |

**Rule:** When the schema uses `.optional()` (not `.nullable()`), never send `null`. Omit the key instead using spread:

```ts
...(value != null ? { field: value } : {})
```

When the schema uses `.nullable().optional()`, you CAN send `null`.

## 3. CamelCase vs Snake_case

The backend is inconsistent — always read the actual Zod schema to check:

- `POST /api/projects` uses **camelCase**: `designedBy`, `moduleName`, `designDate`, `testLink`, `testLeadId`
- `PUT /api/projects/:id` uses **snake_case**: `designed_by`, `module_name`, `design_date`
- `POST /api/projects/:id/users` uses **camelCase**: `userId` (not `user_id`)
- `POST /api/test-cases` uses **snake_case**: `use_case_id`, `case_number`

Don't guess — read the Zod schema.

## 4. Query Parameters vs Body

Some endpoints read values from query parameters, not the body:

- `POST /api/use-cases?projectId=X` — `projectId` is a query param, not in the body
- `GET /api/use-cases?projectId=X` — same
- `DELETE /api/use-cases/:id` — `projectId` is NOT needed (derived from the record)

## 5. 204 Responses

DELETE endpoints return 204 with no body. Use `customFetch<void>(...)` and never parse the response.

## 6. Required Fields

Always check which fields are required (no `.optional()`):
- `POST /api/projects`: `name`, `designedBy`, `moduleName`, `designDate`, `testLeadId` are ALL required
- `POST /api/test-cases`: `case_number`, `title` are required
- `POST /api/test-steps`: `step_number`, `instruction` are required
- `POST /api/use-cases?projectId=X`: `code`, `name` are required (body)

## 7. Enum Values

If a field uses `z.enum([...])`, you MUST send exactly one of the listed values — case-sensitive.
