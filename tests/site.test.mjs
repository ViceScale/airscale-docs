import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import test from "node:test";

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
    const isDynamicExpression = /^(?:\$\{[A-Za-z_$][\w$]*\}|\$\{process\.env(?:\.AIRSCALE_API_KEY|\[(?:"AIRSCALE_API_KEY"|'AIRSCALE_API_KEY')\])\}|\{[A-Za-z_$][\w$]*(?:(?:\.[A-Za-z_$][\w$]*)|(?:\[(?:"[^"]+"|'[^']+'|[A-Za-z_$][\w$]*)\]))*\}|\{os\.getenv\((?:"AIRSCALE_API_KEY"|'AIRSCALE_API_KEY')\)\})$/.test(strippedValue) || /^["'`]\+[A-Za-z_$][\w$]*(?:[)\],;]|$)/.test(value);
    return Boolean(strippedValue) && strippedValue.toLowerCase() !== "authentication" && !isDynamicExpression && !APPROVED_BEARER_VALUES.has(strippedValue);
  });
}

function unwrapJavaScriptParentheses(expression) {
  let candidate = expression.trim();
  while (candidate.startsWith("(") && candidate.endsWith(")")) {
    let depth = 0;
    let closesBeforeEnd = false;
    for (let index = 0; index < candidate.length; index += 1) {
      if (candidate[index] === "(") depth += 1;
      if (candidate[index] === ")") depth -= 1;
      if (depth === 0 && index < candidate.length - 1) {
        closesBeforeEnd = true;
        break;
      }
      if (depth < 0) return candidate;
    }
    if (depth !== 0 || closesBeforeEnd) break;
    candidate = candidate.slice(1, -1).trim();
  }
  return candidate;
}

function isApprovedJavaScriptCredentialExpression(expression) {
  const candidate = unwrapJavaScriptParentheses(expression);
  if (/^process\.env(?:\.AIRSCALE_API_KEY|\[(?:"AIRSCALE_API_KEY"|'AIRSCALE_API_KEY')\])$/.test(candidate)) return true;
  const wrapper = candidate.match(/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\(([\s\S]*)\)$/);
  if (!wrapper) return false;
  const argument = wrapper[1].trim();
  let depth = 0;
  for (const character of argument) {
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (depth < 0 || (character === "," && depth === 0)) return false;
  }
  return depth === 0 && isApprovedJavaScriptCredentialExpression(argument);
}

function javascriptCredentialAssignments(source, variable) {
  const escapedVariable = variable.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const assignment = new RegExp(
    `(?<![.\\w$])(?:(?:const|let|var)\\s+)?${escapedVariable}\\s*(\\?\\?=|\\|\\|=|&&=|\\*\\*=|>>>=|>>=|<<=|[+\\-*/%&|^]=|=(?!=))\\s*([^;\\n]+)`,
    "g"
  );
  return Array.from(source.matchAll(assignment), ([, operator, expression]) => ({ operator, expression: expression.trim() }));
}

function hasApprovedBearerCredentialSource(source) {
  if (hasUnsafeBearerAuthorization(source)) return false;
  const bearerValues = Array.from(source.matchAll(AUTHORIZATION_BEARER_VALUE), ([, value]) => value);
  if (bearerValues.length === 0) return false;
  return bearerValues.every((value) => {
    const strippedValue = value
      .trim()
      .replace(/^```(?:[a-z][a-z0-9_-]*)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim()
      .replace(/^&lt;(.+)&gt;$/, "<$1>")
      .replace(/["'`][)\]}>},;|.!?]*$/, "")
      .replace(/^["'`]+|[)\]"'`,;|.!?]+$/g, "")
      .trim();
    if (APPROVED_BEARER_VALUES.has(strippedValue)) return true;
    if (/^\{os\.(?:environ\[(?:"AIRSCALE_API_KEY"|'AIRSCALE_API_KEY')\]|getenv\((?:"AIRSCALE_API_KEY"|'AIRSCALE_API_KEY')\))\}$/.test(strippedValue)) return true;
    const directJavaScriptExpression = strippedValue.match(/^\$\{([\s\S]+)\}$/)?.[1];
    if (directJavaScriptExpression && isApprovedJavaScriptCredentialExpression(directJavaScriptExpression)) return true;
    const javascriptVariable = strippedValue.match(/^\$\{([A-Za-z_$][\w$]*)\}$/)?.[1];
    if (!javascriptVariable) return false;
    const assignments = javascriptCredentialAssignments(source, javascriptVariable);
    return assignments.length > 0 && assignments.every(({ operator, expression }) => (
      operator === "=" && isApprovedJavaScriptCredentialExpression(expression)
    ));
  });
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

