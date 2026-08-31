# Airscale MCP and Agent Documentation Design

Date: 2026-08-31

Status: approved for implementation

## Objective

Add a first-class MCP and agent documentation section to the separate Airscale Mintlify preview. The section must preserve the useful content already published on Framer, present the live Airscale MCP contract with developer-grade precision, and make the documentation easy to navigate from browsers, search tools, and AI systems.

The visual treatment takes inspiration from FullEnrich's compact technical hierarchy and persistent example panel. It does not copy FullEnrich's brand. Airscale retains its own logo, typography, colors, tone, spacing, and component language.

## Approved decisions

- Add a dedicated `MCP & Agents` tab beside `API Reference`.
- Use a developer-first landing page.
- Document all twenty-two tools on one grouped catalog page.
- Preserve the four canonical Framer MCP routes on the preview host.
- Add a visible agent-resources page for the documentation MCP and machine-readable surfaces.
- Keep the operational Airscale MCP and the read-only documentation MCP clearly distinct without renaming the operational product.
- Treat the runtime registry as technical truth when old prose or README content disagrees.
- Publish and verify only on the separate Mintlify preview.
- Do not change DNS, the Framer site, redirects, or the `docs.airscale.io` custom-domain state.

## Hard boundaries

This work changes only the Airscale documentation repository and the separate Mintlify preview.

- `docs.airscale.io` continues to serve Framer.
- The preview remains at `https://airscale.mintlify.app`.
- Every preview page remains `noindex, follow`.
- Canonical and generated machine-readable links use the preview origin.
- The implementation does not call billable Airscale tools, consume credits, query providers, or mutate production data.
- The implementation does not change the MCP Worker, public API runtime, OAuth configuration, or workspace configuration.
- Live verification is limited to safe GET requests such as MCP health and OAuth discovery metadata.

## Existing content and source hierarchy

The current Framer pages define the content journey and user-facing terminology:

1. `/mcp/airscale-mcp-server`
2. `/mcp/connect-airscale-mcp-to-chatgpt`
3. `/mcp/connect-airscale-mcp-to-claude`
4. `/mcp/how-to-use-the-airscale-mcp`

The current implementation registry defines the exact tool contract:

- `mcp/airscale-public-api/src/endpoints.ts` defines fifteen core public API tools.
- `mcp/airscale-public-api/src/exportJobs.ts` defines four async export tools.
- `mcp/airscale-public-api/src/contactEnrichmentJobs.ts` defines three managed contact-enrichment tools.
- `mcp/airscale-public-api/src/worker.ts` concatenates those registries and exposes their schemas.

Source precedence is:

1. Runtime registry and schemas at a recorded Airscale source SHA.
2. Approved public API contract and OpenAPI projection.
3. Existing public Framer MCP content.
4. MCP package README.

The README is supporting context only. It currently describes the fifteen core tools and four export tools but omits the three managed contact-enrichment tools.

## Information architecture

The existing API navigation remains unchanged. A peer tab is added:

```text
API Reference
MCP & Agents
  Start
    Airscale MCP server
    Tool catalog
  Connect
    Connect to ChatGPT
    Connect to Claude
  Use
    MCP workflows
  For agents
    Agent resources
```

The section contains exactly six navigable pages:

| Route | Page role | Treatment |
|---|---|---|
| `/mcp/airscale-mcp-server` | Developer-first MCP landing page | Rewrite the existing page without losing its security, credit, export, or troubleshooting guidance. |
| `/mcp/tools` | Canonical twenty-two-tool catalog | New page generated or verified from a source-pinned contract manifest. |
| `/mcp/connect-airscale-mcp-to-chatgpt` | ChatGPT setup | Migrate and visually refine the current walkthrough. |
| `/mcp/connect-airscale-mcp-to-claude` | Claude setup | Migrate and visually refine the current walkthrough. |
| `/mcp/how-to-use-the-airscale-mcp` | Practical workflow guide | Migrate and reorganize the current usage guide. |
| `/mcp/agent-resources` | Machine-readable discovery | New page for the documentation MCP, Markdown, indexes, skill, OpenAPI, and discovery manifests. |

The three legacy `/api-reference/...mcp...` inventory entries remain consolidated into their matching `/mcp/...` preview routes. This is an inventory disposition only; no live redirects are created.

## Landing-page experience

`/mcp/airscale-mcp-server` opens with a developer-first first viewport:

1. `MCP & Agents` eyebrow.
2. `Build with Airscale MCP` title.
3. One-sentence description of search, enrichment, research, and export capabilities.
4. Copyable production server URL: `https://mcp.airscale.io/mcp`.
5. Compact cards for the tool catalog, authentication, credit safety, and agent resources.
6. A right-side configuration panel on wide screens.

The right panel uses static, copyable tabs for:

- Claude Code header-based configuration.
- Generic JSON client configuration.
- OAuth guidance for supported clients.

The panel moves inline below the relevant prose at laptop and mobile widths. It does not execute requests and never asks the reader to paste a real key into the documentation site.

