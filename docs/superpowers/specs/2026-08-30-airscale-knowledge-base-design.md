# Airscale Knowledge Base and OpenAPI Reference Design

Date: 2026-08-30

Status: approved for implementation planning

## Objective

Build a complete Airscale knowledge base on the separate Mintlify preview URL. The site must serve two audiences equally:

1. People learning and operating the Airscale product.
2. Developers integrating with the Airscale API.

The work takes inspiration from FullEnrich's method-aware API navigation and right-side request examples, while preserving Airscale's visual identity and improving responsive behavior, contract accuracy, indexing controls, and AI readability.

## Hard boundary

This project does not change DNS or the live `docs.airscale.io` site.

- `docs.airscale.io` continues to serve the existing Framer documentation.
- The new knowledge base is built, published, and verified only on the separate Mintlify URL, currently `https://airscale.mintlify.app`.
- No live-domain redirects are created.
- No custom-domain cutover is prepared or executed as part of implementation.
- A future migration of `docs.airscale.io` is a separate project requiring separate approval.

The preview must be public enough for browser, search, Markdown, OpenAPI, and agent-readability testing, but it must be marked `noindex` for traditional search engines so it does not compete with the existing Framer site.

## Current state and problem

The current Mintlify preview contains sixteen manually authored API pages. The content has been redesigned and contract-pinned, but its endpoint presentation is not OpenAPI-driven. POST and GET labels are manually placed in page content, code examples are inline, and pages containing more than one operation do not expose every operation as a first-class reference page.

The existing Framer site exposes eighty-two URLs across product guides, use cases, MCP guidance, integrations, administration, and API reference. The preview therefore cannot yet act as a complete Airscale knowledge base.

The preview currently provides `llms.txt`, `llms-full.txt`, Markdown content negotiation, and an automatic documentation MCP server. However, the generated AI index uses `docs.airscale.io` URLs while that domain still serves Framer. Markdown links such as `/api-reference/find-people.md` consequently fail on the custom domain. The preview also lacks a public OpenAPI document, API catalog, and generated `skill.md` at the time of this design.

## Selected experience: balanced two-path gateway

The homepage asks one question: **What do you want to accomplish?**

It presents two visually equal entrances:

### Use Airscale

This path contains product education and operational workflows:

- Start here
- Prospecting and audience building
- Find People and Find Companies
- Signals, social sources, maps, and job-change workflows
- Tables, imports, and data movement
- Contact, person, and company enrichment
- Verification and waterfall behavior
- AI and Airsearch
- MCP setup and usage
- CRM, outbound, and export integrations
- Workspace and user administration
- Templates and use cases

### Build with the API

This path contains developer material:

- API quickstart
- Authentication and API-key safety
- Errors and rate limits
- Asynchronous operations and webhooks where applicable
- Search and discovery endpoints
- Contact-data endpoints
- Profile and reverse-lookup endpoints
- Account endpoints
- Public OpenAPI download

The homepage also includes one global search and a compact set of popular tasks. The two paths use the same Airscale header, typography, color system, footer, search experience, and cross-linking conventions.

## Information architecture rules

1. Product guides explain outcomes and workflows.
2. API pages define canonical wire contracts.
3. Product guides link to API pages instead of copying request or response schemas.
4. API pages link back to related product workflows when that context helps a developer.
5. Every page answers one primary user intent.
6. Navigation labels use task language rather than internal implementation names.
7. Hidden or obsolete material is not included in navigation, internal search, AI assistant context, or generated indexes.

The current Framer sitemap is used as a content inventory, not as authorization to alter the live site. Each of its eighty-two paths is classified as:

- migrate at the same path on the preview host;
- rewrite at the same path on the preview host;
- consolidate into another preview page; or
- obsolete and intentionally omitted from the preview.

The inventory must record a reason and target for every consolidation or omission. It is an implementation artifact and release input, not a live redirect map.

## Visual system

The existing Airscale launch-quality visual identity remains in place:

- Airscale light and dark logos
- Poppins typography
- Primary blue `#4079FF`
- Dark-mode blue `#6F9BFF`
- Mintlify's `mint` theme
- Lucide icons
- Airscale's current restrained card, callout, and code-block treatment

The FullEnrich site is inspiration for information density and endpoint ergonomics, not a visual template. Airscale keeps its own color, typography, tone, spacing, and branding.

## API reference architecture

### Source of truth

Application code remains authoritative. A repository-owned OpenAPI 3.1 document at `/openapi.json` is the tested public projection of that contract.

