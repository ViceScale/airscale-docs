import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { parseDocument } from "yaml";
import {
  assertBalancedCodeFences,
  assertLocalDocumentationLinksResolve,
  assertNoStaticCredentials,
  hasUnsafeBearerAuthorization
} from "./helpers/content-safety.mjs";

const API_REFERENCE_TAB = {
  tab: "API Reference",
  groups: [
    {
      group: "Start here",
      pages: [
        "api-reference/api-overview",
        "api-reference/authentication",
        "api-reference/rate-limits"
      ]
    },
    {
      group: "Search and discovery",
      pages: [
        "api-reference/find-people",
        "api-reference/find-people/count",
        "api-reference/find-companies",
        "api-reference/find-companies/filter-values",
        "api-reference/airsearch"
      ]
    },
    {
      group: "Contact data",
      pages: [
        "api-reference/email-finder",
        "api-reference/email-finder-(bulk)",
        "api-reference/mobile-finder",
        "api-reference/personal-email",
        "api-reference/people-url-finder"
      ]
    },
    {
      group: "Profiles and reverse lookup",
      pages: [
        "api-reference/extract-people-profile",
        "api-reference/extract-company-profile",
        "api-reference/reverse-email",
        "api-reference/reverse-phone"
      ]
    },
    {
      group: "Account",
      pages: ["api-reference/credit-count"]
    }
  ]
};

const MCP_GROUPS = [
  {
    group: "Getting started",
    pages: [
      "mcp/how-to-use-the-airscale-mcp",
      "mcp/connect-airscale-mcp-to-chatgpt",
      "mcp/connect-airscale-mcp-to-claude",
      "mcp/airscale-mcp-server"
    ]
  }
];

const VISIBLE_MCP_PAGE_PATHS = MCP_GROUPS.flatMap(({ pages }) => pages);
const DIRECT_ONLY_MCP_PAGE_PATHS = ["mcp/tools", "mcp/agent-resources"];
const ALL_MCP_PAGE_PATHS = [...VISIBLE_MCP_PAGE_PATHS, ...DIRECT_ONLY_MCP_PAGE_PATHS];
const MCP_TOOLS = new Map(
  JSON.parse(readFileSync("contracts/mcp-tools.json", "utf8")).tools.map((tool) => [tool.name, tool])
);
const CONNECT_PAGE_PATHS = [
  "mcp/connect-airscale-mcp-to-chatgpt",
  "mcp/connect-airscale-mcp-to-claude"
];
const CONNECT_PAGE_HEADINGS = [
  "What this enables",
  "Server URL",
  "Prerequisites",
  "Authentication",
  "Connect Airscale MCP",
  "Verify the connection for free",
  "Starter prompts",
  "Credits and approval",
  "Troubleshooting",
  "Next steps"
];
const SYNTHETIC_FULL_NAMES = new Set(["Jordan Example", "Taylor Example"]);

function readPage(path) {
  const source = readFileSync(`${path}.mdx`, "utf8");
  const match = source.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  assert.ok(match, `${path} must have YAML frontmatter`);
  const document = parseDocument(match[1]);
  assert.equal(document.errors.length, 0, `${path} frontmatter must parse as YAML`);
  return { source, body: match[2], frontmatter: document.toJS() };
}

function documentedExamples(source) {
  const fenced = Array.from(
    source.matchAll(/^```[^\n]*\n([\s\S]*?)^```/gm),
    ([, content]) => ({ content, kind: "fence" })
  );
  const prompts = Array.from(
    source.matchAll(/^>\s+(.+)$/gm),
    ([, content]) => ({ content, kind: "prompt" })
  );
  return [...fenced, ...prompts];
}

function identityValues(value) {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(identityValues);
  if (!value || typeof value !== "object") return [];
  return Object.values(value).flatMap(identityValues);
}

function assertJsonIdentitiesAreSynthetic(value, path, exampleIndex) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const nested of value) assertJsonIdentitiesAreSynthetic(nested, path, exampleIndex);
    return;
  }

  const entries = Object.entries(value);
  for (const [key, nested] of entries) {
    if (!/^(?:full_?name|name)$/i.test(key)) continue;
    for (const fullName of identityValues(nested)) {
      assert.ok(
        SYNTHETIC_FULL_NAMES.has(fullName),
        `${path} example ${exampleIndex} identity ${fullName} must be explicitly synthetic`
      );
    }
  }

  const firstEntry = entries.find(([key]) => /^(?:first_?name|firstname)$/i.test(key));
  const lastEntry = entries.find(([key]) => /^(?:last_?name|lastname)$/i.test(key));
  if (firstEntry && lastEntry) {
    const firstNames = identityValues(firstEntry[1]);
    const lastNames = identityValues(lastEntry[1]);
    for (const firstName of firstNames) {
      for (const lastName of lastNames) {
        const fullName = `${firstName} ${lastName}`;
        assert.ok(
          SYNTHETIC_FULL_NAMES.has(fullName),
          `${path} example ${exampleIndex} identity ${fullName} must be explicitly synthetic`
        );
      }
    }
  }

  for (const [, nested] of entries) assertJsonIdentitiesAreSynthetic(nested, path, exampleIndex);
}