After the first viewport, the page preserves and reorganizes the existing material:

- supported clients;
- OAuth versus authorization-header setup;
- safe first connection test;
- capability overview;
- export lifecycle;
- credit behavior and explicit spend confirmation;
- recommended workflow;
- security notes; and
- troubleshooting.

## Tool catalog

`/mcp/tools` is one document with a compact table of contents, four semantic category sections, and stable heading anchors for every tool.

### Workspace: one tool

- `airscale_check_credits`

### Search and research: five tools

- `airscale_find_people`
- `airscale_count_find_people`
- `airscale_find_companies`
- `airscale_find_companies_filter_values`
- `airscale_airsearch`

### Contact and profile enrichment: nine tools

- `airscale_find_email`
- `airscale_find_email_bulk`
- `airscale_find_mobile_phone`
- `airscale_find_personal_email`
- `airscale_find_people_by_url`
- `airscale_extract_people_profile`
- `airscale_extract_company_profile`
- `airscale_reverse_email`
- `airscale_reverse_phone`

### Async exports and managed batches: seven tools

- `airscale_start_companies_export`
- `airscale_start_people_export`
- `airscale_create_contact_enrichment_batch`
- `airscale_add_contacts_to_enrichment_batch`
- `airscale_start_contact_enrichment_export`
- `airscale_get_export_status`
- `airscale_get_export_file`

Every tool block contains:

1. Exact MCP tool name as a semantic heading and stable anchor.
2. Runtime-derived description.
3. Category and free or paid behavior.
4. Required and optional input fields with types, constraints, and descriptions.
5. A minimal synthetic JSON tool-call example.
6. Expected result behavior without copying large result payloads.
7. Credit, confirmation, asynchronous, or security callouts when relevant.
8. A related API operation link for the fifteen core tools.

The catalog uses an `MCP tool` label for the MCP contract. A core tool may show its backing API method and route as secondary context, but export and batch tools are not falsely presented as public API operations.

Essential content remains visible in semantic Markdown. Accordions may hold supplementary detail, but a tool's purpose, inputs, spend behavior, and result behavior cannot exist only inside a collapsed interaction.

## Contract manifest and drift control

The docs repository adds a checked-in, deterministic MCP contract manifest sourced from an exact Airscale application SHA. The manifest records:

- source repository and SHA;
- generation timestamp or deterministic source date;
- all twenty-two tool names in runtime order;
- category;
- description;
- JSON input schema;
- free, variable-cost, or paid-export classification;
- explicit confirmation requirements;
- asynchronous behavior;
- related OpenAPI operation where one exists; and
- documentation anchor.

The implementation must not scrape the public Framer HTML to construct the tool catalog. Framer content is migration input, not contract authority.

Tests fail closed when:

- the manifest does not contain exactly twenty-two unique tools;
- category totals are not `1 + 5 + 9 + 7`;
- a core tool cannot map to its approved OpenAPI operation;
- a tool lacks an anchor, description, schema, or spend classification;
- an API key appears as a tool argument;
- a paid export-start tool omits explicit `confirm_credit_spend` guidance; or
- the rendered catalog and machine-readable tool manifest drift from the checked-in contract.

## Content fidelity and known corrections

Existing content is preserved where it remains accurate, but runtime-backed corrections are mandatory.

- `airscale_airsearch` costs two credits per call according to the runtime registry. The current Framer MCP page says one credit and must be corrected during migration.
- The catalog contains twenty-two tools, including the three managed contact-enrichment tools absent from the package README.
- Managed contact enrichment is described as work-email-only in its current phase.
- Large people and company exports support up to 10,000 rows and require explicit spend confirmation.
- OAuth clients authenticate in the browser; API keys are not pasted into OAuth setup or accepted as tool arguments.
- Header-based developer clients use the authorization header with a placeholder, never a real credential.
- Client UI labels and account-tier requirements are verified at implementation time and described defensively because third-party product labels can change.

## Connect pages

The ChatGPT and Claude pages retain their existing step-by-step intent. Each follows one shared template:

1. What the integration enables.
2. Exact MCP server URL.
3. Prerequisites.
4. Authentication model.
5. Numbered connection steps.
6. Free `check credits` validation prompt.
7. Recommended starter prompts.
8. Credit and approval behavior.
9. Troubleshooting.
10. Related catalog and workflow links.

Screenshots are used only when they show current, real client UI. They require descriptive alt text and must not contain personal accounts, workspace data, credentials, or other private information. Where client UI is too volatile, numbered text steps and labeled callouts are preferred over stale screenshots.

## Workflow page

`/mcp/how-to-use-the-airscale-mcp` becomes a concise workflow guide rather than a duplicate overview. It covers:

- verify the connection for free;
- count or discover filters before searching;
- run a narrow sample;
- refine the request;
- review the maximum spend;
- start an async export only after explicit confirmation;
- poll status with the server-provided interval; and
- retrieve the completed file.

