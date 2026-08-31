# Airscale FullEnrich-Inspired OpenAPI Reference Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the separate Airscale Mintlify preview from 16 manually authored pages into an OpenAPI 3.1-backed reference with 15 first-class public operations across 18 pages, native POST/GET markers, and responsive cURL, Node.js, and Python request examples.

**Architecture:** Keep Airscale application code authoritative at the already-audited source SHA. Add a machine-readable operation catalog and a deterministic OpenAPI builder whose committed output is `/openapi.json`. Mintlify MDX wrappers point at one exact method/path each and retain only durable operational guidance; request fields, response fields, authentication, status codes, and generated examples come from OpenAPI. Tests fail closed on source-pin drift, operation/page mismatch, invalid schemas or examples, unsafe fixtures, generated-file drift, and preview-safety regressions.

**Tech Stack:** OpenAPI 3.1, Node.js ESM, Node test runner, `@apidevtools/swagger-parser`, Ajv 2020, JSON, MDX, Mintlify `docs.json`, Mint CLI, Git.

---

## Scope and hard boundary

This is Plan 2 of the approved four-plan knowledge-base design. Plan 1 is complete at docs repository SHA `6abaf679d4b05d55fd81686059ec30d299d71a6e` and the current preview foundation remains available at `https://airscale.mintlify.app`.

This plan does **not**:

- change `docs.airscale.io`, DNS, redirects, or the Framer deployment;
- build the two-path product-guide homepage (Plan 3);
- build `skill.md`, API catalog, or custom AI indexes (Plan 4);
- enable a live `Try it` action;
- call an Airscale API endpoint, spend credits, consume provider quota, or mutate production data;
- expose internal routes, provider details, real credentials, or production-returned personal data.

The only publication target allowed after a separately approved merge/deploy step is `https://airscale.mintlify.app`. The preview stays `noindex, follow` and its canonicals stay on the preview host.

## Source authority and fixed counts

- Application repository: `ViceScale/airscale-code`
- Pinned application source SHA: `8606866a5fb1f9405a94d49cfa9fbddaf4aaf431`
- Approved public operations: **15**
- OpenAPI operation wrappers: **15**
- Non-operation guide pages: **3** (`api-overview`, `authentication`, `rate-limits`)
- Total API-reference pages after the split: **18**
- Methods: **14 POST**, **1 GET**

The two new wrapper routes are:

- `api-reference/find-people/count` for `POST /v1/find-people/count`
- `api-reference/find-companies/filter-values` for `GET /v1/find-companies/filter-values`

## Approved operation map

| Tag | Method | Path | Operation ID | MDX route | Existing source page |
| --- | --- | --- | --- | --- | --- |
| Account | POST | `/v1/credits` | `getCredits` | `api-reference/credit-count` | `credit-count` |
| Contact data | POST | `/v1/email` | `findProfessionalEmail` | `api-reference/email-finder` | `email-finder` |
| Contact data | POST | `/v1/email-bulk` | `findProfessionalEmailsBulk` | `api-reference/email-finder-(bulk)` | `email-finder-(bulk)` |
| Contact data | POST | `/v1/phone` | `findMobilePhone` | `api-reference/mobile-finder` | `mobile-finder` |
| Contact data | POST | `/v1/personal-email` | `findPersonalEmail` | `api-reference/personal-email` | `personal-email` |
| Contact data | POST | `/v1/url-search-people` | `findPeopleProfileUrl` | `api-reference/people-url-finder` | `people-url-finder` |
| Profiles and reverse lookup | POST | `/v1/profile` | `extractPersonProfile` | `api-reference/extract-people-profile` | `extract-people-profile` |
| Profiles and reverse lookup | POST | `/v1/company` | `extractCompanyProfile` | `api-reference/extract-company-profile` | `extract-company-profile` |
| Profiles and reverse lookup | POST | `/v1/reverse-email` | `reverseEmailLookup` | `api-reference/reverse-email` | `reverse-email` |
| Profiles and reverse lookup | POST | `/v1/reverse-phone` | `reversePhoneLookup` | `api-reference/reverse-phone` | `reverse-phone` |
| Search and discovery | POST | `/v1/find-people` | `findPeople` | `api-reference/find-people` | `find-people` |
| Search and discovery | POST | `/v1/find-people/count` | `countPeople` | `api-reference/find-people/count` | `find-people` |
| Search and discovery | POST | `/v1/find-companies` | `findCompanies` | `api-reference/find-companies` | `find-companies` |
| Search and discovery | GET | `/v1/find-companies/filter-values` | `listFindCompanyFilterValues` | `api-reference/find-companies/filter-values` | `find-companies` |
| Search and discovery | POST | `/v1/airsearch` | `airsearch` | `api-reference/airsearch` | `airsearch` |

`api-overview` may link to `POST /v1/credits`, but it is a guide and must not be counted as a second operation wrapper.

## File map

### Create

- `contracts/public-api-operations.json` — exact operation-to-wrapper/source map.
- `openapi/base.mjs` — OpenAPI metadata, server, tags, security, and shared schemas.
- `openapi/operations/account.mjs` — credit operation.
- `openapi/operations/contact-data.mjs` — five contact-data operations.
- `openapi/operations/profile-lookup.mjs` — four profile/reverse operations.
- `openapi/operations/search-discovery.mjs` — five search/discovery operations.
- `scripts/build-openapi.mjs` — deterministic builder and `--check` drift gate.
- `openapi.json` — committed deterministic public OpenAPI 3.1 output.
- `tests/openapi.test.mjs` — structure, coverage, source-pin, wrapper, and generation tests.
- `tests/openapi-examples.test.mjs` — dereferenced request/response example validation.
- `api-reference/find-people/count.mdx` — Count people wrapper.
- `api-reference/find-companies/filter-values.mdx` — Filter values wrapper.

### Modify

- `package.json` and `package-lock.json` — exact validation dependencies and scripts.
- `contracts/public-api-contracts.json` — keep page evidence but explicitly reference the operation catalog.
- `tests/contracts.test.mjs` — validate 15 unique operations instead of inferring them from 16 pages.
- `docs.json` — OpenAPI, non-executing examples, and 18-page navigation.
- The 13 existing operation MDX pages — add one `openapi` frontmatter binding and remove duplicated wire-contract prose/examples.
- `api-reference/find-people.mdx` and `api-reference/find-companies.mdx` — retain only their primary operations and link to new child pages.
- `api-reference/api-overview.mdx`, `api-reference/authentication.mdx`, and `api-reference/rate-limits.mdx` — update links only when necessary; they remain guide pages without `openapi` frontmatter.
- `tests/site.test.mjs` — replace manual-schema/method-badge assertions with wrapper/content-system assertions.
- `tests/preview-safety.test.mjs` — update the recursive canonical page count from 16 to 18.

