import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import test from "node:test";

const GROUPS = [
  ["Start here", ["api-reference/api-overview", "api-reference/authentication", "api-reference/rate-limits"]],
  ["Search and discovery", ["api-reference/find-people", "api-reference/find-companies", "api-reference/airsearch"]],
  ["Contact data", ["api-reference/email-finder", "api-reference/email-finder-(bulk)", "api-reference/mobile-finder", "api-reference/personal-email", "api-reference/people-url-finder"]],
  ["Profiles and reverse lookup", ["api-reference/extract-people-profile", "api-reference/extract-company-profile", "api-reference/reverse-email", "api-reference/reverse-phone"]],
  ["Account", ["api-reference/credit-count"]]
];

const PAGE_PATHS = GROUPS.flatMap(([, pages]) => pages);
const API_REFERENCE_TABS = [{
  tab: "API Reference",
  groups: GROUPS.map(([group, pages]) => ({ group, pages }))
}];
const CANONICAL_SYMBOL_PATH = "m41.368,46.100 2.600,7.900c.700,2.200,2.800,3.600,5,3.600,1.700,0,3.300-.800,4.300-2.200,1-1.400,1.200-3.200.700-4.800l-4.700-13.400-7.900,8.900Zm-26.800-7.200 9-26.600c.5-1.400,1.800-2.300,3.300-2.300s2.800.900,3.300,2.300l6.200,18.500,7.800-8.800-4.600-13.100c-1.900-5.400-7-8.900-12.600-8.900-5.700,0-10.700,3.600-12.600,8.900L.367,48.800c-.700,2.100-.400,4.300.900,6.100,1.300,1.800,3.300,2.800,5.500,2.800,1.900,0,3.700-.800,5-2.200l13.800-15.400,2.800,8.300c.200.700.700,1.300,1.200,1.800s1.200.800,1.900,1c.700.100,1.500.1,2.100-.1.700-.200,1.300-.600,1.800-1.200l21-24.300c.5-.600.900-1.400,1-2.400.200-.9.100-1.9-.1-2.600l-1.700-4.800c-.1-.4-.3-.7-.5-.8-.1-.1-.2-.2-.4-.2h-.4c-.2.1-.5.200-.8.600l-19.800,22.500-2.700-8.100c-.8-3.200-4.900-3.800-7-1.400l-9.9,10.700";
const APPROVED_BEARER_VALUES = new Set(["YOUR_API_KEY", "$AIRSCALE_API_KEY", "<YOUR_API_KEY>"]);
const AUTHORIZATION_BEARER_VALUE = /\bAuthorization\b[\s:,"'`|=>(\[\]{}.-]*?\bBearer\s+(\S+)/gi;

function hasUnsafeBearerAuthorization(source) {
  return Array.from(source.matchAll(AUTHORIZATION_BEARER_VALUE)).some(([, value]) => {
      const strippedValue = value
        .trim()
        .replace(/^```(?:[a-z][a-z0-9_-]*)?\s*/i, "")
        .replace(/\s*```$/, "")
        .trim()
        .replace(/^&lt;(.+)&gt;$/, "<$1>")
        .replace(/^["'`]+|[)\]"'`,;|.!?]+$/g, "")
        .trim();
      const isDynamicExpression = /^(?:\$\{[A-Za-z_$][\w$]*\}|\{[A-Za-z_$][\w$]*\})$/.test(strippedValue) || /^["'`]\+[A-Za-z_$][\w$]*(?:[)\],;]|$)/.test(value);
      return Boolean(strippedValue) && strippedValue.toLowerCase() !== "authentication" && !isDynamicExpression && !APPROVED_BEARER_VALUES.has(strippedValue);
    });
}

function assertSafeSvgSource(source, path) {
  const withoutSvgNamespace = source.replace(/\s+xmlns=(['"])http:\/\/www\.w3\.org\/2000\/svg\1/i, "");

  assert.doesNotMatch(source, /<(?:script|image)\b/i, `${path} must not contain active or raster elements`);
  assert.doesNotMatch(source, /<foreignObject\b/i, `${path} must not contain embedded HTML`);
  assert.doesNotMatch(source, /\bon[a-z][\w:-]*\s*=/i, `${path} must not contain event handlers`);
  assert.doesNotMatch(source, /<style\b|\bstyle\s*=/i, `${path} must not contain styles`);
  assert.doesNotMatch(source, /\bdata:image\//i, `${path} must not contain raster data`);
  assert.doesNotMatch(source, /\b(?:xlink:)?href\s*=/i, `${path} must not contain href references`);
  assert.doesNotMatch(withoutSvgNamespace, /(?:https?:)?\/\//i, `${path} must not contain remote URLs`);
}

function readPage(path) {
  const source = readFileSync(`${path}.mdx`, "utf8");
  const match = source.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  assert.ok(match, `${path} must have frontmatter`);
  const frontmatter = Object.fromEntries(
    match[1].split("\n").filter(Boolean).map((line) => {
      const separator = line.indexOf(":");
      return [line.slice(0, separator).trim(), line.slice(separator + 1).trim().replace(/^"|"$/g, "")];
    })
  );
  return { source, body: match[2], frontmatter };
}

function localDocumentationLinks(source) {
  const markdownLinks = Array.from(source.matchAll(/\[[^\]]*\]\((\/api-reference\/(?:[^()\s?#]+|\([^()\s?#]*\))+)(?:[?#][^)]*)?\)/g), ([, href]) => href);
  const componentLinks = Array.from(source.matchAll(/<[A-Za-z][\w.:-]*\b[^>]*\bhref=(["'])(\/api-reference\/[^"'?#]+)(?:[?#][^"']*)?\1[^>]*>/g), ([, , href]) => href);
  return [...markdownLinks, ...componentLinks];
}

function assertLocalDocumentationLinksResolve(source, path) {
  for (const href of localDocumentationLinks(source)) {
    assert.ok(existsSync(`.${href}.mdx`), `${path} link ${href} must resolve`);
  }
}

function assertApprovedNavigationTabs(tabs) {
  assert.deepEqual(tabs, API_REFERENCE_TABS);
}

test("brand configuration and assets match Airscale", () => {
  const config = JSON.parse(readFileSync("docs.json", "utf8"));

  assert.equal(config.$schema, "https://mintlify.com/docs.json");
  assert.equal(config.theme, "mint");
  assert.equal(config.name, "Airscale API");
  assert.equal(config.colors.primary, "#4079FF");
  assert.equal(config.colors.light, "#4079FF");
  assert.equal(config.colors.dark, "#6F9BFF");
  assert.equal(config.logo.light, "/logo/light.svg");
  assert.equal(config.logo.dark, "/logo/dark.svg");
  assert.equal(config.logo.href, "https://airscale.io/");
  assert.equal(config.favicon, "/favicon.svg");
  assert.equal(config.appearance.default, "light");
  assert.equal(config.fonts.family, "Poppins");
  assert.equal(config.icons.library, "lucide");
  assert.equal(config.styling.eyebrows, "breadcrumbs");
  assert.equal(config.styling.codeblocks.theme.light, "github-light");
  assert.equal(config.styling.codeblocks.theme.dark, "github-dark");
  assert.deepEqual(config.navbar.links, [{ label: "Back to website", href: "https://airscale.io/" }]);
  assert.deepEqual(config.navbar.primary, {
    type: "button",
    label: "Open dashboard",
    href: "https://app.airscale.io/dashboard"
  });
  assert.equal(existsSync("custom.css"), false);

  for (const asset of [config.logo.light, config.logo.dark, config.favicon]) {
    assert.ok(existsSync(`.${asset}`), `${asset} must exist`);
  }
  assert.doesNotMatch(JSON.stringify(config.logo), /mintlify\.s3|bubble\.io/);
});

test("brand SVGs preserve the Airscale symbol and safe local source", () => {
  for (const [path, fill] of [["logo/light.svg", "#111827"], ["logo/dark.svg", "#FFFFFF"]]) {
    const source = readFileSync(path, "utf8");

    assert.match(source, /viewBox="0 0 164 32"/);
    assert.ok(source.includes(CANONICAL_SYMBOL_PATH), `${path} must include the canonical symbol`);
    assert.match(source, /transform="translate\(0 1\.95\) scale\(\.48716\)"/);
    assert.match(source, new RegExp(`fill="${fill}"`));
    assert.match(source, /<text x="40" y="23" font-family="Poppins, Arial, sans-serif" font-size="20" font-weight="600">Airscale<\/text>/);
    assertSafeSvgSource(source, path);
  }

  const favicon = readFileSync("favicon.svg", "utf8");
  assert.match(favicon, /viewBox="0 0 57\.476 57\.700"/);
  assert.ok(favicon.includes(CANONICAL_SYMBOL_PATH), "favicon.svg must include the canonical symbol");
  assert.match(favicon, /fill="#111827"/);
  assert.doesNotMatch(favicon, /<text\b/i);
  assertSafeSvgSource(favicon, "favicon.svg");
});

test("SVG source safety rejects active, raster, remote, and href content", () => {
  for (const unsafeSource of [
    "<svg><script>alert(1)</script></svg>",
    "<svg><image href=\"data:image/png;base64,AAAA\" /></svg>",
    "<svg><use href=\"#symbol\" /></svg>",
    "<svg><metadata>https://example.com/logo.svg</metadata></svg>",
    "<svg onload=\"alert(1)\" />",
    "<svg><path onclick=\"alert(1)\" /></svg>",
    "<svg><path style=\"fill: red\" /></svg>",
    "<svg><style>path { fill: red; }</style></svg>",
    "<svg><foreignObject><div>unsafe</div></foreignObject></svg>"
  ]) {
    assert.throws(() => assertSafeSvgSource(unsafeSource, "unsafe.svg"));
  }
});

test("authorization bearer checks reject unsafe token formats", () => {
  for (const value of [
    "Authorization: Bearer short-token",
    "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhaXJzY2FsZSJ9.signature",
    "Authorization: Bearer QWlyc2NhbGUvKysrL3Rva2VuKys=",
    "curl -H \"Authorization: Bearer curl-token\" https://api.airscale.io/v1/credits",
    "{ \"Authorization\": \"Bearer json-token\" }",
    "const headers = { Authorization: `Bearer javascript-token` };",
    "req.Header.Set(\"Authorization\", \"Bearer go-static-token\")",
    "'Authorization' => 'Bearer php-static-token'",
    "| Authorization | Bearer table-static-token |",
    "Authorization:\n  Bearer newline-static-token",
    `Authorization:${" ".repeat(161)}Bearer long-gap-static-token`,
    "Authorization: Bearer +secret"
  ]) {
    assert.equal(hasUnsafeBearerAuthorization(value), true, `${value} must be rejected`);
  }

  for (const value of [
    "Authorization: Bearer `YOUR_API_KEY`",
    "Authorization: Bearer '$AIRSCALE_API_KEY'",
    "Authorization: Bearer ```<YOUR_API_KEY>```"
  ]) {
    assert.equal(hasUnsafeBearerAuthorization(value), false, `${value} must be allowed`);
  }

  assert.equal(hasUnsafeBearerAuthorization("const headers = { Authorization: `Bearer ${apiKey}` };"), false);
  assert.equal(hasUnsafeBearerAuthorization("req.Header.Set(\"Authorization\", \"Bearer \"+apiKey)"), false);
  assert.equal(hasUnsafeBearerAuthorization("headers = { Authorization: 'Bearer ' . $apiKey };"), false);
  assert.equal(hasUnsafeBearerAuthorization("Authorization supports Bearer authentication."), false);
  assert.equal(hasUnsafeBearerAuthorization("Use Bearer authentication for every request."), false);
});

test("navigation contains the five approved groups in order", () => {
  const config = JSON.parse(readFileSync("docs.json", "utf8"));

  assertApprovedNavigationTabs(config.navigation.tabs);
});

test("navigation rejects unexpected tabs", () => {
  const extraTabs = structuredClone(API_REFERENCE_TABS);
  extraTabs.push({ tab: "Unexpected", groups: [] });

  assert.throws(() => assertApprovedNavigationTabs(extraTabs));
});

test("exactly the approved 16 pages exist", () => {
  const actualPages = readdirSync("api-reference")
    .filter((file) => file.endsWith(".mdx"))
    .map((file) => `api-reference/${file.slice(0, -4)}`)
    .sort();

  assert.deepEqual(actualPages, [...PAGE_PATHS].sort());
  assert.ok(!actualPages.includes("api-reference/leads-finder"));
});

test("every page has baseline-safe MDX", () => {
  for (const path of PAGE_PATHS) {
    const { source, frontmatter } = readPage(path);

    assert.ok(frontmatter.title, `${path} must have a title`);
    assert.equal((source.match(/^```/gm) ?? []).length % 2, 0, `${path} must have balanced code fences`);
    assert.equal(hasUnsafeBearerAuthorization(source), false, `${path} must not contain a non-placeholder bearer token`);
  }
});

test("internal documentation links resolve", () => {
  for (const path of PAGE_PATHS) {
    const { source } = readPage(path);
    assertLocalDocumentationLinksResolve(source, path);
  }
});

test("local Markdown and component documentation links resolve", () => {
  assert.doesNotThrow(() => assertLocalDocumentationLinksResolve('[Bulk email](/api-reference/email-finder-(bulk))', "valid Markdown fixture"));
  assert.doesNotThrow(() => assertLocalDocumentationLinksResolve('<Card href="/api-reference/api-overview">Overview</Card>', "valid component fixture"));
  assert.throws(() => assertLocalDocumentationLinksResolve('<Card href="/api-reference/missing">Missing</Card>', "invalid component fixture"));
});

test("foundation pages teach a safe first request", () => {
  const descriptions = {
    "api-reference/api-overview": "Authenticate with Airscale and make your first API request.",
    "api-reference/authentication": "Create, send, protect, and rotate an Airscale API key.",
    "api-reference/rate-limits": "Understand endpoint-specific request limits and 429 responses.",
    "api-reference/credit-count": "Check the remaining credit balance for your Airscale workspace."
  };

  for (const [path, description] of Object.entries(descriptions)) {
    const { source, body, frontmatter } = readPage(path);

    assert.equal(frontmatter.description, description, `${path} must use the approved description`);
    assert.ok(frontmatter.description, `${path} must have a description`);
    assert.doesNotMatch(body, /^#\s+/m, `${path} must not repeat its title as a body H1`);
    assert.doesNotMatch(source, /\b(?:Authentification|Endoints)\b/, `${path} must not retain migration misspellings`);
    assert.ok(!localDocumentationLinks(source).includes(`/${path}`), `${path} must not link to itself`);
  }

  const overview = readPage("api-reference/api-overview").source;
  assert.match(overview, /<CardGroup cols=\{2\}>/);
  assert.match(overview, /<Steps>/);
  assert.match(overview, /POST https:\/\/api\.airscale\.io\/v1\/credits/);
  assert.match(overview, /\$AIRSCALE_API_KEY/);
  for (const path of [
    "authentication",
    "rate-limits",
    "find-people",
    "find-companies",
    "email-finder",
    "airsearch"
  ]) {
    assert.ok(localDocumentationLinks(overview).includes(`/api-reference/${path}`), `API overview must link to ${path}`);
  }
  assert.doesNotMatch(overview, /version-live|Authentification|Endoints/);

  const authentication = readPage("api-reference/authentication").source;
  assert.match(authentication, /Airscale Settings/);
  assert.match(authentication, /Authorization: Bearer \$AIRSCALE_API_KEY/);
  assert.match(authentication, /401 Unauthorized/);
  assert.match(authentication, /<Warning>/);
  assert.match(authentication, /rotate/i);

  const rateLimits = readPage("api-reference/rate-limits").source;
  assert.match(rateLimits, /endpoint-specific/i);
  assert.match(rateLimits, /429 Too Many Requests/);
  assert.match(rateLimits, /bounded exponential backoff/i);
  assert.doesNotMatch(rateLimits, /3,?000/);

  const creditCount = readPage("api-reference/credit-count").source;
  assert.match(creditCount, /POST https:\/\/api\.airscale\.io\/v1\/credits/);
  assert.match(creditCount, /<CodeGroup>/);
  assert.match(creditCount, /```bash cURL/);
  assert.match(creditCount, /```python Python/);
  assert.match(creditCount, /```javascript JavaScript/);
  assert.match(creditCount, /## Request/);
  assert.match(creditCount, /## Response/);
  assert.match(creditCount, /## Errors/);
  assert.match(creditCount, /"status": "success"/);
  assert.match(creditCount, /401/);
  assert.ok(localDocumentationLinks(creditCount).includes("/api-reference/find-people"));
});
