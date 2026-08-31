import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { parseDocument } from "yaml";

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
const APPROVED_BEARER_VALUES = new Set(["YOUR_API_KEY", "$AIRSCALE_API_KEY", "<YOUR_API_KEY>"]);
const AUTHORIZATION_BEARER_VALUE = /\bAuthorization\b[\s:,"'`|=>(\[\]{}.fFrRuUbB-]*?\bBearer\s+(\S+)/gi;
const AIRSCALE_API_KEY_WRITE_TARGET = String.raw`(?:process\.env(?:\.AIRSCALE_API_KEY|\[(?:"AIRSCALE_API_KEY"|'AIRSCALE_API_KEY')\])|os\.environ\[(?:"AIRSCALE_API_KEY"|'AIRSCALE_API_KEY')\]|\bAIRSCALE_API_KEY\b)`;
const AIRSCALE_API_KEY_ASSIGNMENT = new RegExp(`${AIRSCALE_API_KEY_WRITE_TARGET}\\s*=(?!=)\\s*(?:(['"])([^'"\\r\\n]*)\\1|([^\\s;]+))`, "gi");

function hasUnsafeBearerAuthorization(source) {
  const hasUnsafeAssignment = Array.from(source.matchAll(AIRSCALE_API_KEY_ASSIGNMENT)).some(([, , quotedValue, unquotedValue]) => {
    const value = (quotedValue ?? unquotedValue ?? "").trim();
    const isDynamicShellValue = /^\$(?:[A-Za-z_][A-Za-z0-9_]*|\{[A-Za-z_][A-Za-z0-9_]*\})$/.test(value);
    const isDynamicEnvironmentValue = /^(?:process\.env(?:\.AIRSCALE_API_KEY|\[(?:"AIRSCALE_API_KEY"|'AIRSCALE_API_KEY')\])|os\.environ\[(?:"AIRSCALE_API_KEY"|'AIRSCALE_API_KEY')\])$/.test(value);
    return Boolean(value) && !APPROVED_BEARER_VALUES.has(value) && !isDynamicShellValue && !isDynamicEnvironmentValue;
  });
  if (hasUnsafeAssignment) return true;

  return Array.from(source.matchAll(AUTHORIZATION_BEARER_VALUE)).some(([, value]) => {
    const strippedValue = value
      .trim()
      .replace(/^```(?:[a-z][a-z0-9_-]*)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim()
      .replace(/^&lt;(.+)&gt;$/, "<$1>")
      .replace(/["'`][)\]}>},;|.!?]*$/, "")
      .replace(/^["'`]+|[)\]"'`,;|.!?]+$/g, "")
      .trim();
    const isDynamicExpression = /^(?:\$\{[A-Za-z_$][\w$]*\}|\$\{process\.env(?:\.AIRSCALE_API_KEY|\[(?:"AIRSCALE_API_KEY"|'AIRSCALE_API_KEY')\])\}|\{[A-Za-z_$][\w$]*(?:(?:\.[A-Za-z_$][\w$]*)|(?:\[(?:"[^"]+"|'[^']+'|[A-Za-z_$][\w$]*)\]))*\}|\{os\.getenv\((?:"AIRSCALE_API_KEY"|'AIRSCALE_API_KEY')\)\})$/.test(strippedValue)
      || /^["'`]\+[A-Za-z_$][\w$]*(?:[)\],;]|$)/.test(value);
    return Boolean(strippedValue)
      && strippedValue.toLowerCase() !== "authentication"
      && !isDynamicExpression
      && !APPROVED_BEARER_VALUES.has(strippedValue);
  });
}

function readPage(path) {
  const source = readFileSync(`${path}.mdx`, "utf8");
  const match = source.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  assert.ok(match, `${path} must have YAML frontmatter`);
  const document = parseDocument(match[1]);
  assert.equal(document.errors.length, 0, `${path} frontmatter must parse as YAML`);
  return { source, body: match[2], frontmatter: document.toJS() };
}

function localDocumentationLinks(source) {
  const markdownLinks = Array.from(
    source.matchAll(/\[[^\]]*\]\((\/(?:mcp|api-reference)\/(?:[^()\s?#]+|\([^()\s?#]*\))+)(?:[?#][^)]*)?\)/g),
    ([, href]) => href
  );
  const componentLinks = Array.from(
    source.matchAll(/<[A-Za-z][\w.:-]*\b[^>]*\bhref=(["'])(\/(?:mcp|api-reference)\/[^"'?#]+)(?:[?#][^"']*)?\1[^>]*>/g),
    ([, , href]) => href
  );
  return [...markdownLinks, ...componentLinks];
}

function assertLocalDocumentationLinksResolve(source, path) {
  for (const href of localDocumentationLinks(source)) {
    assert.ok(existsSync(`.${href}.mdx`), `${path} link ${href} must resolve`);
  }
}

function assertBalancedCodeFences(source, path) {
  const fenceCount = (source.match(/^[\t ]*```/gm) ?? []).length;
  assert.equal(fenceCount % 2, 0, `${path} must have balanced code fences`);
}

function assertNoStaticCredentials(source, path) {
  assert.doesNotMatch(source, /\b(?:sk|pk)_live_[A-Za-z0-9_-]+\b/i, `${path} must not contain live credentials`);
  assert.equal(hasUnsafeBearerAuthorization(source), false, `${path} must not contain a static Bearer credential`);
}

function assertOrdered(source, labels, path) {
  let previousIndex = -1;
  for (const label of labels) {
    const index = source.indexOf(label);
    assert.ok(index > previousIndex, `${path} must place ${label} after the preceding section`);
    previousIndex = index;
  }
}

test("MCP and Agents is a peer tab with exactly six pages while API Reference stays unchanged", () => {
  const config = JSON.parse(readFileSync("docs.json", "utf8"));
  assert.equal(config.navigation.tabs.length, 2);
  assert.deepEqual(config.navigation.tabs[0], API_REFERENCE_TAB);
  assert.deepEqual(config.navigation.tabs[1], { tab: "MCP & Agents", groups: MCP_GROUPS });
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
    "AIRSCALE_API_KEY=live-secret-token",
    "export AIRSCALE_API_KEY=live-secret-token",
    '{ "Authorization": "Bearer json-token" }'
  ]) {
    assert.equal(hasUnsafeBearerAuthorization(unsafe), true, `${unsafe} must be rejected`);
  }
  assert.equal(hasUnsafeBearerAuthorization("AIRSCALE_API_KEY=YOUR_API_KEY\nAuthorization: Bearer $AIRSCALE_API_KEY"), false);

  for (const path of MCP_PAGE_PATHS) {
    const source = readFileSync(`${path}.mdx`, "utf8");
    for (const line of source.split("\n").filter((candidate) => candidate.includes("YOUR_API_KEY"))) {
      assert.equal(line.trim(), "AIRSCALE_API_KEY=YOUR_API_KEY", `${path} must use YOUR_API_KEY only as the exact environment assignment`);
    }
  }
});

test("MCP landing page is developer-first, complete, and non-executing", () => {
  const source = readFileSync("mcp/airscale-mcp-server.mdx", "utf8");
  const { frontmatter } = readPage("mcp/airscale-mcp-server");
  assert.deepEqual(frontmatter, {
    title: "Airscale MCP server",
    description: "Connect AI clients and agents to Airscale search, enrichment, research, and export tools.",
    canonical: "https://airscale.mintlify.app/mcp/airscale-mcp-server"
  });
  assertOrdered(source, [
    "MCP & Agents",
    "## Build with Airscale MCP",
    "search, enrichment, research, and exports",
    "https://mcp.airscale.io/mcp",
    "Tool catalog",
    "Authentication",
    "Credit safety",
    "Agent resources",
    "## Configure your client",
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

  const firstViewport = source.slice(0, source.indexOf("## Configure your client"));
  assert.equal((firstViewport.match(/<Card\b/g) ?? []).length, 4);
  assert.match(firstViewport, /```text\nhttps:\/\/mcp\.airscale\.io\/mcp\n```/);
  assert.match(firstViewport, /22 typed tools/);
  assert.match(source, /<CodeGroup>[\s\S]*Claude Code[\s\S]*Generic JSON client[\s\S]*OAuth client[\s\S]*<\/CodeGroup>/);
  assert.match(source, /AIRSCALE_API_KEY=YOUR_API_KEY/);
  assert.match(source, /Authorization: Bearer \$AIRSCALE_API_KEY/);
  assert.match(source, /airscale_check_credits/);
  assert.match(source, /confirm_credit_spend/);
  assert.match(source, /poll|status/i);
  assert.match(source, /\[MCP tool catalog\]\(\/mcp\/tools\)/);
  assert.match(source, /\/api-reference\/(?:credit-count|authentication)/);
  assert.doesNotMatch(source, /<ApiPlayground\b|<TryIt\b|https:\/\/api\.airscale\.io\/v1\b/i);
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