### Read only

- `/Users/victordetraz/Documents/Code-Claude/Airscale-code` at application SHA `8606866a5fb1f9405a94d49cfa9fbddaf4aaf431`.
- `docs/superpowers/specs/2026-08-30-airscale-knowledge-base-design.md`.
- `contracts/publication-policy.json` and `inventory/framer-routes.json`.
- `docs/chrome-mcp-testing-best-practices.md` before visual browser QA.

---

### Task 1: Normalize the 15-operation contract catalog

**Files:**

- Create: `contracts/public-api-operations.json`
- Modify: `contracts/public-api-contracts.json`
- Modify: `tests/contracts.test.mjs`

- [ ] **Step 1: Write the failing operation-catalog tests**

Add these constants and tests to `tests/contracts.test.mjs`:

```js
const EXPECTED_OPERATIONS = [
  ["POST", "/v1/credits", "getCredits", "api-reference/credit-count", "Account"],
  ["POST", "/v1/email", "findProfessionalEmail", "api-reference/email-finder", "Contact data"],
  ["POST", "/v1/email-bulk", "findProfessionalEmailsBulk", "api-reference/email-finder-(bulk)", "Contact data"],
  ["POST", "/v1/phone", "findMobilePhone", "api-reference/mobile-finder", "Contact data"],
  ["POST", "/v1/personal-email", "findPersonalEmail", "api-reference/personal-email", "Contact data"],
  ["POST", "/v1/url-search-people", "findPeopleProfileUrl", "api-reference/people-url-finder", "Contact data"],
  ["POST", "/v1/profile", "extractPersonProfile", "api-reference/extract-people-profile", "Profiles and reverse lookup"],
  ["POST", "/v1/company", "extractCompanyProfile", "api-reference/extract-company-profile", "Profiles and reverse lookup"],
  ["POST", "/v1/reverse-email", "reverseEmailLookup", "api-reference/reverse-email", "Profiles and reverse lookup"],
  ["POST", "/v1/reverse-phone", "reversePhoneLookup", "api-reference/reverse-phone", "Profiles and reverse lookup"],
  ["POST", "/v1/find-people", "findPeople", "api-reference/find-people", "Search and discovery"],
  ["POST", "/v1/find-people/count", "countPeople", "api-reference/find-people/count", "Search and discovery"],
  ["POST", "/v1/find-companies", "findCompanies", "api-reference/find-companies", "Search and discovery"],
  ["GET", "/v1/find-companies/filter-values", "listFindCompanyFilterValues", "api-reference/find-companies/filter-values", "Search and discovery"],
  ["POST", "/v1/airsearch", "airsearch", "api-reference/airsearch", "Search and discovery"]
];

test("operation catalog pins 15 unique public operations to the audited source", () => {
  const catalog = JSON.parse(readFileSync("contracts/public-api-operations.json", "utf8"));
  assert.equal(catalog.sourceRepository, "ViceScale/airscale-code");
  assert.equal(catalog.sourceSha, EXPECTED_SOURCE_SHA);
  assert.equal(catalog.operations.length, 15);
  assert.deepEqual(
    catalog.operations.map(({ method, path, operationId, page, tag }) => [method, path, operationId, page, tag]),
    EXPECTED_OPERATIONS
  );
  assert.equal(new Set(catalog.operations.map(({ method, path }) => `${method} ${path}`)).size, 15);
  assert.equal(new Set(catalog.operations.map(({ operationId }) => operationId)).size, 15);
  assert.equal(new Set(catalog.operations.map(({ page }) => page)).size, 15);
});

test("every operation keeps source evidence from the page contract manifest", () => {
  const pageContracts = JSON.parse(readFileSync("contracts/public-api-contracts.json", "utf8"));
  const catalog = JSON.parse(readFileSync("contracts/public-api-operations.json", "utf8"));
  for (const operation of catalog.operations) {
    const evidence = pageContracts.pages[operation.sourcePage];
    assert.ok(evidence, `${operation.operationId} must name a source page`);
    assert.ok(
      evidence.endpoints.some(({ method, path }) => method === operation.method && path === operation.path),
      `${operation.operationId} must match its source page endpoint`
    );
    assert.deepEqual(operation.sourceFiles, evidence.sourceFiles);
  }
});
```

- [ ] **Step 2: Run the focused test and verify the missing-file failure**

```bash
node --test tests/contracts.test.mjs
```

Expected: existing manifest tests pass; the new tests fail with `ENOENT` for `contracts/public-api-operations.json`.

- [ ] **Step 3: Create the exact operation catalog**

Create `contracts/public-api-operations.json` with the top-level keys `sourceRepository`, `sourceSha`, and `operations`. Each operation must copy its five tuple values from `EXPECTED_OPERATIONS`, add `sourcePage`, and copy the exact `sourceFiles` array from `contracts/public-api-contracts.json`.

Use this object shape for every entry; do not add schema prose to this routing catalog:

```json
{
  "method": "POST",
  "path": "/v1/email",
  "operationId": "findProfessionalEmail",
  "page": "api-reference/email-finder",
  "tag": "Contact data",
  "sourcePage": "email-finder",
  "sourceFiles": [
    "workers/public-api/v2-waterfall-email.js",
    "workers/public-api/v2-waterfall-email.test.mjs"
  ]
}
```

The array order must match `EXPECTED_OPERATIONS`; this becomes the stable order used by the deterministic builder and navigation tests.

- [ ] **Step 4: Link the existing page manifest to the operation catalog**

Add this top-level field after `sourceSha` in `contracts/public-api-contracts.json`:

```json
"operationCatalog": "contracts/public-api-operations.json",
```

Update the exact-manifest assertion in `tests/contracts.test.mjs` to require that value without changing the existing source SHA or page evidence.

- [ ] **Step 5: Run the focused tests**

```bash
node --test tests/contracts.test.mjs
```

Expected: all contract tests pass, with exactly 15 method/path pairs and 15 wrapper routes.

- [ ] **Step 6: Commit the catalog**

```bash
git add contracts/public-api-operations.json contracts/public-api-contracts.json tests/contracts.test.mjs
git commit -m "docs: normalize public API operation catalog"
```

---

### Task 2: Add the deterministic OpenAPI builder and validation toolchain

**Files:**

