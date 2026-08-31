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
  { group: "Start", pages: ["mcp/airscale-mcp-server", "mcp/tools"] },
  {
    group: "Connect",
    pages: ["mcp/connect-airscale-mcp-to-chatgpt", "mcp/connect-airscale-mcp-to-claude"]
  },
  { group: "Use", pages: ["mcp/how-to-use-the-airscale-mcp"] },
  { group: "For agents", pages: ["mcp/agent-resources"] }
];

const MCP_PAGE_PATHS = MCP_GROUPS.flatMap(({ pages }) => pages);
function readPage(path) {
  const source = readFileSync(`${path}.mdx`, "utf8");
  const match = source.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  assert.ok(match, `${path} must have YAML frontmatter`);
  const document = parseDocument(match[1]);
  assert.equal(document.errors.length, 0, `${path} frontmatter must parse as YAML`);
  return { source, body: match[2], frontmatter: document.toJS() };
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

test("MCP and Agents is a peer tab with exactly six pages while API Reference stays unchanged", () => {
  const config = JSON.parse(readFileSync("docs.json", "utf8"));
  assert.equal(config.navigation.tabs.length, 2);
  assert.deepEqual(config.navigation.tabs[0], API_REFERENCE_TAB);
  assert.deepEqual(config.navigation.tabs[1], { tab: "MCP & Agents", groups: MCP_GROUPS });
  assert.equal(config.styling.eyebrows, "breadcrumbs");
  assert.equal(config.navigation.tabs[1].groups[0].group, "Start");
  const landing = readPage(config.navigation.tabs[1].groups[0].pages[0]);
  assert.equal(landing.frontmatter.title, "Build with Airscale MCP");
  assert.equal(landing.frontmatter.sidebarTitle, "Airscale MCP server");
  assert.doesNotMatch(landing.body, /<Badge\b[^>]*>MCP & Agents<\/Badge>|^## Build with Airscale MCP$/m);
  assert.equal(MCP_PAGE_PATHS.length, 6);
  assert.equal(new Set(MCP_PAGE_PATHS).size, 6);
  assert.deepEqual(
    readdirSync("mcp").filter((name) => name.endsWith(".mdx")).map((name) => `mcp/${name.slice(0, -4)}`).sort(),
    [...MCP_PAGE_PATHS].sort()
  );
});

test("all six MCP pages have unique preview metadata, safe MDX, and resolving documentation links", () => {
  const titles = new Set();
  const descriptions = new Set();

  for (const path of MCP_PAGE_PATHS) {
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

  for (const path of MCP_PAGE_PATHS) {
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
    "Tool catalog",
    "Authentication",
    "Credit safety",
    "Agent resources",
    "Configure your client",
    "</Columns>",
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
  assert.equal((overviewColumn.match(/<Card\b/g) ?? []).length, 4);
  assert.match(overviewColumn, /```text\nhttps:\/\/mcp\.airscale\.io\/mcp\n```/);
  assert.match(overviewColumn, /22 typed tools/);
  assert.doesNotMatch(overviewColumn, /<CodeGroup>/);
  assert.match(configurationColumn, /<CodeGroup>[\s\S]*Claude Code[\s\S]*Client field mapping \(conceptual\)[\s\S]*OAuth client[\s\S]*<\/CodeGroup>/);
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

test("MCP landing first viewport uses two direct responsive columns", () => {
  const { body } = readPage("mcp/airscale-mcp-server");
  const [overviewColumn, configurationColumn] = directColumnBodies(body, "mcp/airscale-mcp-server");
  assert.match(overviewColumn, /22 typed tools[\s\S]*https:\/\/mcp\.airscale\.io\/mcp[\s\S]*<CardGroup cols=\{2\}>/);
  assert.match(configurationColumn, /Configure your client[\s\S]*<CodeGroup>/);
  assert.ok(body.indexOf("</Columns>") < body.indexOf("## Supported clients"));
});

test("landing configuration uses Claude's exact environment syntax and labels conceptual mappings", () => {
  const source = readFileSync("mcp/airscale-mcp-server.mdx", "utf8");
  assert.match(source, /export AIRSCALE_API_KEY=YOUR_API_KEY/);
  assert.match(source, /"Authorization": "Bearer \$\{AIRSCALE_API_KEY\}"/);
  assert.doesNotMatch(source, /```json Generic JSON client|"transport": "streamable-http"/);
  assert.match(source, /Client field mapping \(conceptual\)[\s\S]*not a copy-paste configuration/i);
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
    ["mcp/how-to-use-the-airscale-mcp", /free[\s\S]*credit[\s\S]*(?:sample|workflow)/i],
    ["mcp/agent-resources", /agent[\s\S]*(?:machine-readable|tool catalog)/i]
  ]);

  for (const [path, expectation] of expectations) {
    const { body } = readPage(path);
    assert.match(body, expectation, `${path} must have meaningful introductory guidance`);
    assert.doesNotMatch(body, /TODO|TBD|coming soon|placeholder|under construction/i);
    assert.match(body, /\/mcp\/(?:airscale-mcp-server|tools)/, `${path} must guide readers to an existing MCP reference`);
  }
});