function mdxPagePaths(directory = "api-reference") {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) return mdxPagePaths(path);
      return entry.isFile() && entry.name.endsWith(".mdx") ? [path.slice(0, -4)] : [];
    })
    .sort();
}

function localDocumentationLinks(source) {
  const markdownLinks = Array.from(
    source.matchAll(/\[[^\]]*\]\((\/api-reference\/(?:[^()\s?#]+|\([^()\s?#]*\))+)(?:[?#][^)]*)?\)/g),
    ([, href]) => href
  );
  const componentLinks = Array.from(
    source.matchAll(/<[A-Za-z][\w.:-]*\b[^>]*\bhref=(["'])(\/api-reference\/[^"'?#]+)(?:[?#][^"']*)?\1[^>]*>/g),
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

function assertSafeSvgSource(source, path) {
  const withoutSvgNamespace = source.replace(/\s+xmlns=(["'])http:\/\/www\.w3\.org\/2000\/svg\1/i, "");
  assert.doesNotMatch(source, /<(?:script|image|foreignObject)\b/i, `${path} must not embed active content`);
  assert.doesNotMatch(source, /\bon[a-z][\w:-]*\s*=|<style\b|\bstyle\s*=/i, `${path} must not contain executable styles or handlers`);
  assert.doesNotMatch(source, /\bdata:image\/|\b(?:xlink:)?href\s*=/i, `${path} must not contain external references`);
  assert.doesNotMatch(withoutSvgNamespace, /(?:https?:)?\/\//i, `${path} must not contain remote URLs`);
}

function assertNoStaticCredentials(source, path) {
  assert.doesNotMatch(source, /\b(?:sk|pk)_live_[A-Za-z0-9_-]+\b/i, `${path} must not contain live credentials`);
  assert.equal(hasUnsafeBearerAuthorization(source), false, `${path} must not contain a static Bearer credential`);
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
    label: "Open dashboard",
    href: "https://app.airscale.io/dashboard"
  });
  assert.equal(existsSync("custom.css"), false);
  for (const asset of [config.logo.light, config.logo.dark, config.favicon]) assert.ok(existsSync(`.${asset}`));
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

test("brand SVGs preserve the Airscale symbol and reject unsafe source", () => {
  for (const [path, fill] of [["logo/light.svg", "#111827"], ["logo/dark.svg", "#FFFFFF"]]) {
    const source = readFileSync(path, "utf8");
    assert.match(source, /viewBox="0 0 164 32"/);
    assert.ok(source.includes(CANONICAL_SYMBOL_PATH), `${path} must include the canonical symbol`);
    assert.match(source, new RegExp(`fill="${fill}"`));
    assert.match(source, />Airscale<\/text>/);
    assertSafeSvgSource(source, path);
  }
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
    "Authorization: Bearer ```<YOUR_API_KEY>```"
  ]) {
    assert.equal(hasUnsafeBearerAuthorization(value), false, `${value} must be allowed`);
  }

  assert.equal(hasUnsafeBearerAuthorization("const headers = { Authorization: `Bearer ${apiKey}` };"), false);
  assert.equal(hasUnsafeBearerAuthorization('export AIRSCALE_API_KEY="YOUR_API_KEY"'), false);
  assert.equal(hasUnsafeBearerAuthorization('export AIRSCALE_API_KEY="$SECRET_FROM_VAULT"'), false);
  assert.equal(hasUnsafeBearerAuthorization("AIRSCALE_API_KEY = process.env.AIRSCALE_API_KEY"), false);
  assert.equal(hasUnsafeBearerAuthorization('AIRSCALE_API_KEY = os.environ["AIRSCALE_API_KEY"]'), false);
  assert.equal(hasUnsafeBearerAuthorization('headers={"Authorization": f"Bearer {api_key}"}'), false);
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