- Create: `openapi/base.mjs`
- Create: `openapi/operations/account.mjs`
- Create: `openapi/operations/contact-data.mjs`
- Create: `openapi/operations/profile-lookup.mjs`
- Create: `openapi/operations/search-discovery.mjs`
- Create: `scripts/build-openapi.mjs`
- Create: `tests/openapi.test.mjs`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Add exact development dependencies and scripts**

Run:

```bash
npm install --save-dev --save-exact @apidevtools/swagger-parser@12.1.0 ajv@8.20.0 ajv-formats@3.0.1
```

Add these scripts to `package.json`:

```json
"openapi:build": "node scripts/build-openapi.mjs --write",
"openapi:check": "node scripts/build-openapi.mjs --check",
```

Change `validate` to:

```json
"validate": "npm run openapi:check && npm test && npm run mint:validate"
```

- [ ] **Step 2: Write the failing base-spec tests**

Create `tests/openapi.test.mjs` with base metadata and injected-fixture builder tests. Do not read `openapi.json` yet because the complete generated artifact is deliberately created in Task 5.

```js
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { baseSpec } from "../openapi/base.mjs";
import { buildSpec } from "../scripts/build-openapi.mjs";

const SOURCE_SHA = "8606866a5fb1f9405a94d49cfa9fbddaf4aaf431";

test("OpenAPI base is 3.1 and pinned to the audited application SHA", () => {
  assert.equal(baseSpec.openapi, "3.1.0");
  assert.equal(baseSpec.info.title, "Airscale Public API");
  assert.equal(baseSpec.info.version, "2026-08-30");
  assert.equal(baseSpec.info["x-airscale-source-repository"], "ViceScale/airscale-code");
  assert.equal(baseSpec.info["x-airscale-source-sha"], SOURCE_SHA);
  assert.deepEqual(baseSpec.servers, [{ url: "https://api.airscale.io", description: "Production" }]);
});

test("OpenAPI base applies bearer authentication globally", () => {
  assert.deepEqual(baseSpec.security, [{ bearerAuth: [] }]);
  assert.deepEqual(baseSpec.components.securitySchemes.bearerAuth, {
    type: "http",
    scheme: "bearer",
    bearerFormat: "API key",
    description: "Use an Airscale workspace API key. Never expose the key in client-side code."
  });
});

test("builder inserts injected operations in catalog order", () => {
  const fixtureCatalog = {
    operations: [
      { method: "POST", path: "/v1/second", operationId: "second" },
      { method: "GET", path: "/v1/first", operationId: "first" }
    ]
  };
  const fixtureOperations = [[
    { method: "GET", path: "/v1/first", operation: { operationId: "first", responses: { "200": { description: "OK" } } } },
    { method: "POST", path: "/v1/second", operation: { operationId: "second", responses: { "200": { description: "OK" } } } }
  ]];
  assert.deepEqual(Object.keys(buildSpec({ catalog: fixtureCatalog, operationModules: fixtureOperations }).paths), [
    "/v1/second",
    "/v1/first"
  ]);
});

test("builder rejects an unsupported command", () => {
  const result = spawnSync(process.execPath, ["scripts/build-openapi.mjs", "--unsupported"], { encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /Unsupported argument: --unsupported/);
});
```

- [ ] **Step 3: Run the focused test and verify the missing-module failure**

```bash
node --test tests/openapi.test.mjs
```

Expected: FAIL because `openapi/base.mjs` and `scripts/build-openapi.mjs` do not exist.

- [ ] **Step 4: Create the base module**

Create `openapi/base.mjs` exporting `baseSpec` with this exact public metadata:

```js
export const baseSpec = {
  openapi: "3.1.0",
  info: {
    title: "Airscale Public API",
    version: "2026-08-30",
    description: "Search, enrich, and resolve public business data with Airscale.",
    "x-airscale-source-repository": "ViceScale/airscale-code",
    "x-airscale-source-sha": "8606866a5fb1f9405a94d49cfa9fbddaf4aaf431"
  },
  servers: [{ url: "https://api.airscale.io", description: "Production" }],
  tags: [
    { name: "Search and discovery", description: "Search people, companies, and the web." },
    { name: "Contact data", description: "Find professional and personal contact data." },
    { name: "Profiles and reverse lookup", description: "Extract profiles or resolve a person from known contact data." },
    { name: "Account", description: "Inspect workspace account state." }
  ],
  security: [{ bearerAuth: [] }],
  paths: {},
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "API key",
        description: "Use an Airscale workspace API key. Never expose the key in client-side code."
      }
    },
    schemas: {
      Error: {
        type: "object",
        additionalProperties: true,
        properties: {
          error: { type: "string" },
          message: { type: "string" }
        }
      }
    },
    responses: {
      Unauthorized: {
        description: "The Bearer token is missing or invalid.",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } }
      }
    }
  }
};
```

- [ ] **Step 5: Create the deterministic builder**

Create `scripts/build-openapi.mjs`. It must:

1. import `baseSpec` and the four operation arrays;
2. deep-clone `baseSpec`;
3. insert operations in catalog order;
4. reject duplicate method/path pairs or operation IDs;
5. serialize with `JSON.stringify(spec, null, 2) + "\n"`;
6. write `openapi.json` only for `--write`;
7. compare byte-for-byte and exit non-zero for missing/stale output in `--check`;
8. export `buildSpec({ catalog, operationModules, base } = {})` for injected-fixture tests, with repository defaults when arguments are omitted;
9. reject any CLI argument other than `--write` or `--check`.
10. execute CLI behavior only when `import.meta.url` matches the invoked script, so importing `buildSpec` has no write/check side effect.

Use this insertion contract:

```js
const operationModules = [accountOperations, contactDataOperations, profileLookupOperations, searchDiscoveryOperations];
const byKey = new Map(operationModules.flat().map((entry) => [`${entry.method} ${entry.path}`, entry]));

for (const expected of catalog.operations) {
  const key = `${expected.method} ${expected.path}`;
  const entry = byKey.get(key);
  if (!entry) throw new Error(`Missing OpenAPI operation module entry: ${key}`);
  if (entry.operation.operationId !== expected.operationId) throw new Error(`Operation ID drift: ${key}`);
  spec.paths[entry.path] ??= {};
  spec.paths[entry.path][entry.method.toLowerCase()] = entry.operation;
}
```

Create the four operation modules initially with empty exported arrays. Repository-default `buildSpec()` must fail closed on the first missing catalog operation, while injected complete fixtures can exercise builder mechanics. Do not create or commit `openapi.json` until Tasks 3-5 populate all operations.

- [ ] **Step 6: Add builder behavior tests**

Add tests that call `buildSpec()` with injected catalogs/modules and assert:

