import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import {
  assertBalancedCodeFences,
  assertLocalDocumentationLinksResolve,
  assertNoStaticCredentials,
  hasApprovedBearerCredentialSource,
  hasUnsafeBearerAuthorization,
  localDocumentationLinks
} from "./helpers/content-safety.mjs";

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

const PAGE_PATHS = GROUPS.flatMap(([, pages]) => pages);
const GUIDE_PATHS = ["api-reference/api-overview", "api-reference/authentication", "api-reference/rate-limits"];
const EXPECTED_API_TAB = {
  tab: "API Reference",
  groups: GROUPS.map(([group, pages]) => ({ group, pages }))
};
const CANONICAL_SYMBOL_PATH = "m41.368,46.100 2.600,7.900c.700,2.200,2.800,3.600,5,3.600,1.700,0,3.300-.800,4.300-2.200,1-1.400,1.200-3.200.700-4.800l-4.700-13.400-7.900,8.900Zm-26.800-7.200 9-26.600c.5-1.400,1.800-2.300,3.300-2.300s2.800.900,3.300,2.300l6.200,18.500,7.800-8.800-4.600-13.100c-1.900-5.400-7-8.900-12.600-8.900-5.700,0-10.700,3.600-12.600,8.900L.367,48.800c-.700,2.100-.400,4.300.900,6.100,1.300,1.800,3.300,2.800,5.500,2.800,1.900,0,3.700-.800,5-2.200l13.800-15.400,2.800,8.300c.200.700.700,1.300,1.200,1.800s1.200.800,1.900,1c.700.100,1.500.1,2.100-.1.700-.200,1.300-.600,1.800-1.200l21-24.300c.5-.600.900-1.400,1-2.400.200-.9.100-1.9-.1-2.600l-1.700-4.800c-.1-.4-.3-.7-.5-.8-.1-.1-.2-.2-.4-.2h-.4c-.2.1-.5.200-.8.600l-19.800,22.500-2.700-8.100c-.8-3.200-4.900-3.800-7-1.400l-9.9,10.700";
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

function mdxPagePaths(directory = "api-reference") {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) return mdxPagePaths(path);
      return entry.isFile() && entry.name.endsWith(".mdx") ? [path.slice(0, -4)] : [];
    })
    .sort();
}