The specification records:

- production server URL;
- Bearer authentication;
- every approved public operation;
- operation summary and description;
- stable operation ID;
- path, query, header, and body parameters;
- required fields, types, formats, defaults, enums, and constraints;
- success and documented error responses;
- schema-valid examples;
- deprecation state; and
- only public, user-relevant descriptions.

Internal endpoints, implementation details, provider identities, secrets, and non-public behavior are excluded.

The specification and contract manifest record the exact Airscale application source SHA used during generation or audit. Tests fail if the public projection drifts from the pinned application contract.

### Endpoint pages

Each public operation receives an individual MDX wrapper with OpenAPI frontmatter in this form:

```mdx
---
title: "Find people"
description: "Search for people using profile, role, location, and company filters."
openapi: "/openapi.json POST /v1/find-people"
---
```

The wrapper contains only durable Airscale guidance that does not belong in a schema, such as prerequisite concepts, credit cautions, workflow advice, and related-guide links. Request fields, response fields, authentication, and status contracts come from OpenAPI.

Pages that currently combine multiple operations are split so every method and path is independently addressable. The primary operation retains the current short slug where practical. Secondary operations receive explicit child routes. For example:

- `/api-reference/find-people` for `POST /v1/find-people`
- `/api-reference/find-people/count` for `POST /v1/find-people/count`
- `/api-reference/find-companies` for `POST /v1/find-companies`
- `/api-reference/find-companies/filter-values` for `GET /v1/find-companies/filter-values`

### Endpoint presentation

Endpoint pages use these visual and interaction rules:

- Blue POST badges and green GET badges appear in navigation and beside the route.
- The full API URL is copyable.
- Wide desktop layouts pin a 420-448 pixel request and response panel on the right.
- cURL is the default example language.
- Node.js and Python are the other first-class examples.
- Examples show required fields by default and use obvious placeholders.
- Small-laptop and mobile layouts place the same examples inline in the reading flow instead of hiding them.
- Success response examples sit below the request example.
- Request and response samples are copyable and keyboard accessible.

Individual MDX wrappers use Mintlify `RequestExample` and `ResponseExample` behavior when it is needed to guarantee the approved responsive fallback. Any curated example is stored in or generated from a contract fixture and validated against OpenAPI to prevent prose/example drift.

### Playground policy

The initial preview uses a copyable, non-executing playground mode. It does not expose a live `Try it` action.

This avoids accidental calls to credit-spending endpoints, protects API keys from unnecessary browser entry, and preserves the project's no-spend verification boundary. A live playground requires a separate design for authentication, test data, rate limits, and spend controls.

The intended Mintlify configuration is equivalent to:

```json
{
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
  }
}
```

The exact configuration is validated against the current Mintlify schema before implementation is considered complete.

## Human-readable content model

Every endpoint page follows the same semantic order:

1. Purpose
2. Method and path
3. Authentication
4. Required and optional inputs
5. Minimal valid request
6. Successful response
7. Error responses
8. Rate-limit and credit behavior
9. Related product guide

Every product guide follows an outcome-oriented order:

1. What the workflow accomplishes
2. Prerequisites
3. Steps
4. Expected result
5. Common failures and recovery
6. Related guides and API operations

Headings are descriptive intent phrases. Page titles and descriptions are unique. Examples use synthetic data and placeholders. No page contains real credentials, personal data, or provider-returned production records.

## Search-engine indexing on the preview host

The preview is deliberately separate from the live documentation domain.

- Global page metadata marks the preview `noindex` while allowing users and validation tools to follow links.
- Canonical and generated absolute URLs must use `https://airscale.mintlify.app`, not `docs.airscale.io`.
- The preview's sitemap is used for completeness testing, not submitted to Google or Bing.
- No live-domain redirects are created.
- No DNS or Mintlify custom-domain cutover action is taken.

Every navigable preview page still receives a specific title, description, semantic H1, Open Graph metadata, and descriptive internal links so the site is ready for a future indexing decision without requiring a content rewrite.

## AI and agent readability

The preview exposes and verifies these surfaces:

- `/openapi.json`
- `/llms.txt`
- `/llms-full.txt`
- page-level `.md` exports
- `Accept: text/markdown` content negotiation
- `/skill.md`
- `/.well-known/agent-skills/index.json`
- `/.well-known/api-catalog`
- Mintlify's documentation MCP server and server card

`llms.txt` acts as a compact directory grouped by the two user paths. Every entry has a concise, discriminating description. `llms-full.txt` provides the full public corpus. All absolute links must resolve on the Mintlify preview host.