- catalog order controls insertion order;
- duplicate method/path and duplicate operation ID fixtures throw;
- missing catalog operations throw;
- extra module operations not present in the catalog throw;
- unknown CLI arguments exit non-zero without writing a file;
- `--check` fails before `openapi.json` exists.

- [ ] **Step 7: Run the focused builder tests**

```bash
node --test tests/openapi.test.mjs
```

Expected: all base and injected-fixture builder tests pass. A direct repository-default `buildSpec()` and `npm run openapi:check` still fail closed because the four operation modules are intentionally incomplete.

- [ ] **Step 8: Commit the toolchain and builder scaffold**

```bash
git add package.json package-lock.json openapi scripts/build-openapi.mjs tests/openapi.test.mjs
git commit -m "docs: add deterministic OpenAPI validation scaffold"
```

---

### Task 3: Project account and contact-data contracts into OpenAPI

**Files:**

- Modify: `openapi/operations/account.mjs`
- Modify: `openapi/operations/contact-data.mjs`
- Modify: `openapi/base.mjs`
- Modify: `tests/openapi.test.mjs`

- [ ] **Step 1: Add failing tests for the six operation shapes**

Import `accountOperations` and `contactDataOperations`. Build a partial in-memory spec by passing those arrays and the matching six catalog entries to injected `buildSpec({ catalog, operationModules })`; do not scrape MDX. For each operation below, assert the exact required inputs, limits, success status, success examples, and documented error-status keys.

| Operation | Request contract | Success contract | Limits / documented errors |
| --- | --- | --- | --- |
| `getCredits` | No request body | `200`, `{status:"success",response:{credits:number}}` | 401, 500, 503 |
| `findProfessionalEmail` | Either non-empty `linkedin_profile_url`, or non-empty `first_name` + `last_name` + one of `domain`/`company_name`; 256 KiB worker limit | `200`, success/not-found envelope | 3,000/min; 400, 401, 403, 413, 429, 500, 502, 503 |
| `findProfessionalEmailsBulk` | `webhook_url` string beginning with `http`; `inputs` array min 1 max 100 | `202`, `{status:"accepted",count:integer}` | 3,000 items/min; 400, 401, 403, 413, 429, 500, 502 |
| `findMobilePhone` | required non-empty `linkedin_profile_url`; 256 KiB worker limit | `200`, success/not-found envelope | 3,000/min; 400, 401, 403, 413, 429, 500, 502, 503 |
| `findPersonalEmail` | required LinkedIn `/in/` URL; optional `verification` boolean/string | `200`, success/not-found envelope | 2,000/min; 400, 401, 403, 413, 429, 500, 502, 503 |
| `findPeopleProfileUrl` | required non-empty `first_name`, `last_name`, `company_name` | `200`, success URL or not-found | 6/sec; 400, 401, 403, 413, 429, 500, 502, 503 |

Add a shared assertion:

```js
function requestSchema(operation) {
  return operation.requestBody?.content?.["application/json"]?.schema;
}

function errorStatuses(operation) {
  return Object.keys(operation.responses).filter((status) => !["200", "202"].includes(status));
}
```

Tests must explicitly confirm `getCredits` has no `requestBody` and bulk email uses `202`, not `200`.

- [ ] **Step 2: Run the focused test and verify all six operations are missing**

```bash
node --test --test-name-pattern="account|contact|Credits|Email|Mobile|Profile URL" tests/openapi.test.mjs
```

Expected: FAIL because the two operation arrays are empty.

- [ ] **Step 3: Add reusable contact schemas and response helpers**

In `openapi/base.mjs`, add only schemas shared by two or more operations:

- `Status` enum: `success`, `not_found`, `timeout`;
- `LinkedInPersonUrl` string with a synthetic `/in/` example;
- `SuccessEmail` and `NotFoundEmail` response schemas;
- `Error` remains permissive because source error envelopes vary.

Do not pretend variable profile payloads are closed schemas. Model source-backed stable fields and use `additionalProperties: true` for variable public profile records.

- [ ] **Step 4: Implement the six operations**

Every operation object must contain:

- `operationId`, one approved `tags` value, `summary`, and public `description`;
- `x-airscale-rate-limit` and `x-airscale-credit-cost` strings copied from the audited page contract;
- JSON request/response schemas with required arrays, constraints, and synthetic examples;
- `401` as `$ref: "#/components/responses/Unauthorized"`;
- only the source-backed error statuses documented by its current contract page/source tests;
- no internal provider names or implementation details.

The bulk callback URL is a schema property, not an OpenAPI webhook in this plan; asynchronous callback documentation remains durable wrapper guidance.

- [ ] **Step 5: Run the focused tests**

```bash
node --test --test-name-pattern="account|contact|Credits|Email|Mobile|Profile URL" tests/openapi.test.mjs
```

Expected: all focused tests pass. The repository-default `openapi:check` remains intentionally red until Tasks 4-5 add the remaining operations.

- [ ] **Step 6: Commit the account/contact projection**

```bash
git add openapi/base.mjs openapi/operations/account.mjs openapi/operations/contact-data.mjs tests/openapi.test.mjs
git commit -m "docs: model account and contact API contracts"
```

---

### Task 4: Project profile and reverse-lookup contracts into OpenAPI

**Files:**

- Modify: `openapi/operations/profile-lookup.mjs`
- Modify: `openapi/base.mjs`
- Modify: `tests/openapi.test.mjs`

- [ ] **Step 1: Add failing tests for the four operation shapes**

Import `profileLookupOperations` and build a partial spec with the four matching catalog entries, as in Task 3. Assert these source-backed contracts:

| Operation | Required request | Success / miss shape | Limits / special rule |
| --- | --- | --- | --- |
| `extractPersonProfile` | `linkedin_profile_url` selecting `/in/` | variable person record with stable URL/identifier fields | 3,000/min; 400, 401, 403, 404, 413, 429, 500, 502, 503; URL selects schema/cost |
| `extractCompanyProfile` | `linkedin_profile_url` selecting `/company/` or `/school/` | variable organization record with stable organization fields | 3,000/min; 400, 401, 403, 404, 413, 429, 500, 502, 503; URL selects schema/cost |
| `reverseEmailLookup` | valid `email` | variable person object or JSON string `"not found"` | 25/sec; 400, 401, 403, 413, 429, 500, 502, 503; do not normalize miss to an object |
| `reversePhoneLookup` | non-empty `mobile_phone` | variable top-level record plus canonical `body`, or `{status:"not_found"}` | 2,000/min; 400, 401, 403, 413, 429, 500, 502, 503; do not claim server-side E.164 enforcement |