function assertExamplesUseSyntheticData(source, path) {
  const examples = documentedExamples(source);
  assert.ok(examples.length > 0, `${path} must contain at least one documented example`);

  for (const [index, { content: example, kind }] of examples.entries()) {
    for (const domain of example.match(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b/gi) ?? []) {
      if (domain.toLowerCase() === "mcp.airscale.io") continue;
      assert.match(
        domain.toLowerCase(),
        /(?:^|\.)example\.(?:com|net|org)$|(?:^|\.)[a-z0-9-]+\.(?:test|example)$/,
        `${path} example ${index} domain ${domain} must be reserved`
      );
    }

    for (const match of example.matchAll(/(?<![\w])\+?\d[\d\s().-]{5,}\d(?![\w])/g)) {
      if ((match[0].match(/\d/g) ?? []).length >= 8) {
        assert.fail(`${path} example ${index} must not contain a phone number`);
      }
    }

    if (kind === "prompt") {
      const prose = example.replace(/`[^`]*`/g, " ").replace(/\bAirscale MCP\b/g, " ");
      for (const match of prose.matchAll(/\b([A-Z][a-z]+(?:['-][A-Za-z]+)?)\s+([A-Z][a-z]+(?:['-][A-Za-z]+)?)\b/g)) {
        const fullName = `${match[1]} ${match[2]}`;
        assert.ok(
          SYNTHETIC_FULL_NAMES.has(fullName),
          `${path} example ${index} identity ${fullName} must be explicitly synthetic`
        );
      }
    }

    if (example.trimStart().startsWith("{")) {
      assertJsonIdentitiesAreSynthetic(JSON.parse(example), path, index);
    }
  }
}

function assertOrdered(source, labels, path) {
  let previousIndex = -1;
  for (const label of labels) {
    const index = source.indexOf(label);
    assert.ok(index > previousIndex, `${path} must place ${label} after the preceding section`);
    previousIndex = index;
  }
}

function directColumnBodies(body, path) {
  const columns = body.trimStart().match(/^<Columns cols=\{2\}>\n([\s\S]*?)\n<\/Columns>(?:\n|$)/);
  assert.ok(columns, `${path} must begin with a two-column Columns component`);
  const columnMatches = Array.from(columns[1].matchAll(/<Column>\n([\s\S]*?)\n<\/Column>/g));
  assert.equal(columnMatches.length, 2, `${path} must contain exactly two Column children`);
  assert.equal(columns[1].replace(/<Column>\n[\s\S]*?\n<\/Column>/g, "").trim(), "", `${path} Columns must contain only Column children`);
  return columnMatches.map((match) => match[1]);
}

test("MCP and Agents mirrors the four-page AirSchool getting-started flow", () => {
  const config = JSON.parse(readFileSync("docs.json", "utf8"));
  assert.equal(config.navigation.tabs.length, 2);
  assert.deepEqual(config.navigation.tabs[0], API_REFERENCE_TAB);
  assert.deepEqual(config.navigation.tabs[1], { tab: "MCP & Agents", groups: MCP_GROUPS });
  assert.equal(config.styling.eyebrows, "breadcrumbs");
  const visiblePagePaths = config.navigation.tabs[1].groups.flatMap(({ pages }) => pages);
  assert.deepEqual(visiblePagePaths, VISIBLE_MCP_PAGE_PATHS);
  for (const path of DIRECT_ONLY_MCP_PAGE_PATHS) {
    assert.ok(existsSync(`${path}.mdx`), `${path} must remain available as a direct route`);
    assert.equal(visiblePagePaths.includes(path), false, `${path} must not appear in visible navigation`);
  }
  assert.equal(ALL_MCP_PAGE_PATHS.length, 6);
  assert.equal(new Set(ALL_MCP_PAGE_PATHS).size, 6);
  assert.deepEqual(
    readdirSync("mcp").filter((name) => name.endsWith(".mdx")).map((name) => `mcp/${name.slice(0, -4)}`).sort(),
    [...ALL_MCP_PAGE_PATHS].sort()
  );
});

test("all six MCP pages have unique preview metadata, safe MDX, and resolving documentation links", () => {
  const titles = new Set();
  const descriptions = new Set();

  for (const path of ALL_MCP_PAGE_PATHS) {
    assert.ok(existsSync(`${path}.mdx`), `${path} must exist`);
    const { source, body, frontmatter } = readPage(path);
    assert.equal(typeof frontmatter.title, "string", `${path} must have a title`);
    assert.ok(frontmatter.title.trim(), `${path} title must not be empty`);
    assert.equal(typeof frontmatter.description, "string", `${path} must have a description`);
    assert.ok(frontmatter.description.trim(), `${path} description must not be empty`);
    assert.equal(frontmatter.canonical, `https://airscale.mintlify.app/${path}`);
    assert.equal(titles.has(frontmatter.title.toLowerCase()), false, `${path} title must be unique`);
    assert.equal(descriptions.has(frontmatter.description.toLowerCase()), false, `${path} description must be unique`);
    titles.add(frontmatter.title.toLowerCase());
    descriptions.add(frontmatter.description.toLowerCase());
    assert.doesNotMatch(body, /^#\s+/m, `${path} must not contain a body H1`);
    assertBalancedCodeFences(source, path);
    assertNoStaticCredentials(source, path);
    assertLocalDocumentationLinksResolve(source, path);
    assert.doesNotMatch(source, /<ApiPlayground\b|<TryIt\b|https:\/\/api\.airscale\.io\/v1\b/i);
    assert.doesNotMatch(source, /^\s*(?:curl|wget|httpie?)\b|\bfetch\s*\(|\brequests\.(?:get|post|request)\s*\(/gim);
  }
});

test("credential checks reject static secrets while allowing only the documented environment placeholder", () => {
  for (const unsafe of [
    "Authorization: Bearer live-secret-token",
    "Authorization: Bearer $WRONG_VARIABLE",
    "Authorization: Bearer ${WRONG_VARIABLE}",
    "AIRSCALE_API_KEY=live-secret-token",
    "export AIRSCALE_API_KEY=live-secret-token",
    '{ "Authorization": "Bearer json-token" }'
  ]) {
    assert.equal(hasUnsafeBearerAuthorization(unsafe), true, `${unsafe} must be rejected`);
  }
  assert.equal(hasUnsafeBearerAuthorization("export AIRSCALE_API_KEY=YOUR_API_KEY\nAuthorization: Bearer ${AIRSCALE_API_KEY}"), false);

  for (const path of ALL_MCP_PAGE_PATHS) {
    const source = readFileSync(`${path}.mdx`, "utf8");
    for (const line of source.split("\n").filter((candidate) => candidate.includes("YOUR_API_KEY"))) {
      assert.equal(line.trim(), "export AIRSCALE_API_KEY=YOUR_API_KEY", `${path} must use YOUR_API_KEY only as the exact environment assignment`);
    }
  }
});

test("MCP landing page is developer-first, complete, and non-executing", () => {
  const source = readFileSync("mcp/airscale-mcp-server.mdx", "utf8");
  const { body, frontmatter } = readPage("mcp/airscale-mcp-server");
  assert.deepEqual(frontmatter, {
    title: "Build with Airscale MCP",
    sidebarTitle: "Airscale MCP server",
    description: "Connect AI clients and agents to Airscale search, enrichment, research, and export tools.",
    canonical: "https://airscale.mintlify.app/mcp/airscale-mcp-server"
  });
  assertOrdered(body, [
    "<Columns cols={2}>",
    "search, enrichment, research, and exports",
    "https://mcp.airscale.io/mcp",
    "### Configure your client",
    "</Columns>",
    "<CardGroup cols={2}>",
    '<Card title="Tool catalog"',
    '<Card title="Authentication"',
    '<Card title="Credit safety"',
    '<Card title="Agent resources"',
    "## Supported clients",
    "## Choose OAuth or header authentication",
    "## Verify the connection for free",
    "## Capability overview",
    "## Run asynchronous exports safely",
    "## Understand credits and approval",
    "## Recommended workflow",
    "## Security",
    "## Troubleshooting"
  ], "mcp/airscale-mcp-server");

  const [overviewColumn, configurationColumn] = directColumnBodies(body, "mcp/airscale-mcp-server");
  assert.equal((overviewColumn.match(/<Card\b/g) ?? []).length, 0);
  assert.match(overviewColumn, /```text\nhttps:\/\/mcp\.airscale\.io\/mcp\n```/);
  assert.match(overviewColumn, /22 typed tools/);
  assert.doesNotMatch(overviewColumn, /<CodeGroup>/);
  assert.match(configurationColumn, /### Configure your client[\s\S]*<CodeGroup>[\s\S]*Claude Code[\s\S]*Field mapping[\s\S]*OAuth[\s\S]*<\/CodeGroup>/);
  assert.match(configurationColumn, /not a copy-paste configuration/i);
  assert.doesNotMatch(configurationColumn, /Generic JSON client|"transport": "streamable-http"/);
  assert.match(configurationColumn, /export AIRSCALE_API_KEY=YOUR_API_KEY/);
  assert.match(configurationColumn, /"Authorization": "Bearer \$\{AIRSCALE_API_KEY\}"/);
  assert.doesNotMatch(configurationColumn, /"Authorization": "Bearer \$AIRSCALE_API_KEY"/);
  assert.match(source, /Authorization: Bearer \$AIRSCALE_API_KEY/);
  assert.match(source, /airscale_check_credits/);
  assert.match(source, /confirm_credit_spend/);
  assert.match(source, /poll|status/i);
  assert.match(source, /\[MCP tool catalog\]\(\/mcp\/tools\)/);
  assert.match(source, /\/api-reference\/(?:credit-count|authentication)/);
  assert.doesNotMatch(source, /<ApiPlayground\b|<TryIt\b|https:\/\/api\.airscale\.io\/v1\b/i);
});

test("MCP landing hero uses two direct responsive columns without cramped nested cards", () => {
  const { body } = readPage("mcp/airscale-mcp-server");
  const [overviewColumn, configurationColumn] = directColumnBodies(body, "mcp/airscale-mcp-server");
  assert.match(overviewColumn, /22 typed tools[\s\S]*https:\/\/mcp\.airscale\.io\/mcp/);
  assert.doesNotMatch(overviewColumn, /<CardGroup|<Card\b/);
  assert.match(configurationColumn, /### Configure your client[\s\S]*<CodeGroup>/);
  const columnsEnd = body.indexOf("</Columns>");
  const resourceCards = body.indexOf("<CardGroup cols={2}>", columnsEnd);
  assert.ok(columnsEnd < resourceCards);
  assert.ok(resourceCards < body.indexOf("## Supported clients"));
});

test("landing configuration uses Claude's exact environment syntax and labels conceptual mappings", () => {
  const source = readFileSync("mcp/airscale-mcp-server.mdx", "utf8");
  assert.match(source, /export AIRSCALE_API_KEY=YOUR_API_KEY/);
  assert.match(source, /"Authorization": "Bearer \$\{AIRSCALE_API_KEY\}"/);
  assert.doesNotMatch(source, /```json Generic JSON client|"transport": "streamable-http"/);
  assert.match(source, /```text Field mapping[\s\S]*conceptual field mapping[\s\S]*not a copy-paste configuration/i);
});

test("documentation links validate missing fragments, explicit anchors, and heading slugs", () => {
  assert.throws(
    () => assertLocalDocumentationLinksResolve("[Broken](/mcp/tools#missing-fragment)", "fragment fixture"),
    /fragment.*missing-fragment/i
  );
  assert.doesNotThrow(() => assertLocalDocumentationLinksResolve(
    "[Category](/mcp/tools#async-exports-and-managed-batches)\n[Tool](/mcp/tools#airscale-check-credits)",
    "fragment fixture"
  ));
  assert.doesNotThrow(() => assertLocalDocumentationLinksResolve("[Tool](#airscale-check-credits)", "mcp/tools"));
});

test("API and MCP page tests import one shared credential and link safety helper", () => {
  for (const path of ["tests/site.test.mjs", "tests/mcp-pages.test.mjs"]) {
    const source = readFileSync(path, "utf8");
    assert.match(source, /from "\.\/helpers\/content-safety\.mjs";/, `${path} must import the shared helper`);
    assert.doesNotMatch(source, /function (?:hasUnsafeBearerAuthorization|localDocumentationLinks|assertLocalDocumentationLinksResolve|assertNoStaticCredentials)\b/);
  }
  assert.ok(existsSync("tests/helpers/content-safety.mjs"));
});

test("route shells introduce their subject without claiming unfinished walkthroughs", () => {
  const expectations = new Map([
    ["mcp/connect-airscale-mcp-to-chatgpt", /ChatGPT[\s\S]*OAuth/i],
    ["mcp/connect-airscale-mcp-to-claude", /Claude[\s\S]*(?:OAuth|header)/i],
    ["mcp/how-to-use-the-airscale-mcp", /prospect[\s\S]*Claude[\s\S]*ChatGPT/i],
    ["mcp/agent-resources", /agent[\s\S]*(?:machine-readable|tool catalog)/i]
  ]);

  for (const [path, expectation] of expectations) {
    const { body } = readPage(path);
    assert.match(body, expectation, `${path} must have meaningful introductory guidance`);
    assert.doesNotMatch(body, /TODO|TBD|coming soon|placeholder|under construction/i);
    assert.match(body, /\/mcp\/(?:airscale-mcp-server|tools)/, `${path} must guide readers to an existing MCP reference`);
  }
});

test("connection guides share a complete, ordered setup template", () => {
  for (const path of CONNECT_PAGE_PATHS) {
    const { body } = readPage(path);
    assertOrdered(body, CONNECT_PAGE_HEADINGS.map((heading) => `## ${heading}`), path);
    assert.match(body, /https:\/\/mcp\.airscale\.io\/mcp/);
    assert.match(body, /browser[\s\S]*sign[ -]?in|sign[ -]?in[\s\S]*browser/i);
    assert.match(body, /<Steps>[\s\S]*(?:<Step\b[\s\S]*){4,}<\/Steps>/);
    assert.match(body, /airscale_check_credits/);
    assert.match(body, /free|does not debit credits/i);
    assert.match(body, /Airsearch costs 2 credits per call/);
    assert.match(body, /work-email-only/i);
    assert.match(body, /confirm_credit_spend/);
    assert.match(body, /\[MCP tool catalog\]\(\/mcp\/tools\)/);
    assert.match(body, /\[safe MCP workflow\]\(\/mcp\/how-to-use-the-airscale-mcp\)/);
    assert.doesNotMatch(body, /TODO|TBD|coming soon|placeholder|under construction/i);
  }
});

test("ChatGPT setup is browser OAuth only and never configures an API key", () => {
  const { body } = readPage("mcp/connect-airscale-mcp-to-chatgpt");
  assert.match(body, /browser OAuth/i);
  assert.match(body, /do not paste an Airscale API key/i);
  assert.doesNotMatch(body, /AIRSCALE_API_KEY|YOUR_API_KEY|Authorization\s*:\s*Bearer|API key field|header-based/i);
  assert.doesNotMatch(body, /tool arguments[\s\S]{0,80}(?:api[_ -]?key|credential)/i);
});

test("ChatGPT setup follows current full-MCP plan, role, draft, and per-message rules", () => {
  const { body } = readPage("mcp/connect-airscale-mcp-to-chatgpt");
  assert.match(body, /ChatGPT web[\s\S]*Business[\s\S]*Enterprise\/Edu[\s\S]*full MCP/i);
  assert.match(body, /Business[\s\S]{0,160}(?:admin|owner)[\s\S]{0,120}(?:create|creation)/i);
  assert.match(body, /Enterprise\/Edu[\s\S]{0,180}RBAC[\s\S]{0,180}authorized developer/i);
  assertOrdered(body, [
    "Select **OAuth**",
    "**Scan Tools**",
    "complete the Airscale OAuth flow",
    "**Create**",
    "draft app"
  ], "mcp/connect-airscale-mcp-to-chatgpt");
  assert.match(body, /selection applies[\s\S]{0,100}(?:message|one message)[\s\S]{0,100}not[\s\S]{0,60}(?:conversation|entire conversation)/i);
  assert.match(body, /https:\/\/help\.openai\.com\/en\/articles\/12584461/);
});

test("Claude setup distinguishes hosted OAuth from Claude Code header authentication", () => {
  const { body } = readPage("mcp/connect-airscale-mcp-to-claude");
  assert.match(body, /Claude (?:web|desktop)[\s\S]*remote OAuth/i);
  assert.match(body, /where supported/i);
  assert.match(body, /Claude Code/);
  assert.match(body, /export AIRSCALE_API_KEY=YOUR_API_KEY/);
  assert.match(body, /"Authorization": "Bearer \$\{AIRSCALE_API_KEY\}"/);
  assert.doesNotMatch(body, /"Authorization": "Bearer \$AIRSCALE_API_KEY"/);
  assert.match(body, /never[\s\S]{0,100}(?:tool argument|prompt)/i);
});

test("Claude setup branches individual and organization-hosted connector flows", () => {
  const { body } = readPage("mcp/connect-airscale-mcp-to-claude");
  assert.match(body, /Free[\s\S]{0,120}Pro[\s\S]{0,80}Max/i);
  assert.match(body, /Free[\s\S]{0,160}(?:one|1) custom connector/i);
  assert.match(body, /Free, Pro, or Max[\s\S]{0,240}(?:add|create)[\s\S]{0,100}custom connector/i);
  assert.match(body, /Team or Enterprise[\s\S]{0,240}(?:Owner|Primary Owner)[\s\S]{0,160}Custom[\s\S]{0,80}Web/i);
  assert.match(body, /member[\s\S]{0,180}Connect[\s\S]{0,120}authenticate/i);
  assert.match(body, /https:\/\/support\.claude\.com\/en\/articles\/11175166/);
});

test("Claude Code JSON is explicitly project-scoped and includes connection verification", () => {
  const { body } = readPage("mcp/connect-airscale-mcp-to-claude");
  assert.match(body, /project-scoped[\s\S]{0,100}`\.mcp\.json`/i);
  assert.match(body, /project root/i);
  assert.match(body, /```json Project \.mcp\.json[\s\S]*"mcpServers"/);
  assert.match(body, /claude mcp list|`\/mcp`/);
  assert.doesNotMatch(body, /user or project MCP configuration/i);
  assert.match(body, /https:\/\/code\.claude\.com\/docs\/en\/mcp/);
});

test("MCP entry page mirrors the AirSchool Claude-demo narrative", () => {
  const path = "mcp/how-to-use-the-airscale-mcp";
  const { body, frontmatter } = readPage(path);
  assert.deepEqual(frontmatter, {
    title: "How to use the Airscale MCP (+Claude demo)",
    sidebarTitle: "How to use the Airscale MCP (+Claude demo)",
    description: "Prospect through conversation with Airscale search, enrichment, and export tools.",
    canonical: "https://airscale.mintlify.app/mcp/how-to-use-the-airscale-mcp"
  });
  assert.match(body, /<Frame>/);
  assert.match(body, /<iframe\b/);
  const frameStart = body.indexOf("<Frame>");
  const frameEnd = body.indexOf("</Frame>", frameStart);
  const iframe = body.slice(frameStart, frameEnd).match(/<iframe\b[\s\S]*?\/>/)?.[0];
  assert.ok(iframe, "Frame must contain a self-closing iframe");
  assert.match(iframe, /(?:^|\s)className="w-full aspect-video rounded-xl"/);
  assert.match(iframe, /(?:^|\s)src="https:\/\/www\.youtube\.com\/embed\/t4coJ0P8YVM"/);
  assert.match(iframe, /(?:^|\s)title="How to prospect with Airscale MCP in Claude"/);
  assert.match(iframe, /(?:^|\s)allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"/);
  assert.match(iframe, /(?:^|\s)referrerPolicy="strict-origin-when-cross-origin"/);
  assert.match(iframe, /(?:^|\s)allowFullScreen(?:\s|\/>)/);
  assert.match(body, /<\/Frame>/);
  assert.deepEqual(
    Array.from(body.matchAll(/^(#{2,3})\s+(.+)$/gm), ([, level, heading]) => `${level} ${heading}`),
    [
      "## What is the Airscale MCP?",
      "## How credits work",
      "## Run a search in natural language",
      "### Review your results",
      "### Enrich contacts through conversation",
      "## Export your final list",
      "## Get started"
    ]
  );
  const capabilitySection = body.slice(
    body.indexOf("## What is the Airscale MCP?"),
    body.indexOf("## How credits work")
  );
  assert.equal((capabilitySection.match(/^- /gm) ?? []).length, 6);
  assert.match(body, /22 typed tools/);
  assert.match(body, /\[MCP tool catalog\]\(\/mcp\/tools\)/);
  assert.match(body, /Find People costs 0\.1 credit per returned person/);
  assert.match(body, /Find Companies costs 0\.1 credit per returned company/);
  assert.match(body, /Airsearch costs 2 credits per call/);
  assert.match(body, /free planning tools/i);
  assert.match(body, /paid export[\s\S]{0,180}filters[\s\S]{0,120}row limit[\s\S]{0,120}maximum spend[\s\S]{0,120}(?:explicitly confirm|confirmation)/i);
  assert.match(body, /> Find up to five cybersecurity companies in France with 51–200 employees\.[^\n]*proposed tool[^\n]*maximum cost[^\n]*wait for my approval\./i);
  assert.match(body, /name[\s\S]{0,100}domain[\s\S]{0,100}website[\s\S]{0,100}country[\s\S]{0,140}filter precision/i);
  assert.match(body, /five-company sample[\s\S]{0,80}(?:at most|maximum)[\s\S]{0,40}0\.5 credits/i);
  const contactSection = body.slice(
    body.indexOf("### Enrich contacts through conversation"),
    body.indexOf("## Export your final list")
  );
  const contactPrompts = Array.from(contactSection.matchAll(/^>\s+(.+)$/gm), ([, prompt]) => prompt);
  const [discoveryPrompt = "", workEmailPrompt = ""] = contactPrompts;
  const exportSection = body.slice(
    body.indexOf("## Export your final list"),
    body.indexOf("## Get started")
  );
  const spendBoundaryContract = {
    twoSeparateContactPrompts: contactPrompts.length === 2,
    examplesAreNonExecuting: /example prompts[\s\S]{0,100}illustrative[\s\S]{0,80}non-executing/i.test(body),
    discoveryIsExplicitlyLabeled: /\bdiscovery step\b/i.test(discoveryPrompt),
    discoveryIsBoundedPerCompany: /at most one CEO[^\n]*one CFO[^\n]*one Head of Growth[^\n]*per approved company/i.test(discoveryPrompt),
    discoveryHasSeparateApprovalMath: /proposed tool[^\n]*per-step maximum cost[^\n]*cumulative workflow maximum[^\n]*wait for my approval/i.test(discoveryPrompt),
    workEmailUsesOnlyApprovedDecisionMakers: /only (?:the )?approved decision-makers[^\n]*professional work emails/i.test(workEmailPrompt),
    workEmailHasSeparateApprovalMath: /proposed tool[^\n]*contact count[^\n]*per-step maximum cost[^\n]*new cumulative workflow maximum[^\n]*wait for my approval/i.test(workEmailPrompt),
    exportIsFreshPaidSearch: /people and company exports perform a fresh paid search from the final filters/i.test(exportSection),
    exportDoesNotPackageChatRows: /do not export the selected chat rows/i.test(exportSection),
    exportMayReturnDifferentRows: /may return different rows/i.test(exportSection),
    exportAddsNewCharge: /adds? a new charge[^.]*in addition to[^.]*earlier[^.]*workflow/i.test(exportSection),
    exportRequiresRenewedApproval: /repeat the exact filters, fields, format, `max_rows`, additional maximum credits, and cumulative workflow maximum[^.]*wait for (?:my|your) approval/i.test(exportSection)
  };
  assert.deepEqual(
    spendBoundaryContract,
    {
      twoSeparateContactPrompts: true,
      examplesAreNonExecuting: true,
      discoveryIsExplicitlyLabeled: true,
      discoveryIsBoundedPerCompany: true,
      discoveryHasSeparateApprovalMath: true,
      workEmailUsesOnlyApprovedDecisionMakers: true,
      workEmailHasSeparateApprovalMath: true,
      exportIsFreshPaidSearch: true,
      exportDoesNotPackageChatRows: true,
      exportMayReturnDifferentRows: true,
      exportAddsNewCharge: true,
      exportRequiresRenewedApproval: true
    }
  );
  assert.doesNotMatch(contactSection, /\b(?:mobile|personal email|profile enrichment)\b/i);
  assert.match(body, /asynchronous[\s\S]{0,160}start[\s\S]{0,120}status[\s\S]{0,120}(?:file|download)/i);
  assert.match(body, /same `export_id`/);
  assert.match(body, /poll_after_seconds/);
  assert.match(body, /do not (?:start|create)[^\n.]*duplicate[^\n.]*(?:queued|running)/i);
  for (const route of [
    "/mcp/connect-airscale-mcp-to-chatgpt",
    "/mcp/connect-airscale-mcp-to-claude",
    "/mcp/airscale-mcp-server"
  ]) {
    assert.match(body, new RegExp(`\\(${route}\\)`));
  }
  assert.match(MCP_TOOLS.get("airscale_find_people").description, /Costs 0\.1 credits per returned lead/);
  assert.match(MCP_TOOLS.get("airscale_find_companies").description, /Costs 0\.1 credits per returned company/);
  assert.match(MCP_TOOLS.get("airscale_airsearch").description, /Costs 2 credits per call/);
  assert.doesNotMatch(body, /^## (?:Start the export|Poll status|Retrieve the file)$/m);
  assert.doesNotMatch(body, /```json|"tool"\s*:/i);
  assert.doesNotMatch(body, /["']api_key["']/i);
});

test("every connection and workflow example uses only the official endpoint and explicit synthetic data", () => {
  for (const path of [...CONNECT_PAGE_PATHS, "mcp/how-to-use-the-airscale-mcp"]) {
    assertExamplesUseSyntheticData(readPage(path).body, path);
  }
});

test("synthetic-data policy rejects mixed pages with a real identity or phone number", () => {
  const { body } = readPage("mcp/connect-airscale-mcp-to-chatgpt");
  assert.throws(
    () => assertExamplesUseSyntheticData(
      `${body}\n> Use Airscale MCP to find Satya Nadella at \`northstar.example\`.`,
      "mixed identity fixture"
    ),
    /Satya Nadella must be explicitly synthetic/
  );
  for (const prompt of [
    "Look up Satya Nadella.",
    "Search for Satya Nadella.",
    "Get the profile for Satya Nadella."
  ]) {
    assert.throws(
      () => assertExamplesUseSyntheticData(`${body}\n> ${prompt}`, "mixed prompt fixture"),
      /Satya Nadella must be explicitly synthetic/
    );
  }
  for (const payload of [
    { full_name: "Satya Nadella" },
    { name: "Satya Nadella" }
  ]) {
    assert.throws(
      () => assertExamplesUseSyntheticData(
        `${body}\n\`\`\`json\n${JSON.stringify(payload)}\n\`\`\``,
        "mixed named payload fixture"
      ),
      /Satya Nadella must be explicitly synthetic/
    );
  }
  assert.throws(
    () => assertExamplesUseSyntheticData(
      `${body}\n> Enrich the contact at +1 212 867 5309.`,
      "mixed phone fixture"
    ),
    /must not contain a phone number/
  );
  for (const phone of ["33612345678", "020 7946 0958"]) {
    assert.throws(
      () => assertExamplesUseSyntheticData(
        `${body}\n> Enrich the contact at ${phone}.`,
        "mixed international phone fixture"
      ),
      /must not contain a phone number/
    );
  }
  assert.throws(
    () => assertExamplesUseSyntheticData(
      `${body}\n\`\`\`json\n${JSON.stringify({
        firstname: { exclude: ["Satya"] },
        lastname: { exclude: ["Nadella"] }
      })}\n\`\`\``,
      "mixed payload fixture"
    ),
    /Satya Nadella must be explicitly synthetic/
  );
});

test("agent resources distinguish the operational product server from the documentation MCP", () => {
  const path = "mcp/agent-resources";
  const { body, frontmatter } = readPage(path);
  assert.deepEqual(frontmatter, {
    title: "Agent resources",
    description: "Find the human-readable and machine-readable Airscale references intended for AI agents.",
    canonical: "https://airscale.mintlify.app/mcp/agent-resources"
  });
  assert.match(body.trimStart(), /^<Columns cols=\{2\}>/);
  const [operationalCard, documentationCard] = directColumnBodies(body, path);
  assert.match(operationalCard, /authenticated product server/i);
  assert.match(operationalCard, /https:\/\/mcp\.airscale\.io\/mcp/);
  assert.match(operationalCard, /spend Airscale credits/i);
  assert.match(documentationCard, /read-only documentation/i);
  assert.match(documentationCard, /https:\/\/airscale\.mintlify\.app\/mcp/);
  assert.match(documentationCard, /does not execute Airscale product tools/i);

  const resourcePaths = [
    "https://airscale.mintlify.app/openapi.json",
    "https://airscale.mintlify.app/mcp/tools.md",
    "https://airscale.mintlify.app/llms.txt",
    "https://airscale.mintlify.app/llms-full.txt",
    "https://airscale.mintlify.app/mcp/agent-resources.md",
    "https://airscale.mintlify.app/skill.md",
    "https://airscale.mintlify.app/.well-known/agent-skills/index.json",
    "https://airscale.mintlify.app/.well-known/mcp/server-card.json",
    "https://airscale.mintlify.app/.well-known/agent-card.json"
  ];
  assertOrdered(body, ["## Machine-readable resources", ...resourcePaths, "## Connect the documentation MCP"], path);
  assert.match(body, /Accept: text\/markdown/);
  assert.match(body, /Documentation MCP server card[\s\S]{0,220}Mintlify automatically serves/i);
  assert.match(body, /Operational tool schemas[\s\S]{0,260}tools\/list/i);
  assert.match(body, /MCP tool catalog[\s\S]{0,260}text\/markdown/i);
  assert.match(body, /Agent discovery[\s\S]{0,280}Mintlify automatically generates/i);
  assert.match(body, /not an Airscale product-agent endpoint/i);
  assert.doesNotMatch(body, /\.well-known\/api-catalog|A2A|HTTP\+JSON/i);

  const connectionSection = body.slice(body.indexOf("## Connect the documentation MCP"));
  assert.match(connectionSection, /https:\/\/airscale\.mintlify\.app\/mcp/);
  assert.match(connectionSection, /Claude Code/);
  assert.match(connectionSection, /Codex/);
  assert.doesNotMatch(connectionSection, /https:\/\/mcp\.airscale\.io\/mcp/);
  assert.doesNotMatch(connectionSection, /AIRSCALE_API_KEY|YOUR_API_KEY|Authorization\s*:\s*Bearer/i);
});

test("custom agent files preserve the preview and noindex trust boundary", () => {
  const paths = [
    "llms.txt",
    "llms-full.txt",
    "skill.md",
    "mcp-tools.txt"
  ];
  for (const path of paths) {
    assert.ok(existsSync(path), `${path} must exist`);
    const source = readFileSync(path, "utf8");
    assert.doesNotMatch(source, /https:\/\/docs\.airscale\.io/i);
    assertNoStaticCredentials(source, path);
  }
  for (const path of ["llms.txt", "llms-full.txt", "skill.md", "mcp/agent-resources.mdx"]) {
    const source = readFileSync(path, "utf8");
    assert.doesNotMatch(source, /https:\/\/airscale\.mintlify\.app\/mcp-tools\.txt/i, `${path} must not advertise a root asset that hosted Mintlify drops`);
    assert.match(source, /https:\/\/airscale\.mintlify\.app\/mcp\/tools\.md/i, `${path} must advertise Mintlify's hosted Markdown catalog`);
  }
  for (const unsupportedPath of ["mcp-tools.json", ".well-known/api-catalog", ".well-known/agent-card.json"]) {
    assert.equal(existsSync(unsupportedPath), false, `${unsupportedPath} must not be authored or advertised as a static artifact`);
  }
  const config = JSON.parse(readFileSync("docs.json", "utf8"));
  assert.equal(config.seo.indexing, "navigable");
  assert.equal(config.seo.metatags.robots, "noindex, follow");
});