function assertSafeSvgSource(source, path) {
  const withoutSvgNamespace = source.replace(/\s+xmlns=(["'])http:\/\/www\.w3\.org\/2000\/svg\1/i, "");
  assert.doesNotMatch(source, /<(?:script|image|foreignObject)\b/i, `${path} must not embed active content`);
  assert.doesNotMatch(source, /\bon[a-z][\w:-]*\s*=|<style\b|\bstyle\s*=/i, `${path} must not contain executable styles or handlers`);
  assert.doesNotMatch(source, /\bdata:image\/|\b(?:xlink:)?href\s*=/i, `${path} must not contain external references`);
  assert.doesNotMatch(withoutSvgNamespace, /(?:https?:)?\/\//i, `${path} must not contain remote URLs`);
}

const DASHBOARD_SELECTOR = '#navbar a[href="https://app.airscale.io/dashboard"]';
const DASHBOARD_OVERLAY_SELECTOR = `${DASHBOARD_SELECTOR} > span.absolute.inset-0`;
const NAVBAR_LOGO_SELECTOR = '#navbar img.nav-logo:is([alt="light logo"], [alt="dark logo"])';
const APPROVED_DASHBOARD_SELECTORS = [
  NAVBAR_LOGO_SELECTOR,
  DASHBOARD_SELECTOR,
  `${DASHBOARD_SELECTOR}:hover`,
  `${DASHBOARD_SELECTOR} :is(span, svg)`,
  DASHBOARD_OVERLAY_SELECTOR,
  `html.dark ${DASHBOARD_SELECTOR}`,
  `html.dark ${DASHBOARD_SELECTOR}:hover`
];

function parseFlatCssRules(source) {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = [];
  let cursor = 0;

  while (cursor < withoutComments.length) {
    while (/\s/.test(withoutComments[cursor] ?? "")) cursor += 1;
    if (cursor === withoutComments.length) break;

    const openingBrace = withoutComments.indexOf("{", cursor);
    assert.notEqual(openingBrace, -1, "custom.css rule must have an opening brace");
    const selector = withoutComments.slice(cursor, openingBrace).trim();
    assert.ok(selector && !selector.includes("}"), "custom.css must contain only flat selector rules");

    const closingBrace = withoutComments.indexOf("}", openingBrace + 1);
    assert.notEqual(closingBrace, -1, `custom.css rule must close: ${selector}`);
    const body = withoutComments.slice(openingBrace + 1, closingBrace);
    assert.doesNotMatch(body, /[{}]/, "custom.css must contain only flat selector rules");

    const declarations = body.split(";").map((declaration) => declaration.trim()).filter(Boolean).map((declaration) => {
      const colon = declaration.indexOf(":");
      assert.ok(colon > 0, `custom.css declaration must contain a property and value: ${declaration}`);
      const property = declaration.slice(0, colon).trim();
      const rawValue = declaration.slice(colon + 1).trim();
      assert.ok(property && rawValue, `custom.css declaration must contain a property and value: ${declaration}`);
      const importantMatch = rawValue.match(/^(.*?)\s+!important$/);
      const value = (importantMatch?.[1] ?? rawValue).trim();
      return { property, value, important: Boolean(importantMatch) };
    });
    rules.push({ selector, declarations });
    cursor = closingBrace + 1;
  }

  assert.ok(rules.length > 0, "custom.css must contain dashboard CTA rules");
  return rules;
}

function assertRuleDeclarations(rule, expectedDeclarations) {
  for (const expected of expectedDeclarations) {
    const matches = rule.declarations.filter(({ property }) => property === expected.property);
    assert.equal(matches.length, 1, `${rule.selector} must contain exactly one ${expected.property} declaration`);
    assert.equal(
      matches[0].value,
      expected.value,
      `${rule.selector} ${expected.property} must be exactly ${expected.value} !important`
    );
    assert.equal(
      matches[0].important,
      expected.important,
      `${rule.selector} ${expected.property} must be exactly ${expected.value} !important`
    );
  }
  assert.equal(
    rule.declarations.length,
    expectedDeclarations.length,
    `${rule.selector} must contain only its planned declarations`
  );
}

function assertDashboardCssContract(source) {
  const rules = parseFlatCssRules(source);
  for (const rule of rules) {
    assert.ok(APPROVED_DASHBOARD_SELECTORS.includes(rule.selector), `custom.css selector is not approved: ${rule.selector}`);
  }
  for (const selector of APPROVED_DASHBOARD_SELECTORS) {
    assert.equal(rules.filter((rule) => rule.selector === selector).length, 1, `custom.css must contain exactly one rule for ${selector}`);
  }
  assert.equal(rules.length, APPROVED_DASHBOARD_SELECTORS.length, "custom.css must contain exactly seven approved navbar rules");

  const ruleFor = (selector) => rules.find((rule) => rule.selector === selector);
  const declaration = (property, value) => ({ property, value, important: true });
  const background = (value) => declaration("background-color", value);
  const border = (value) => declaration("border-color", value);
  const radius = (value) => declaration("border-radius", value);
  const color = (value) => declaration("color", value);

  assertRuleDeclarations(ruleFor(NAVBAR_LOGO_SELECTOR), [declaration("height", "38px")]);
  assertRuleDeclarations(ruleFor(DASHBOARD_SELECTOR), [background("#111827"), border("#111827"), radius("10px"), color("#FFFFFF")]);
  assertRuleDeclarations(ruleFor(`${DASHBOARD_SELECTOR}:hover`), [background("#000000"), border("#000000")]);
  assertRuleDeclarations(ruleFor(`${DASHBOARD_SELECTOR} :is(span, svg)`), [color("inherit")]);
  assertRuleDeclarations(ruleFor(DASHBOARD_OVERLAY_SELECTOR), [background("inherit"), radius("10px")]);
  assertRuleDeclarations(ruleFor(`html.dark ${DASHBOARD_SELECTOR}`), [background("#FFFFFF"), border("#FFFFFF"), color("#111827")]);
  assertRuleDeclarations(ruleFor(`html.dark ${DASHBOARD_SELECTOR}:hover`), [background("#E5E7EB"), border("#E5E7EB")]);
}

const PLANNED_DASHBOARD_CSS = `${NAVBAR_LOGO_SELECTOR} {
  height: 38px !important;
}

${DASHBOARD_SELECTOR} {
  background-color: #111827 !important;
  border-color: #111827 !important;
  border-radius: 10px !important;
  color: #FFFFFF !important;
}

${DASHBOARD_SELECTOR}:hover {
  background-color: #000000 !important;
  border-color: #000000 !important;
}

${DASHBOARD_SELECTOR} :is(span, svg) {
  color: inherit !important;
}

${DASHBOARD_OVERLAY_SELECTOR} {
  background-color: inherit !important;
  border-radius: 10px !important;
}

html.dark ${DASHBOARD_SELECTOR} {
  background-color: #FFFFFF !important;
  border-color: #FFFFFF !important;
  color: #111827 !important;
}

html.dark ${DASHBOARD_SELECTOR}:hover {
  background-color: #E5E7EB !important;
  border-color: #E5E7EB !important;
}`;

function tagAttributes(tag) {
  return Object.fromEntries(
    [...tag.matchAll(/([:\w-]+)\s*=\s*(["'])(.*?)\2/gs)].map((match) => [match[1], match[3]])
  );
}

function openingTags(source, name) {
  return source.match(new RegExp(`<${name}\\b[^>]*>`, "g")) ?? [];
}

test("brand configuration and assets match Airscale", () => {
  const config = JSON.parse(readFileSync("docs.json", "utf8"));
  assert.equal(config.$schema, "https://mintlify.com/docs.json");
  assert.equal(config.theme, "mint");
  assert.equal(config.name, "Airscale API");
  assert.deepEqual(config.colors, { primary: "#4079FF", light: "#4079FF", dark: "#6F9BFF" });
  assert.deepEqual(config.logo, { light: "/logo/light.svg", dark: "/logo/dark.svg", href: "https://airscale.io/" });
  assert.equal(config.favicon, "/favicon.svg");
  assert.equal(config.appearance.default, "light");
  assert.equal(config.fonts.family, "Poppins");
  assert.equal(config.icons.library, "lucide");
  assert.equal(config.styling.eyebrows, "breadcrumbs");
  assert.deepEqual(config.styling.codeblocks.theme, { light: "github-light", dark: "github-dark" });
  assert.deepEqual(config.navbar.links, [{ label: "Back to website", href: "https://airscale.io/" }]);
  assert.deepEqual(config.navbar.primary, {
    type: "button",
    label: "Open Dashboard",
    href: "https://app.airscale.io/dashboard"
  });
  assert.equal(existsSync("custom.css"), true);
  for (const asset of [config.logo.light, config.logo.dark, config.favicon]) assert.ok(existsSync(`.${asset}`));
});

test("navbar CTA selector guard rejects global or expanded CSS scope", () => {
  assert.doesNotThrow(() => assertDashboardCssContract(PLANNED_DASHBOARD_CSS));

  for (const forbiddenSelector of [
    "html body",
    "body.docs",
    "#navbar *",
    "#navbar a",
    "button.primary",
    "main a",
    "html",
    ":root",
    "*"
  ]) {
    assert.throws(
      () => assertDashboardCssContract(`${PLANNED_DASHBOARD_CSS}\n${forbiddenSelector} { color: red; }`),
      /custom\.css selector is not approved/
    );
  }

  const conflictingDeclarations = PLANNED_DASHBOARD_CSS.replace(
    "  color: #FFFFFF !important;",
    "  color: #FFFFFF !important;\n  background: red;\n  color: red;"
  );
  assert.throws(
    () => assertDashboardCssContract(conflictingDeclarations),
    /must contain exactly one color declaration/
  );

  const duplicateSelector = `${PLANNED_DASHBOARD_CSS}\n${DASHBOARD_SELECTOR} {
    background-color: red;
    border-color: red;
    color: red;
  }`;
  assert.throws(
    () => assertDashboardCssContract(duplicateSelector),
    /custom\.css must contain exactly one rule/
  );
});

test("navbar CTA declaration guard requires explicit important priority", () => {
  const withoutImportant = PLANNED_DASHBOARD_CSS.replace(
    "background-color: #111827 !important;",
    "background-color: #111827;"
  );
  assert.throws(
    () => assertDashboardCssContract(withoutImportant),
    /must be exactly #111827 !important/
  );
});

test("navbar CTA declaration guard requires exact background-color property", () => {
  const withBackgroundShorthand = PLANNED_DASHBOARD_CSS.replace(
    "background-color: #111827 !important;",
    "background: #111827 !important;"
  );
  assert.throws(
    () => assertDashboardCssContract(withBackgroundShorthand),
    /must contain exactly one background-color declaration/
  );
});

test("navbar spacing guard requires exact scoped logo height and CTA radius", () => {
  const wrongRadius = PLANNED_DASHBOARD_CSS.replace(
    "border-radius: 10px !important;",
    "border-radius: 9px !important;"
  );
  assert.throws(() => assertDashboardCssContract(wrongRadius), /must be exactly 10px !important/);

  const radiusWithoutPriority = PLANNED_DASHBOARD_CSS.replace(
    "border-radius: 10px !important;",
    "border-radius: 10px;"
  );
  assert.throws(() => assertDashboardCssContract(radiusWithoutPriority), /must be exactly 10px !important/);

  const broadLogoSelector = PLANNED_DASHBOARD_CSS.replace(NAVBAR_LOGO_SELECTOR, ".nav-logo");
  assert.throws(() => assertDashboardCssContract(broadLogoSelector), /custom\.css selector is not approved/);
});

test("navbar dashboard CTA is mode-aware without changing global brand colors", () => {
  const config = JSON.parse(readFileSync("docs.json", "utf8"));
  assert.ok(existsSync("custom.css"), "custom.css must exist for the navbar dashboard CTA override");
  const customCss = readFileSync("custom.css", "utf8");
  assertDashboardCssContract(customCss);
  assert.deepEqual(config.colors, { primary: "#4079FF", light: "#4079FF", dark: "#6F9BFF" });
});

test("Mintlify uses the approved non-executing OpenAPI example configuration", () => {
  const configSource = readFileSync("docs.json", "utf8");
  const config = JSON.parse(configSource);
  assert.deepEqual(config.api, {
    openapi: "openapi.json",
    playground: { display: "simple" },
    examples: { languages: ["curl", "node", "python"], defaults: "required", prefill: true, autogenerate: true }
  });
  assert.equal(Object.hasOwn(config.api.playground, "mode"), false);
  assert.doesNotMatch(configSource, /hideApiMarker/);
});

for (const [mode, path, wordmarkFill] of [
  ["light", "logo/light.svg", "#111827"],
  ["dark", "logo/dark.svg", "#FFFFFF"]
]) {
  test(`${mode} header logo uses the approved tiled Airscale lockup`, () => {
    const source = readFileSync(path, "utf8");
    const svg = tagAttributes(openingTags(source, "svg")[0] ?? "");
    assert.equal(svg.viewBox, "0 0 157 38");
    assert.equal(svg.role, "img");
    assert.equal(svg["aria-label"], "Airscale");
    const tile = openingTags(source, "rect").map(tagAttributes).find((attributes) => (
      attributes.x === "0" && attributes.y === "0" && attributes.width === "38" &&
      attributes.height === "38" && attributes.rx === "8" && attributes.fill === "#111827"
    ));
    assert.ok(tile, `${path} must contain the exact black rounded tile`);
    const canonicalMark = openingTags(source, "path")
      .map(tagAttributes)
      .find((attributes) => attributes.d === CANONICAL_SYMBOL_PATH);
    assert.ok(canonicalMark, `${path} must contain the canonical mark path`);
    assert.equal(
      canonicalMark.transform,
      "translate(10.3 10.6) scale(.31)",
      `${path} must render the enlarged canonical mark optically centered inside the 38px tile`
    );
    assert.equal(canonicalMark.fill, "#FFFFFF");
    const wordmarkTag = source.match(/<text\b[^>]*>\s*Airscale\s*<\/text>/)?.[0];
    assert.ok(wordmarkTag, `${path} must contain the Airscale wordmark`);
    const wordmark = tagAttributes(wordmarkTag);
    assert.equal(wordmark.x, "48.5");
    assert.equal(wordmark.y, "25.125");
    assert.equal(wordmark["font-size"], "17.5");
    assert.equal(wordmark.fill, wordmarkFill);
    assertSafeSvgSource(source, path);
  });
}

test("favicon preserves the Airscale symbol and brand SVG safety checks reject unsafe source", () => {
  const favicon = readFileSync("favicon.svg", "utf8");
  assert.ok(favicon.includes(CANONICAL_SYMBOL_PATH));
  assert.doesNotMatch(favicon, /<text\b/i);
  assertSafeSvgSource(favicon, "favicon.svg");
  assert.throws(() => assertSafeSvgSource('<svg><script src="https://example.com/x.js" /></svg>', "unsafe.svg"));
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
    "Authorization: Bearer +secret",
    "export AIRSCALE_API_KEY=\"live-secret-token\"",
    'headers={"Authorization": f"Bearer live-secret-token"}'
  ]) {
    assert.equal(hasUnsafeBearerAuthorization(value), true, `${value} must be rejected`);
  }

  for (const value of [
    "Authorization: Bearer `YOUR_API_KEY`",
    "Authorization: Bearer '$AIRSCALE_API_KEY'",
    "Authorization: Bearer '${AIRSCALE_API_KEY}'",
    "Authorization: Bearer ```<YOUR_API_KEY>```"
  ]) {
    assert.equal(hasUnsafeBearerAuthorization(value), false, `${value} must be allowed`);
  }

  assert.equal(hasUnsafeBearerAuthorization("const headers = { Authorization: `Bearer ${apiKey}` };"), true);
  assert.equal(hasUnsafeBearerAuthorization('export AIRSCALE_API_KEY="YOUR_API_KEY"'), false);
  assert.equal(hasUnsafeBearerAuthorization('export AIRSCALE_API_KEY="$SECRET_FROM_VAULT"'), false);
  assert.equal(hasUnsafeBearerAuthorization("AIRSCALE_API_KEY = process.env.AIRSCALE_API_KEY"), false);
  assert.equal(hasUnsafeBearerAuthorization('AIRSCALE_API_KEY = os.environ["AIRSCALE_API_KEY"]'), false);
  assert.equal(hasUnsafeBearerAuthorization('headers={"Authorization": f"Bearer {api_key}"}'), true);
  assert.equal(hasUnsafeBearerAuthorization('headers={"Authorization": f"Bearer {os.getenv(\'AIRSCALE_API_KEY\')}"}'), false);

  assert.equal(
    hasApprovedBearerCredentialSource([
      "let apiKey = process.env.AIRSCALE_API_KEY;",
      'apiKey = "live-secret-token";',
      "const headers = { Authorization: `Bearer ${apiKey}` };"
    ].join("\n")),
    false
  );
  assert.equal(
    hasApprovedBearerCredentialSource([
      "const apiKey = requireEnv(process.env.AIRSCALE_API_KEY);",
      "const headers = { Authorization: `Bearer ${apiKey}` };"
    ].join("\n")),
    true
  );

  const unsafePythonEnvironmentWrite = [
    'os.environ["AIRSCALE_API_KEY"] = "live-secret-token"',
    'headers = {"Authorization": f"Bearer {os.environ[\'AIRSCALE_API_KEY\']}"}'
  ].join("\n");
  assert.equal(hasUnsafeBearerAuthorization(unsafePythonEnvironmentWrite), true);
  assert.equal(hasApprovedBearerCredentialSource(unsafePythonEnvironmentWrite), false);

  for (const environmentRead of [
    "process.env.AIRSCALE_API_KEY",
    'process.env["AIRSCALE_API_KEY"]',
    "process.env['AIRSCALE_API_KEY']"
  ]) {
    const directRead = `const headers = { Authorization: \`Bearer \${${environmentRead}}\` };`;
    assert.equal(hasApprovedBearerCredentialSource(directRead), true);
    const wrappedRead = `const apiKey = requireEnv(${environmentRead});\nconst headers = { Authorization: \`Bearer \${apiKey}\` };`;
    assert.equal(hasApprovedBearerCredentialSource(wrappedRead), true);
  }
});

test("navigation contains exactly the approved 18 pages in five groups", () => {
  const config = JSON.parse(readFileSync("docs.json", "utf8"));
  assert.deepEqual(config.navigation.tabs[0], EXPECTED_API_TAB);
  assert.deepEqual(mdxPagePaths(), [...PAGE_PATHS].sort());
});

test("every public operation has one exact OpenAPI-backed wrapper", () => {
  const catalog = JSON.parse(readFileSync("contracts/public-api-operations.json", "utf8"));
  const expectedBindings = new Map(catalog.operations.map(({ method, path, page }) => [
    page,
    `/openapi.json ${method} ${path}`
  ]));
  const actualBindings = new Map();

  for (const page of PAGE_PATHS) {
    const { body, frontmatter } = readPage(page);
    if (!frontmatter.openapi) continue;
    actualBindings.set(page, frontmatter.openapi);
    assert.equal(frontmatter.openapi, expectedBindings.get(page), `${page} must bind its catalog operation`);
    assert.doesNotMatch(body, /<Badge\b[^>]*>\s*(?:GET|POST)\s*<\/Badge>/i);
    assert.doesNotMatch(body, /^## (?:Request|Response|Errors|Examples)$/m);
    assert.doesNotMatch(body, /<CodeGroup>|^```/m);
    assert.match(body, /^## Next step$/m, `${page} must retain next-step guidance`);
    assert.ok(body.split(/\n\s*\n/)[0].trim(), `${page} must retain a purpose statement`);
  }

  assert.equal(expectedBindings.size, 15);
  assert.equal(new Set(expectedBindings.values()).size, 15);
  assert.equal(actualBindings.size, 15);
  assert.deepEqual(actualBindings, expectedBindings);
});

test("every wrapper binding resolves to its cataloged generated OpenAPI operation", () => {
  const catalog = JSON.parse(readFileSync("contracts/public-api-operations.json", "utf8"));
  const specification = JSON.parse(readFileSync("openapi.json", "utf8"));
  const resolved = [];

  for (const entry of catalog.operations) {
    const binding = readPage(entry.page).frontmatter.openapi;
    const match = binding?.match(/^\/openapi\.json (GET|POST) (\/v1\/[^\s]+)$/);
    assert.ok(match, `${entry.page} must have a parseable OpenAPI binding`);
    const [, method, path] = match;
    const operation = specification.paths?.[path]?.[method.toLowerCase()];
    assert.ok(operation, `${binding} must resolve in openapi.json`);
    assert.equal(operation.operationId, entry.operationId);
    resolved.push(`${method} ${path}`);
  }

  assert.equal(new Set(resolved).size, 15);
  assert.deepEqual(resolved.sort(), catalog.operations.map(({ method, path }) => `${method} ${path}`).sort());
});

test("exactly three guide pages remain prose-only", () => {
  const guides = PAGE_PATHS.filter((page) => !Object.hasOwn(readPage(page).frontmatter, "openapi"));
  assert.deepEqual(guides, GUIDE_PATHS);
});

test("every page keeps valid preview metadata, safe MDX, and resolvable local links", () => {
  for (const page of PAGE_PATHS) {
    const { source, body, frontmatter } = readPage(page);
    assert.ok(frontmatter.title, `${page} must have a title`);
    assert.ok(frontmatter.description, `${page} must have a description`);
    assert.equal(frontmatter.canonical, `https://airscale.mintlify.app/${page}`);
    assert.doesNotMatch(body, /^#\s+/m, `${page} must not repeat its title as a body H1`);
    assert.doesNotMatch(source, /hideApiMarker|\b(?:Authentification|Endoints)\b/);
    assertBalancedCodeFences(source, page);
    assertNoStaticCredentials(source, page);
    assertLocalDocumentationLinksResolve(source, page);
    assert.ok(!localDocumentationLinks(source).includes(`/${page}`), `${page} must not link to itself`);
  }
  assert.throws(() => assertBalancedCodeFences("  ```bash\n  unclosed", "malformed fixture"));
  assert.throws(() => assertLocalDocumentationLinksResolve("[Missing](/api-reference/missing)", "missing fixture"));
  assert.throws(() => assertNoStaticCredentials("Authorization: Bearer live-secret", "unsafe fixture"));
});

test("guide pages teach authentication, safe retries, and a first request", () => {
  const overview = readPage("api-reference/api-overview").source;
  assert.match(overview, /<Steps>/);
  assert.match(overview, /POST https:\/\/api\.airscale\.io\/v1\/credits/);
  assert.match(overview, /\$AIRSCALE_API_KEY/);
  for (const page of ["authentication", "rate-limits", "find-people", "find-companies", "email-finder", "airsearch"]) {
    assert.ok(localDocumentationLinks(overview).includes(`/api-reference/${page}`));
  }

  const authentication = readPage("api-reference/authentication").source;
  assert.match(authentication, /Airscale Settings/);
  assert.match(authentication, /401 Unauthorized/);
  assert.match(authentication, /<Warning>/);
  assert.match(authentication, /rotate/i);

  const rateLimits = readPage("api-reference/rate-limits").source;
  assert.match(rateLimits, /endpoint-specific/i);
  assert.match(rateLimits, /429 Too Many Requests/);
  assert.match(rateLimits, /bounded exponential backoff/i);
});

const DURABLE_OPERATION_GUIDANCE = {
  "api-reference/credit-count": [/no request body/i, /does not debit Airscale credits/i],
  "api-reference/email-finder": [/3,000 requests per minute/i, /2 credits/i, /`not_found` is not charged/i, /bounded backoff/i],
  "api-reference/email-finder-(bulk)": [
    /asynchronous/i,
    /webhook/i,
    /100 people/i,
    /3,000 input items per minute/i,
    /automatic webhook retries/i,
    /every callback echoes `custom_id`/i,
    /omitted or `null`.*zero-based input index/is,
    /`status: "success"`.*`email`.*`email_status: "valid"`.*`provider`.*`verifier`/is,
    /`status: "error"`.*`error: "insufficient_credits"`.*`email: null`/is,
    /`status: "not_found"` or `status: "timeout"`.*`email: null`/is
  ],
  "api-reference/mobile-finder": [/3,000 requests per minute/i, /40 credits/i, /`not_found` is not charged/i, /bounded backoff/i],
  "api-reference/personal-email": [/2,000 requests per minute/i, /3 and 12 credits/i, /minimum balance/i, /usage recording/i, /before retrying/i],
  "api-reference/people-url-finder": [/6 requests per second/i, /0\.5 credits/i, /`not_found` is not charged/i, /bounded exponential backoff/i],
  "api-reference/extract-people-profile": [/submitted URL/i, /response schema/i, /credit cost/i, /`p1`.*`p2`.*`p3`/i, /3,000 requests per minute/i],
  "api-reference/extract-company-profile": [/submitted URL/i, /response schema/i, /credit cost/i, /`p1`.*`p2`.*`p3`/i, /3,000 requests per minute/i],
  "api-reference/reverse-email": [/25 requests per second/i, /2 credits/i, /JSON string `"not found"`/i, /not charged/i, /bounded backoff/i],
  "api-reference/reverse-phone": [/2,000 requests per minute/i, /10 credits/i, /true miss.*exhausted or failed/i, /one bounded-backoff retry/i, /normalized number/i],
  "api-reference/find-people": [/6 requests per second/i, /0\.1 credits per returned lead/i, /empty result pages are not charged/i, /send it unchanged as `cursor`/i, /Count people/i],
  "api-reference/find-people/count": [/Count is free/i, /same `query`/i, /no pagination fields/i, /6 requests per second/i],
  "api-reference/find-companies": [/6 requests per second/i, /0\.1 credits per returned company/i, /zero returned rows cost zero credits/i, /when `next_cursor` is not `null`.*send the exact value unchanged as `cursor`/is, /10,000 companies/i],
  "api-reference/find-companies/filter-values": [/free and has no request body/i, /6 requests per second/i, /`q` parameter takes precedence/i],
  "api-reference/airsearch": [/300 requests per minute/i, /1 credit/i, /`not_found` and `timeout` are not charged/i, /reservation is settled only for `success`/i, /initial-stage timeout.*`504 Gateway Timeout`/i]
};

test("operation wrappers retain durable rate, credit, retry, and asynchronous guidance", () => {
  assert.equal(Object.keys(DURABLE_OPERATION_GUIDANCE).length, 15);
  for (const [page, patterns] of Object.entries(DURABLE_OPERATION_GUIDANCE)) {
    const { body } = readPage(page);
    for (const pattern of patterns) assert.match(body, pattern, `${page} must retain ${pattern}`);
  }
});