For reverse email, assert the `200` response schema is `oneOf` with an object branch and a string enum branch containing exactly `"not found"`.

- [ ] **Step 2: Run the focused test and verify the operations are missing**

```bash
node --test --test-name-pattern="profile|reverse" tests/openapi.test.mjs
```

Expected: FAIL for all four missing operations.

- [ ] **Step 3: Implement shared profile schemas conservatively**

Add:

- `VariablePersonProfile` with `type: object`, stable optional `url`, `identifier`, `profile`, `link`, and `additionalProperties: true`;
- `VariableCompanyProfile` with stable optional organization fields and `additionalProperties: true`;
- `NotFoundStatus` requiring `{status:"not_found"}`.

Do not invent required fields that the runtime does not guarantee.

- [ ] **Step 4: Implement the four operations**

Use the approved descriptions and synthetic examples already present in the four source-pinned MDX pages. Preserve every source-backed documented error status. Encode the LinkedIn route distinction in descriptions and examples, not as a regex that would reject URLs the worker accepts.

- [ ] **Step 5: Run focused and cumulative tests**

```bash
node --test --test-name-pattern="profile|reverse" tests/openapi.test.mjs
node --test tests/openapi.test.mjs
```

Expected: profile/reverse and cumulative unit tests pass. The repository-default `openapi:check` remains intentionally red only because the five search/discovery operations are still absent.

- [ ] **Step 6: Commit the profile projection**

```bash
git add openapi/base.mjs openapi/operations/profile-lookup.mjs tests/openapi.test.mjs
git commit -m "docs: model profile and reverse lookup contracts"
```

---

### Task 5: Project search/discovery contracts and generate `/openapi.json`

**Files:**

- Modify: `openapi/operations/search-discovery.mjs`
- Modify: `openapi/base.mjs`
- Modify: `tests/openapi.test.mjs`
- Create: `openapi.json`

- [ ] **Step 1: Add failing aggregate and search-operation tests**

Extend the test imports:

```js
import { readFileSync } from "node:fs";
import SwaggerParser from "@apidevtools/swagger-parser";
```

Add these aggregate tests before implementing the search operations:

```js
const catalog = JSON.parse(readFileSync("contracts/public-api-operations.json", "utf8"));

function committedSpec() {
  return JSON.parse(readFileSync("openapi.json", "utf8"));
}

function specOperation(spec, method, path) {
  return spec.paths[path]?.[method.toLowerCase()];
}

test("committed OpenAPI is valid and covers the complete catalog", async () => {
  await assert.doesNotReject(() => SwaggerParser.validate("openapi.json"));
  const spec = committedSpec();
  const operations = catalog.operations.map(({ method, path, operationId, tag }) => {
    const operation = specOperation(spec, method, path);
    assert.ok(operation, `${method} ${path} must exist`);
    return [method, path, operation.operationId, operation.tags?.[0]];
  });
  assert.deepEqual(
    operations,
    catalog.operations.map(({ method, path, operationId, tag }) => [method, path, operationId, tag])
  );
  assert.equal(Object.values(spec.paths).flatMap((item) => ["get", "post"].filter((method) => item[method])).length, 15);
});

test("every operation has public descriptions and responses", () => {
  const spec = committedSpec();
  for (const entry of catalog.operations) {
    const operation = specOperation(spec, entry.method, entry.path);
    assert.ok(operation.summary?.trim(), `${entry.operationId} needs a summary`);
    assert.ok(operation.description?.trim(), `${entry.operationId} needs a description`);
    assert.ok(operation.responses?.["200"] || operation.responses?.["202"], `${entry.operationId} needs a success response`);
    assert.ok(operation.responses?.["401"], `${entry.operationId} needs a 401 response`);
  }
});
```

Add the five search/discovery shape tests against a partial injected build containing the already complete account/contact/profile arrays plus `searchDiscoveryOperations`.

Assert these exact boundaries:

| Operation | Contract |
| --- | --- |
| `findPeople` | JSON body with required non-empty `query`, `size` integer 1-100 default 100, optional cursor; include/exclude lists max 200; numeric operators `>`, `>=`, `<`, `<=`; 6/sec; 400, 401, 403, 404, 413, 429, 502, 503 |
| `countPeople` | Same query-filter schema as search; no pagination fields in the successful count result; 6/sec; 400, 401, 403, 404, 413, 429, 502, 503 |
| `findCompanies` | JSON body with required non-empty `filters`, `page` integer min 0 default 0, `size` integer 1-100 default 50, optional cursor beginning `fc_`; 6/sec; 400, 401, 403, 413, 429, 500, 502, 503 |
| `listFindCompanyFilterValues` | GET with required `filter`; optional `q` and alias `query`, with at least one required by description; optional repeatable/comma-separated `country` and `region`; exact `limit` coercion from 1-100 with default 20; no request body; 6/sec; 400, 401, 403, 413, 429, 500, 502, 503 |
| `airsearch` | JSON body with required non-empty `prompt`, optional `schema` object, 256 KiB limit; success/not-found/timeout envelope; 300/min; 400, 401, 403, 413, 429, 500, 502, 503, 504 |

Also assert shared identity rather than copied schemas:

```js
assert.deepEqual(
  requestSchema(searchSpec.paths["/v1/find-people"].post).properties.query,
  requestSchema(searchSpec.paths["/v1/find-people/count"].post).properties.query
);
```

- [ ] **Step 2: Run focused tests and verify the five operations and committed artifact are missing**

```bash
node --test --test-name-pattern="people|companies|filter values|Airsearch|committed OpenAPI|public descriptions" tests/openapi.test.mjs
npm run openapi:build
```

Expected: tests fail for the five missing operations and missing `openapi.json`; the build fails closed on the first missing search/discovery catalog entry and does not write a partial artifact.

- [ ] **Step 3: Model reusable search filters without overclaiming**

Create shared schemas for:

- string include/exclude filters with max 200 values per list;
- integer comparison ranges using only `>`, `>=`, `<`, `<=` property names;
- company-growth range with `timespan` enum `6months`, `12months`, `24months`;
- opaque cursor strings;
- flexible result items with stable documented fields and `additionalProperties: true`.

OpenAPI property descriptions must name the supported public filter families currently documented, while source-specific worker/provider terminology stays excluded.

- [ ] **Step 4: Implement the five operations**

Use a shared people-query schema for search and count. Model company filter-values as query `parameters`, not a JSON body. Every example must use fictional companies, synthetic LinkedIn slugs, reserved example domains, or non-routable phone numbers.

- [ ] **Step 5: Generate the committed OpenAPI document**

```bash
npm run openapi:build
npm run openapi:check
```