Examples use synthetic companies, people, domains, and identifiers. No example performs a live call.

## Agent resources

`/mcp/agent-resources` makes the machine-readable layer visible to humans and agents. It distinguishes:

### Airscale MCP server

- Production endpoint: `https://mcp.airscale.io/mcp`.
- Authenticated product surface.
- Can perform searches, enrichment, research, and exports.
- Some tools consume workspace credits.

### Airscale documentation MCP

- Mintlify-provided read-only documentation surface.
- Used to search and retrieve public documentation.
- Does not execute Airscale product tools or consume Airscale credits.

### Published discovery resources

- `/openapi.json`
- `/llms.txt`
- `/llms-full.txt`
- page-level `.md` exports
- Markdown content negotiation
- `/skill.md`
- `/.well-known/agent-skills/index.json`
- `/.well-known/api-catalog`
- a structured MCP tool manifest
- the documentation MCP server card or connection instructions

`llms.txt` is a compact directory with discriminating descriptions. `llms-full.txt` is the full public corpus. `skill.md` is a curated workflow and safety summary, not a duplicate catalog. The structured MCP tool manifest carries exact names and input schemas from the same source-pinned contract used by the visible catalog.

All absolute links resolve on `https://airscale.mintlify.app`. Generated content must not point at `docs.airscale.io` while that domain serves Framer.

## Search and indexing behavior

The preview remains intentionally excluded from traditional search indexing. This work makes the content future-ready without changing that boundary.

Every MCP page has:

- a unique title and description;
- one semantic H1;
- preview-host canonical metadata;
- descriptive internal links;
- clean page-level Markdown;
- useful headings and anchors;
- representative keywords written naturally; and
- no duplicate canonical page in API Reference.

The preview sitemap is used for completeness testing only and is not submitted to search engines.

## Visual system and responsive behavior

The section reuses the deployed API-reference system:

- Airscale light and dark logos;
- Poppins typography;
- primary blue `#4079FF` and dark-mode blue `#6F9BFF`;
- Mint theme and Lucide icons;
- compact cards, callouts, tables, and code blocks;
- breadcrumb eyebrows; and
- consistent header, footer, search, and dashboard controls.

FullEnrich influences information density, explicit technical labels, and the right-side example model. It does not influence brand colors, logo, naming, or voice.

Responsive acceptance widths are:

- wide desktop;
- 1200-pixel laptop;
- 390-pixel mobile.

At narrow widths, the right panel becomes inline, tables remain horizontally usable, headings and tool names wrap without clipping, and all controls remain keyboard accessible.

## Verification and release gates

Local verification includes:

- contract and content tests;
- catalog generation freshness;
- Mintlify validation;
- internal-link and anchor checks;
- machine-readable link checks;
- secret and production-fixture detection;
- preview canonical and `noindex` checks; and
- the complete existing test suite.

Browser verification covers:

- the landing page;
- the top and middle of the long tool catalog;
- both connection guides;
- the workflow guide;
- agent resources;
- desktop, laptop, and mobile;
- light and dark themes;
- keyboard navigation;
- code copying and overflow;
- relevant console errors; and
- absence of requests to `api.airscale.io` or billable MCP tool calls.

Hosted verification requires:

- all six MCP pages return HTTP 200;
- MCP navigation is present beside API Reference;
- preview canonicals and `noindex` remain correct;
- all discovery files resolve with expected content types;
- the documentation MCP is presented as read-only;
- the safe live MCP health endpoint reports twenty-two tools;
- OAuth protected-resource and authorization-server metadata return HTTP 200;
- no DNS or Framer state changed; and
- verification remains stable across repeated hosted rounds.

## Acceptance criteria

The feature is complete when:

- the `MCP & Agents` tab contains exactly the approved six pages;
- the four canonical legacy MCP routes are preserved;
- the landing page is developer-first and shows the production MCP URL above the fold;
- the right-side configuration panel is present on desktop and usable inline on smaller screens;
- the catalog contains exactly twenty-two tools in the approved four groups;
- every tool has a stable anchor and complete contract summary;
- Airsearch is documented at two credits per call;
- paid export starts clearly require explicit confirmation;
- ChatGPT and Claude setup flows use OAuth language correctly;
- operational and documentation MCP surfaces are clearly distinguished;
- all approved machine-readable resources are visible and resolve on the preview host;
- all preview pages remain `noindex` with preview-host canonicals;
- all automated and browser checks pass; and
- no DNS, redirect, Framer, provider, credit, or production-data mutation occurs.

## Explicit non-goals

- Migrating the rest of the product knowledge base in this slice.
- Changing `docs.airscale.io` DNS or Mintlify custom-domain configuration.
- Replacing, editing, or redirecting the live Framer documentation.
- Adding a live API or MCP playground.
- Executing a paid MCP tool during QA.
- Modifying the Airscale MCP Worker or public API implementation.
- Creating one navigable documentation page per MCP tool.
- Copying FullEnrich's brand or page chrome.
- Submitting the preview sitemap to search engines.