If repo-level configuration cannot make Mintlify's automatic index use the preview host, the repository supplies a generated custom `llms.txt`. A custom full-corpus file is used only if the automatic `llms-full.txt` also emits broken hosts and cannot be corrected through repository configuration. Generated files are deterministic and covered by link tests.

A curated `skill.md` describes:

- supported Airscale API capabilities;
- authentication requirements;
- minimal workflows;
- input constraints;
- asynchronous behavior;
- credit and rate-limit cautions;
- common errors and recovery;
- explicit exclusions and unsupported assumptions; and
- links to canonical detail through `llms.txt`.

The skill is a capability and workflow summary, not a duplicate API reference.

## Failure and drift handling

The documentation build fails closed when any of these conditions occur:

- OpenAPI is invalid.
- An MDX operation reference does not exist in OpenAPI.
- An approved public operation lacks a page.
- A request or response example fails schema validation.
- A required title or description is missing.
- A navigation entry resolves to a missing page.
- An internal link or machine-readable index link fails.
- A generated absolute URL points at `docs.airscale.io`.
- Preview pages lose their `noindex` directive.
- A page contains a detected real secret or disallowed production fixture.

Failures block publication to the preview. They do not trigger live API calls or a DNS fallback.

## Delivery stages

### Stage 1: inventory and contract foundation

- Capture the existing Framer sitemap as a timestamped inventory.
- Classify every existing route for preview treatment.
- Audit application contracts at an exact source SHA.
- Create and validate `/openapi.json`.
- Add contract-drift and example-validation tests.

### Stage 2: API reference conversion

- Create one OpenAPI-backed MDX wrapper per public operation.
- Split multi-operation pages.
- Configure method-aware navigation and three example languages.
- Add responsive request and response panels.
- Preserve approved Airscale guidance and cross-links.

### Stage 3: full two-path knowledge base

- Build the balanced gateway homepage.
- Migrate and rewrite product guides on the preview host.
- Organize product and API navigation.
- Add consistent metadata, callouts, steps, cards, and troubleshooting sections.
- Add AI indexes and the curated skill.

### Stage 4: preview-only verification and publication

- Run local contract, content, and link tests.
- Run Mintlify validation.
- Run browser QA in light and dark themes.
- Verify wide desktop, 1200 pixel laptop, and 390 pixel mobile behavior.
- Publish only to `airscale.mintlify.app`.
- Repeat the full hosted verification matrix.

## Acceptance criteria

The design is complete when all of the following are true on the preview host:

- The homepage presents equal Use Airscale and Build with the API paths.
- Every inventoried legacy page has a recorded preview disposition.
- Every planned preview page returns HTTP 200.
- Every approved public operation exists in valid OpenAPI and has a rendered page.
- POST and GET badges are correct in navigation and page headers.
- cURL, Node.js, and Python samples are available and copyable.
- The request/response panel is sticky on wide desktop and remains accessible inline at narrower sizes.
- There is no live credit-spending playground.
- Examples validate against their schemas.
- Search finds representative content from both paths.
- All internal and machine-readable links resolve on the preview host.
- Markdown negotiation returns clean Markdown.
- OpenAPI, AI indexes, skill discovery, API catalog, and MCP discovery are reachable.
- Preview HTML is `noindex`.
- Desktop, laptop, mobile, light, dark, keyboard, and overflow checks pass.
- Browser QA reports no relevant console errors.
- No real provider calls, credit spend, quota consumption, production mutation, DNS change, redirect deployment, or custom-domain cutover occurs.

## Explicit non-goals

- Changing `docs.airscale.io` DNS
- Replacing or modifying the live Framer site
- Publishing redirects on the live domain
- Submitting the preview sitemap to search engines
- Enabling a live API playground
- Executing paid or quota-consuming API canaries
- Documenting internal-only endpoints or provider internals
- Treating the FullEnrich visual identity as an Airscale design template

## Approved decisions summary

- Complete knowledge base, not API-only
- Balanced two-path homepage
- Airscale visual identity retained
- OpenAPI 3.1 plus individual MDX endpoint wrappers
- POST/GET method-aware navigation
- Sticky right-side cURL, Node.js, and Python examples
- Inline responsive fallback
- Simple, non-executing playground
- Preview-only publication
- Preview `noindex`
- AI-readable OpenAPI, Markdown, indexes, skill, catalog, and MCP surfaces
- No DNS or live-domain work