Expected:

- `openapi.json` is created with a trailing newline.
- `--check` reports the file is current.
- `openapi.json` contains 15 operations: 14 POST and 1 GET.

- [ ] **Step 6: Run the complete OpenAPI structure test**

```bash
node --test tests/openapi.test.mjs
```

Expected: all tests pass, including Swagger Parser validation and exact operation coverage.

- [ ] **Step 7: Verify deterministic output**

```bash
shasum -a 256 openapi.json
npm run openapi:build
git diff --exit-code -- openapi.json
```

Expected: the second build produces no diff. Record the SHA-256 in the implementation handoff.

- [ ] **Step 8: Commit the complete OpenAPI projection**

```bash
git add openapi/base.mjs openapi/operations/search-discovery.mjs tests/openapi.test.mjs openapi.json
git commit -m "docs: publish pinned OpenAPI 3.1 contract"
```

---

### Task 6: Validate every OpenAPI example against its schema

**Files:**

- Create: `tests/openapi-examples.test.mjs`
- Modify: `openapi/base.mjs`
- Modify: `openapi/operations/*.mjs`
- Modify: `openapi.json`

- [ ] **Step 1: Write a failing dereferenced-example test**

Create `tests/openapi-examples.test.mjs` using `SwaggerParser.dereference("openapi.json")`, `Ajv2020` from `ajv/dist/2020.js`, and `addFormats` from `ajv-formats`.

The test must walk all 15 operations and validate:

- every `requestBody.content[mediaType].example` against its dereferenced schema;
- every named request `examples[*].value` against its schema;
- every response `content[mediaType].example` and named response example against its schema;
- at least one request example on every operation with a body;
- at least one success response example on every operation;
- no example string matching likely credentials or real personal fixtures.

Use this validator setup:

```js
const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: true });
addFormats(ajv);

function assertValid(schema, value, label) {
  const validate = ajv.compile(schema);
  assert.equal(validate(value), true, `${label}: ${ajv.errorsText(validate.errors)}`);
}
```

Credential/fixture guards must reject:

```js
const DISALLOWED_EXAMPLE = /(sk_live|pk_live|Bearer\s+(?!\$AIRSCALE_API_KEY|YOUR_API_KEY)|@gmail\.com|@yahoo\.com)/i;
```

Allow `example.com`, `example.org`, synthetic names, and the approved `$AIRSCALE_API_KEY` placeholder.

- [ ] **Step 2: Run the test and capture schema/example mismatches**

```bash
node --test tests/openapi-examples.test.mjs
```

Expected: FAIL for any missing or invalid operation example. Do not weaken schemas to make incorrect examples pass; compare each mismatch to the pinned source contract.

- [ ] **Step 3: Correct schemas and examples at their source modules**

Make fixes only in `openapi/base.mjs` or the responsible `openapi/operations/*.mjs`, then regenerate. Do not hand-edit `openapi.json`.

```bash
npm run openapi:build
node --test tests/openapi-examples.test.mjs
npm run openapi:check
```

Expected: all examples validate and generated output is current.

- [ ] **Step 4: Audit dependencies**

```bash
npm audit --omit=dev
npm audit
```

Expected: zero new production dependency findings. Record any dev-only delta against Plan 1's pinned Mint audit baseline; do not run `npm audit fix --force`.

- [ ] **Step 5: Commit the example gate**

```bash
git add tests/openapi-examples.test.mjs openapi openapi.json package.json package-lock.json
git commit -m "test: validate public API examples against OpenAPI"
```

---

### Task 7: Configure Mintlify and split operation navigation

**Files:**

- Modify: `docs.json`
- Create: `api-reference/find-people/count.mdx`
- Create: `api-reference/find-companies/filter-values.mdx`
- Modify: `api-reference/find-people.mdx`
- Modify: `api-reference/find-companies.mdx`
- Modify: `tests/preview-safety.test.mjs`
- Modify: `tests/site.test.mjs`

- [ ] **Step 1: Replace the navigation fixture with the approved 18-page tree**

Update `GROUPS` in `tests/site.test.mjs` to:

```js
const GROUPS = [
  ["Start here", ["api-reference/api-overview", "api-reference/authentication", "api-reference/rate-limits"]],
  ["Search and discovery", [
    "api-reference/find-people",
    "api-reference/find-people/count",
    "api-reference/find-companies",
    "api-reference/find-companies/filter-values",
    "api-reference/airsearch"
  ]],
  ["Contact data", [
    "api-reference/email-finder",
    "api-reference/email-finder-(bulk)",
    "api-reference/mobile-finder",
    "api-reference/personal-email",
    "api-reference/people-url-finder"
  ]],
  ["Profiles and reverse lookup", [
    "api-reference/extract-people-profile",
    "api-reference/extract-company-profile",
    "api-reference/reverse-email",
    "api-reference/reverse-phone"
  ]],
  ["Account", ["api-reference/credit-count"]]
];
```

Change the preview-safety page-count assertion from 16 to 18. Add assertions that exactly 15 pages have `openapi` frontmatter and exactly three guide pages do not.

- [ ] **Step 2: Write failing docs-config tests**

Add this exact expected config assertion:

```js
assert.deepEqual(config.api, {
  openapi: "openapi.json",
  playground: { display: "simple" },
  examples: {
    languages: ["curl", "node", "python"],
    defaults: "required",
    prefill: true,
    autogenerate: true
  }
});
assert.equal(Object.hasOwn(config.api.playground, "mode"), false);
```

Also assert `hideApiMarker` does not appear in `docs.json` or any MDX file.

- [ ] **Step 3: Run focused tests and verify they fail**

```bash
node --test tests/site.test.mjs tests/preview-safety.test.mjs
```

Expected: FAIL on 18-page navigation, API config, wrapper count, and missing child pages.

- [ ] **Step 4: Add the exact Mintlify API configuration**

Add this top-level block to `docs.json` without changing theme, logo, colors, font, SEO, or search:

```json
"api": {
  "openapi": "openapi.json",
  "playground": {
    "display": "simple"
  },
  "examples": {
    "languages": ["curl", "node", "python"],
    "defaults": "required",
    "prefill": true,
    "autogenerate": true
  }
},
```

Do not add `custom.css`, method-pill CSS, a live API-key field, or an executable playground.

- [ ] **Step 5: Update navigation and add the two child wrappers**

Use the exact group order from Step 1. Create these frontmatters:

```mdx
---
title: "Count people"
description: "Count people matching person, role, and company filters."
canonical: "https://airscale.mintlify.app/api-reference/find-people/count"
openapi: "/openapi.json POST /v1/find-people/count"
---
```

```mdx
---
title: "Company filter values"
description: "Search supported values for Find Companies filters."
canonical: "https://airscale.mintlify.app/api-reference/find-companies/filter-values"
openapi: "/openapi.json GET /v1/find-companies/filter-values"
---
```

Move only operation-specific durable guidance from the two combined parent pages into these child wrappers. Add reciprocal links between each search page and its secondary operation.

- [ ] **Step 6: Run canonical sync and focused tests**

```bash
npm run metadata:sync
node --test tests/site.test.mjs tests/preview-safety.test.mjs
```

Expected: canonical sync scans 18 pages and updates zero after the explicit frontmatter edits; focused tests may still fail only because the remaining 13 operation pages lack OpenAPI frontmatter.

- [ ] **Step 7: Commit config and split routes**

```bash
git add docs.json api-reference/find-people.mdx api-reference/find-people/count.mdx api-reference/find-companies.mdx api-reference/find-companies/filter-values.mdx tests/site.test.mjs tests/preview-safety.test.mjs
git commit -m "docs: split API operations into method-aware routes"
```

---

### Task 8: Convert all operation pages to durable OpenAPI wrappers

**Files:**

- Modify: the 13 remaining operation MDX files listed in the file map
- Modify: `api-reference/find-people.mdx`
- Modify: `api-reference/find-companies.mdx`
- Modify: `tests/site.test.mjs`

- [ ] **Step 1: Replace manual endpoint-contract assertions with wrapper assertions**

Delete the tests that require manual `<Badge color="blue">`, manual Request/Response field tables, and inline `CodeGroup` copies. Retain generic content-quality, link, logo, canonical, secret-safety, and balanced-fence tests.

Add this wrapper contract:

```js
test("every public operation has one OpenAPI-backed wrapper", () => {
  const catalog = JSON.parse(readFileSync("contracts/public-api-operations.json", "utf8"));
  for (const entry of catalog.operations) {
    const { body, frontmatter } = readPage(entry.page);
    assert.equal(frontmatter.openapi, `/openapi.json ${entry.method} ${entry.path}`);
    assert.doesNotMatch(body, /<Badge\b[^>]*>\s*(?:GET|POST)\s*<\/Badge>/i);
    assert.doesNotMatch(body, /^## (?:Request|Response|Errors|Examples)$/m);
    assert.doesNotMatch(body, /<CodeGroup>/);
    assert.ok(body.trim(), `${entry.page} must retain durable Airscale guidance`);
  }
});

test("guide pages remain prose-only", () => {
  for (const page of ["api-reference/api-overview", "api-reference/authentication", "api-reference/rate-limits"]) {
    const { frontmatter } = readPage(page);
    assert.equal(Object.hasOwn(frontmatter, "openapi"), false);
  }
});
```

Add a test mapping every wrapper binding back to a real OpenAPI operation so an invalid method/path cannot render silently.

- [ ] **Step 2: Run the focused wrapper test and verify it fails**

```bash
node --test tests/site.test.mjs --test-name-pattern="OpenAPI-backed|guide pages"
```

Expected: FAIL on the 13 remaining manual operation pages.

- [ ] **Step 3: Add exact OpenAPI frontmatter to every operation page**

For every operation in `contracts/public-api-operations.json`, add:

```yaml
openapi: "/openapi.json POST /v1/email"
```

The line above is the exact binding for `api-reference/email-finder.mdx`. For every other wrapper, substitute the exact method/path tuple from the approved operation map; do not infer it from prose and do not add `hideApiMarker`.

- [ ] **Step 4: Reduce wrapper bodies to durable guidance**

For each operation wrapper:

- keep a one-paragraph purpose statement;
- keep rate-limit and credit behavior in an `Info`, `Note`, or `Warning` callout;
- keep retry/settlement caveats that affect safe integration behavior;
- keep asynchronous webhook behavior on bulk email;
- keep cross-links and a `## Next step` section;
- remove manual method badges, full endpoint property tables, request/response schema tables, copied JSON wire examples, status-code tables, and `CodeGroup` samples now generated from OpenAPI.

Do not move source-contract detail into untested prose. If a detail is wire-level, put it in OpenAPI and cover it in `tests/openapi.test.mjs`.

- [ ] **Step 5: Run wrapper, links, and safety tests**

```bash
node --test tests/site.test.mjs tests/preview-safety.test.mjs tests/openapi.test.mjs tests/openapi-examples.test.mjs
```

Expected: all focused tests pass; 15 operation wrappers and three guide pages are distinguished exactly.

- [ ] **Step 6: Verify no manual method presentation remains**

```bash
rg -n '<Badge[^>]*>(GET|POST)</Badge>|^## (Request|Response|Errors|Examples)$|<CodeGroup>' api-reference
```

Expected: no matches on the 15 operation wrappers. Any intentional code sample on a guide page must use only approved placeholders and is reviewed separately.

- [ ] **Step 7: Commit wrapper conversion**

```bash
git add api-reference tests/site.test.mjs
git commit -m "docs: convert endpoints to OpenAPI-backed wrappers"
```

---

### Task 9: Validate the FullEnrich-inspired responsive presentation locally

**Files:**

- Modify only if browser verification exposes a defect in files owned by Tasks 2-8.
- Read: `docs/chrome-mcp-testing-best-practices.md`

- [ ] **Step 1: Run the static and Mintlify gates before browser work**

```bash
npm ci
npm run openapi:check
npm test
npm run mint:validate
```

Expected: all Node tests and Mintlify validation pass before starting a server.

- [ ] **Step 2: Start the local Mintlify preview in a dedicated terminal**

```bash
npx mint dev --port 3333
```

Wait for the server to report ready. Keep this terminal open only for the duration of browser QA; it is not a production deployment.

- [ ] **Step 3: Follow the repository browser-debugging guidance**

Read `docs/chrome-mcp-testing-best-practices.md`, then use the in-app browser or Chrome tooling it prescribes. Reproduce from the browser first, inspect relevant console/network/DOM state, patch only after evidence, reload, and re-run the focused checks.

- [ ] **Step 4: Verify the representative operation matrix**

Check these routes in both light and dark mode:

- POST: `/api-reference/find-people`
- GET: `/api-reference/find-companies/filter-values`
- no-body POST: `/api-reference/credit-count`
- asynchronous POST: `/api-reference/email-finder-(bulk)`

At **1440 px** viewport width, verify:

- native POST markers are blue and the GET marker is green in navigation and the endpoint header;
- the complete method and route are visible;
- the request/response area occupies approximately 420-448 px on the right and remains visible while reading the main operation content;
- cURL is selected by default; Node.js and Python are selectable;
- required fields are prefilled with synthetic placeholders;
- request and success response examples are copyable;
- there is no live `Try it`, Send, or Run action and no API-key input.

At **1200 px** viewport width and **390 x 844 px** mobile, verify:

- no horizontal page overflow;
- request and response examples remain reachable inline in reading order rather than disappearing;
- all three languages remain accessible;
- navigation, route text, code blocks, and copy buttons are keyboard/touch reachable.

- [ ] **Step 5: Inspect console, network, and OpenAPI delivery**

Verify:

- no relevant console errors or hydration failures;
- `GET /openapi.json` returns 200 and `application/json`;
- the page makes no request to `https://api.airscale.io` while loading or copying examples;
- no credential-like value appears in the DOM or network panel.

- [ ] **Step 6: Use the explicit component fallback only if native responsive behavior fails**

If Mintlify's native OpenAPI page hides request/response examples at 1200 px or mobile, keep the OpenAPI binding and add contract-derived components to the affected wrapper:

````mdx
<RequestExample>
```bash cURL
curl --request POST \
  --url https://api.airscale.io/v1/email \
  --header "Authorization: Bearer $AIRSCALE_API_KEY" \
  --header "Content-Type: application/json" \
  --data '{"linkedin_profile_url":"https://www.linkedin.com/in/example-person-000000"}'
```
</RequestExample>

<ResponseExample>
```json 200 OK
{
  "status": "success",
  "email": "example.person@example.com"
}
```
</ResponseExample>
````

This is the exact fallback for `POST /v1/email`. For another affected operation, render the matching validated OpenAPI request and success-response examples, add a test that compares the component payloads with those examples, and re-run Task 6. Use this fallback only with browser evidence because duplicate native/manual examples are not acceptable.

- [ ] **Step 7: Record browser evidence**

Capture screenshots for the four representative routes at 1440 px and the POST/GET routes at 1200 px and 390 px, in both themes where layout/color changes materially. Record viewport, route, theme, method-marker color, panel behavior, language selectors, overflow result, console result, and API-network result.

- [ ] **Step 8: Stop the local server and commit evidence-driven fixes**

Stop only the local Mintlify process. If code changed, re-run the complete Task 10 gate and commit narrowly:

```bash
git diff --name-only
git add api-reference/email-finder.mdx tests/openapi-examples.test.mjs tests/site.test.mjs
git diff --cached --name-only
git commit -m "fix: preserve responsive API examples"
```

The `git add` line is exact for the `/v1/email` fallback shown above. If browser evidence identifies a different wrapper, stage that wrapper instead, together with the exact example-comparison test files reported by the first command. Do not commit browser profiles, screenshots containing user data, package changes unrelated to the fix, or local tool state.

---

### Task 10: Run the Plan 2 release gate and prepare the preview-only handoff

**Files:**

- Modify only if verification exposes a defect in files owned by Tasks 1-9.

- [ ] **Step 1: Verify source pins and counts**

```bash
node --test tests/contracts.test.mjs tests/openapi.test.mjs
```

Record:

- source SHA `8606866a5fb1f9405a94d49cfa9fbddaf4aaf431`;
- 15 unique OpenAPI operations;
- 14 POST and one GET;
- 15 operation wrappers and three guide pages;
- 18 navigable API-reference pages.

- [ ] **Step 2: Verify generated files are current and metadata is idempotent**

```bash
npm run openapi:check
npm run metadata:sync
git diff --exit-code -- openapi.json api-reference
```

Expected: OpenAPI is current; metadata scans 18 pages and updates zero; no diff.

- [ ] **Step 3: Run complete local validation**

```bash
npm test
npm run mint:validate
npm run validate
npm audit --omit=dev
npm audit
```

Expected:

- all Node tests pass with zero failures;
- Mintlify validation passes on both invocations;
- no production/runtime dependency findings;
- no unexplained dev-audit delta beyond the recorded pinned Mint baseline and the newly audited validation tools.

- [ ] **Step 4: Reconfirm the live-site boundary read-only**

```bash
dig +short docs.airscale.io CNAME
```

Expected at plan authoring time: `sites.framer.app.` If it differs, report drift; do not mutate DNS or Mintlify domain settings.

- [ ] **Step 5: Run repository integrity checks**

```bash
git diff --check
git diff --cached --check
git diff --check origin/main...HEAD
git status --short --branch
git log --oneline --decorate -15
```

Expected: no whitespace failures, no unintended tracked changes, and task commits are visible in order.

- [ ] **Step 6: Record no-spend and no-mutation evidence**

State exactly that this implementation used schema/sample validation and local/preview browser rendering only. It did not call Airscale public endpoints, spend credits, consume provider quota, mutate production data, change DNS, add redirects, change the custom domain, or write to Framer.

- [ ] **Step 7: Prepare the preview-only merge/deploy decision**

Report the exact branch HEAD, OpenAPI SHA-256, test count, Mint result, dependency-audit result, browser matrix, and read-only DNS result. Do not merge, push, publish, or deploy from this plan without the user's explicit release instruction.

If release is later approved, use the Airscale guarded release workflow adapted to this docs repository:

1. refresh `origin/main`;
2. require exact-current-main CI for the merge candidate;
3. merge without bypassing checks;
4. verify the Mintlify deployment identifies the exact merged SHA;
5. verify `/openapi.json` and all 18 pages on `https://airscale.mintlify.app` for three stable rounds;
6. verify hosted `noindex`, preview canonicals, native method markers, responsive examples, and absence of API calls;
7. re-run the read-only DNS check and confirm `docs.airscale.io` still points to Framer.

---

## Completion evidence required

Plan 2 is complete only when the implementation handoff includes:

- exact docs repository SHA and pinned application source SHA;
- `openapi.json` SHA-256;
- valid OpenAPI 3.1 result;
- 15-operation / 18-page counts;
- exact POST/GET split;
- request/response example-schema validation result;
- full Node-test count and failures;
- Mintlify validation result;
- production and full dependency-audit results;
- local browser evidence for desktop, laptop, mobile, light, dark, POST, GET, no-body, and async cases;
- proof that no live playground/API request occurred;
- preview `noindex` and canonical result;
- read-only DNS result;
- explicit no-spend/no-production-mutation statement; and
- separate state labels for local, committed, pushed, merged, CI-green, deployed, and hosted-browser verified.

Passing local tests is not deployment proof. A successful Mintlify deployment receipt is not hosted visual proof. Hosted 200 responses are not proof that method markers, responsive examples, or the no-live-call policy work.
