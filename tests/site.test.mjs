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

  return Array.from(source.matchAll(assignment), ([, operator, expression]) => ({
    operator,
    expression: expression.trim()
  }));
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
    if (/^\{os\.(?:environ\[(?:"AIRSCALE_API_KEY"|'AIRSCALE_API_KEY')\]|getenv\((?:"AIRSCALE_API_KEY"|'AIRSCALE_API_KEY')\))\}$/.test(strippedValue)) {
      return true;
    }

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

function assertBalancedCodeFences(source, path) {
  const fenceCount = (source.match(/^[\t ]*```/gm) ?? []).length;
  assert.equal(fenceCount % 2, 0, `${path} must have balanced code fences`);
}

function assertApprovedNavigationTabs(tabs) {
  assert.deepEqual(tabs, API_REFERENCE_TABS);
}

function sectionSource(source, heading, nextHeading) {
  const marker = `## ${heading}`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `missing ${marker}`);
  const contentStart = start + marker.length;
  const end = nextHeading ? source.indexOf(`## ${nextHeading}`, contentStart) : source.length;
  assert.notEqual(end, -1, `missing ## ${nextHeading}`);
  return source.slice(contentStart, end);
}

function markdownTableRows(source) {
  return source
    .split("\n")
    .filter((line) => /^\|.*\|$/.test(line))
    .map((line) => line.slice(1, -1).split("|").map((cell) => cell.trim()))
    .filter((row) => !row.every((cell) => /^:?-+:?$/.test(cell)));
}

function jsonPayloads(source, label) {
  return Array.from(source.matchAll(/^```json\n([\s\S]*?)^```/gm), ([, json], index) => {
    assert.doesNotThrow(() => JSON.parse(json), `${label} JSON payload ${index + 1} must parse`);
    return JSON.parse(json);
  });
}

function matchesJsonShape(actual, expected, exact = false) {
  if (expected === String) return typeof actual === "string";
  if (expected === Number) return typeof actual === "number";
  if (expected === Boolean) return typeof actual === "boolean";
  if (typeof expected === "function") return expected(actual);
  if (expected === null || typeof expected !== "object") return Object.is(actual, expected);
  if (actual === null || typeof actual !== "object" || Array.isArray(actual) !== Array.isArray(expected)) return false;
  if (Array.isArray(expected)) {
    return actual.length === expected.length && expected.every((value, index) => matchesJsonShape(actual[index], value, exact));
  }
  if (exact && !matchesJsonShape(Object.keys(actual).sort(), Object.keys(expected).sort(), true)) return false;
  return Object.entries(expected).every(([key, value]) => matchesJsonShape(actual[key], value, exact));
}

function assertTableRows(source, rows, label) {
  const actualRows = markdownTableRows(source);
  for (const row of rows) {
    assert.ok(
      actualRows.some((actual) => actual.length >= row.length && matchesJsonShape(actual.slice(0, row.length), row, true)),
      `${label} must contain table row: ${row.join(" | ")}`
    );
  }
}

function assertOrderedFragments(source, fragments, label) {
  let cursor = 0;
  for (const fragment of fragments) {
    const position = source.indexOf(fragment, cursor);
    assert.notEqual(position, -1, `${label} must contain ${fragment} in contract order`);
    cursor = position + fragment.length;
  }
}

function assertContactPageContract(source, contract, path) {
  const requestStart = source.indexOf("## Request");
  assert.notEqual(requestStart, -1, `${path} must have a Request section`);
  const summary = source.slice(0, requestStart);
  const request = sectionSource(source, "Request", "Response");
  const response = sectionSource(source, "Response", "Errors");
  const errors = sectionSource(source, "Errors", "Examples");

  assertTableRows(summary, contract.summaryRows, `${path} contract summary`);
  assertTableRows(request, contract.requestRows, `${path} request`);
  assertTableRows(response, contract.responseRows ?? [], `${path} response`);

  assertOrderedFragments(request, contract.requestFragments, `${path} request`);
  assertOrderedFragments(response, contract.responseFragments, `${path} response`);
  for (const pattern of contract.forbiddenPatterns ?? []) {
    assert.doesNotMatch(source, pattern, `${path} must not contain ${pattern}`);
  }

  const requestExamples = jsonPayloads(request, `${path} request`);
  for (const example of contract.requestExamples) {
    assert.ok(
      requestExamples.some((payload) => matchesJsonShape(payload, example.shape, example.exact)),
      `${path} must include a ${example.label} request payload`
    );
  }

  const responseExamples = jsonPayloads(response, `${path} response`);
  for (const example of contract.responseExamples) {
    assert.ok(
      responseExamples.some((payload) => matchesJsonShape(payload, example.shape, example.exact)),
      `${path} must include a ${example.label} response payload`
    );
  }

  const actualErrors = Object.fromEntries(
    markdownTableRows(errors)
      .filter(([status]) => /^`\d{3} /.test(status))
      .map(([status, cause]) => [status.slice(1, -1), cause])
  );
  assert.deepEqual(Object.keys(actualErrors), Object.keys(contract.errorCauseFragments), `${path} must document the source-backed error statuses`);
  for (const [status, fragments] of Object.entries(contract.errorCauseFragments)) {
    assertOrderedFragments(actualErrors[status], fragments, `${path} ${status} cause`);
  }
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
  assert.equal(hasUnsafeBearerAuthorization("req.Header.Set(\"Authorization\", \"Bearer \"+apiKey)"), false);
  assert.equal(hasUnsafeBearerAuthorization("headers = { Authorization: 'Bearer ' . $apiKey };"), false);
  assert.equal(hasUnsafeBearerAuthorization("Authorization supports Bearer authentication."), false);
  assert.equal(hasUnsafeBearerAuthorization("Use Bearer authentication for every request."), false);

  assert.equal(
    hasApprovedBearerCredentialSource([
      "let apiKey = process.env.AIRSCALE_API_KEY;",
      'apiKey = "live-secret-token";',
      "const headers = { Authorization: `Bearer ${apiKey}` };"
    ].join("\n")),
    false,
    "a later literal reassignment of the Bearer variable must be rejected"
  );
  assert.equal(
    hasApprovedBearerCredentialSource([
      "const apiKey = requireEnv(process.env.AIRSCALE_API_KEY);",
      "const headers = { Authorization: `Bearer ${apiKey}` };"
    ].join("\n")),
    true,
    "a Bearer variable wrapped around the approved environment source must be accepted"
  );

  const unsafePythonEnvironmentWrite = [
    'os.environ["AIRSCALE_API_KEY"] = "live-secret-token"',
    'headers = {"Authorization": f"Bearer {os.environ[\'AIRSCALE_API_KEY\']}"}'
  ].join("\n");
  assert.equal(
    hasUnsafeBearerAuthorization(unsafePythonEnvironmentWrite),
    true,
    "a literal Python environment-key write before an approved Bearer read must be rejected"
  );
  assert.equal(hasApprovedBearerCredentialSource(unsafePythonEnvironmentWrite), false);

  for (const writeTarget of [
    "AIRSCALE_API_KEY",
    "process.env.AIRSCALE_API_KEY",
    'process.env["AIRSCALE_API_KEY"]',
    "process.env['AIRSCALE_API_KEY']",
    'os.environ["AIRSCALE_API_KEY"]',
    "os.environ['AIRSCALE_API_KEY']"
  ]) {
    assert.equal(
      hasUnsafeBearerAuthorization(`${writeTarget} = "live-secret-token";\nAuthorization: Bearer $AIRSCALE_API_KEY`),
      true,
      `${writeTarget} literal writes must be rejected`
    );
  }

  for (const environmentRead of [
    "process.env.AIRSCALE_API_KEY",
    'process.env["AIRSCALE_API_KEY"]',
    "process.env['AIRSCALE_API_KEY']"
  ]) {
    const directJavaScriptRead = `const headers = { Authorization: \`Bearer \${${environmentRead}}\` };`;
    assert.equal(hasUnsafeBearerAuthorization(directJavaScriptRead), false);
    assert.equal(
      hasApprovedBearerCredentialSource(directJavaScriptRead),
      true,
      `${environmentRead} must be accepted as a direct Bearer source`
    );

    const wrappedJavaScriptRead = [
      `const apiKey = requireEnv(${environmentRead});`,
      "const headers = { Authorization: `Bearer ${apiKey}` };"
    ].join("\n");
    assert.equal(hasUnsafeBearerAuthorization(wrappedJavaScriptRead), false);
    assert.equal(
      hasApprovedBearerCredentialSource(wrappedJavaScriptRead),
      true,
      `${environmentRead} must be accepted as the sole wrapped Bearer source`
    );
  }
});

test("code-fence validation rejects malformed indented fences", () => {
  const malformedSource = "  ```bash\n  echo unclosed";

  assert.throws(() => assertBalancedCodeFences(malformedSource, "indented malformed fixture"));
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
    assertBalancedCodeFences(source, path);
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
  assert.match(creditCount, /```javascript (?:Node\.js|JavaScript \(Node\.js 18\+\))/);
  assert.doesNotMatch(creditCount, /```javascript JavaScript\n/);
  assert.match(creditCount, /## Request/);
  assert.match(creditCount, /## Response/);
  assert.match(creditCount, /## Errors/);
  assert.match(creditCount, /\| Airscale credit cost \| No charge; checking the balance does not debit Airscale credits\. \|/);

  const invalidKeyRow = creditCount.match(/\| `401 Unauthorized` \| The API key is invalid\. \| ([^|\n]+) \|/);
  assert.ok(invalidKeyRow, "Credit count must document invalid-key recovery");
  const invalidKeyRecovery = invalidKeyRow[1];
  assert.match(invalidKeyRecovery, /Copy the current key from the Airscale dashboard/i);
  assert.match(invalidKeyRecovery, /verify it matches the deployed value/i);
  assert.match(invalidKeyRecovery, /update your server-side secret first/i);
  assert.match(invalidKeyRecovery, /Rotate only if the key was exposed/i);
  const recoverySteps = ["Copy", "verify", "update", "Rotate"].map((step) => invalidKeyRecovery.indexOf(step));
  assert.ok(recoverySteps.every((position) => position >= 0));
  assert.deepEqual(recoverySteps, [...recoverySteps].sort((left, right) => left - right));

  const assertNumericCreditBalance = (source) => {
    const successBlock = source.match(/## Response[\s\S]*?```json\n([\s\S]*?)\n```/);
    assert.ok(successBlock, "Credit count must contain a JSON success response");
    const payload = JSON.parse(successBlock[1]);
    assert.equal(typeof payload?.response?.credits, "number");
  };
  assertNumericCreditBalance(creditCount);
  const stringCreditMutation = creditCount.replace(
    /("credits"\s*:\s*)(-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/,
    '$1"$2"'
  );
  assert.notEqual(stringCreditMutation, creditCount, "Credit-count mutation fixture must modify the response");
  assert.throws(() => assertNumericCreditBalance(stringCreditMutation));

  assert.match(creditCount, /401/);
  assert.ok(localDocumentationLinks(creditCount).includes("/api-reference/find-people"));
});

test("contact data pages follow the endpoint content system", () => {
  const contracts = {
    "api-reference/email-finder": {
      description: "Find a professional email address for one person.",
      summaryRows: [
        ["Rate limit", "3,000 requests per minute per workspace"],
        ["Request body limit", "256 KiB"],
        ["Airscale credit cost", "2 credits only when the response has `status: \"success\"`; `not_found` is not charged."]
      ],
      requestRows: [
        ["`linkedin_profile_url`", "string", "Required for profile lookup"],
        ["`first_name`", "string", "Required for name lookup"],
        ["`last_name`", "string", "Required for name lookup"],
        ["`domain`", "string", "Conditional"],
        ["`company_name`", "string", "Conditional"]
      ],
      responseRows: [
        ["`status`", "string"],
        ["`email`", "string or null"],
        ["`linkedin_profile_url`", "string"]
      ],
      requestFragments: [
        "one of two ways", "`linkedin_profile_url`", "`first_name`", "`last_name`",
        "`domain`", "`company_name`", "At least one complete form"
      ],
      responseFragments: [
        "`200 OK`", "recognized LinkedIn URL", "supplied", "`200 OK`", "does not charge credits"
      ],
      requestExamples: [
        { label: "profile-identification", shape: { linkedin_profile_url: String }, exact: true },
        { label: "name-and-company-identification", shape: { first_name: String, last_name: String, domain: String }, exact: true }
      ],
      responseExamples: [
        {
          label: "successful professional-email",
          shape: {
            status: "success", email: String, email_status: "valid", provider: String,
            verifier: String, catch_all: String, linkedin_profile_url: String
          },
          exact: true
        },
        { label: "not-found", shape: { status: "not_found", email: null }, exact: true }
      ],
      errorCauseFragments: {
        "400 Bad Request": ["JSON", "neither identification form"],
        "401 Unauthorized": ["Bearer token", "missing", "invalid"],
        "403 Forbidden": ["fewer than 2 credits"],
        "413 Content Too Large": ["exceeds 256 KiB"],
        "429 Too Many Requests": ["3,000 requests", "current minute"],
        "502 Bad Gateway": ["API-key validation", "temporarily unavailable"],
        "503 Service Unavailable": ["successful result", "credit service"],
        "500 Internal Server Error": ["unexpected worker error"]
      },
      mutationLayer: "response",
      mutate: (source) => source.replace('"email_status": "valid"', '"email_status": null')
    },
    "api-reference/email-finder-(bulk)": {
      description: "Find professional email addresses for a batch of people.",
      summaryRows: [
        ["Maximum batch", "100 input items per request"],
        ["Rate limit", "3,000 input items per minute per workspace"],
        ["Request body limit", "256 KiB"],
        ["Airscale credit cost", "2 credits per item with `status: \"success\"`; misses and timeouts are not charged."]
      ],
      requestRows: [
        ["`webhook_url`", "string", "Yes"],
        ["`inputs`", "array", "Yes"],
        ["`custom_id`", "any JSON value", "No"],
        ["`linkedin_profile_url`", "string", "Required for profile lookup"],
        ["`first_name`", "string", "Required for name lookup"],
        ["`last_name`", "string", "Required for name lookup"],
        ["`domain`", "string", "Conditional"],
        ["`company_name`", "string", "Conditional"]
      ],
      responseRows: [
        ["`status`", "string"],
        ["`count`", "number"],
        ["`custom_id`", "any JSON value"],
        ["`email`", "string or null"]
      ],
      requestFragments: [
        "non-empty `inputs`", "`webhook_url`", "`http`", "Between 1 and 100",
        "non-null JSON value", "zero-based array index", "`linkedin_profile_url`",
        "`first_name`", "`last_name`", "`domain`", "`company_name`"
      ],
      responseFragments: [
        "`202 Accepted`", "successful item", "miss or timeout", "non-null value",
        "echoed unchanged", "zero-based array index", "`success`", "`not_found`",
        "`timeout`", "`error`", "insufficient_credits"
      ],
      forbiddenPatterns: [/valid HTTP\(S\) URL|invalid webhook URL|must be a valid URL/i],
      requestExamples: [{
        label: "bounded batch with both identification forms",
        shape: {
          webhook_url: String,
          inputs: (inputs) => Array.isArray(inputs) && inputs.length >= 2
            && inputs.some((item) => typeof item?.linkedin_profile_url === "string")
            && inputs.some((item) => typeof item?.first_name === "string" && typeof item?.last_name === "string"
              && (typeof item?.domain === "string" || typeof item?.company_name === "string"))
        },
        exact: true
      }],
      responseExamples: [
        { label: "202 accepted", shape: { status: "accepted", count: Number }, exact: true },
        {
          label: "successful item webhook",
          shape: {
            custom_id: String, status: "success", email: String, email_status: "valid",
            provider: String, verifier: String
          },
          exact: true
        },
        { label: "not-found item webhook", shape: { custom_id: Number, status: "not_found", email: null }, exact: true }
      ],
      errorCauseFragments: {
        "400 Bad Request": [
          "JSON", "`inputs`", "missing", "not an array", "empty", "over 100",
          "`webhook_url`", "missing", "not a string", "`http`"
        ],
        "401 Unauthorized": ["Bearer token", "missing", "invalid"],
        "403 Forbidden": ["fewer than 2 credits", "batch"],
        "413 Content Too Large": ["exceeds 256 KiB"],
        "429 Too Many Requests": ["3,000 input items", "current minute"],
        "502 Bad Gateway": ["API-key validation", "temporarily unavailable"],
        "500 Internal Server Error": ["unexpected worker error", "before acceptance"]
      },
      mutationLayer: "errors",
      mutate: (source) => source.replace("| `429 Too Many Requests` |", "| `418 I'm a Teapot` |")
    },
    "api-reference/mobile-finder": {
      description: "Find a mobile phone number from a professional profile.",
      summaryRows: [
        ["Rate limit", "3,000 requests per minute per workspace"],
        ["Request body limit", "256 KiB"],
        ["Airscale credit cost", "40 credits only when the response has `status: \"success\"`; `not_found` is not charged."]
      ],
      requestRows: [
        ["`linkedin_profile_url`", "string", "Yes"]
      ],
      responseRows: [
        ["`status`", "string"],
        ["`linkedin_profile_url`", "string"],
        ["`phone_numbers`", "string or null"],
        ["`provider`", "string or null"]
      ],
      requestFragments: ["`linkedin_profile_url`", "LinkedIn person profile URL"],
      responseFragments: [
        "`200 OK`", "Phone number on success", "`null`", "`200 OK`", "without charging credits"
      ],
      forbiddenPatterns: [/E\.164/i],
      requestExamples: [
        { label: "profile-identification", shape: { linkedin_profile_url: String }, exact: true }
      ],
      responseExamples: [
        {
          label: "successful mobile",
          shape: { status: "success", linkedin_profile_url: String, phone_numbers: String, provider: String },
          exact: true
        },
        {
          label: "not-found mobile",
          shape: { status: "not_found", linkedin_profile_url: String, phone_numbers: null, provider: null },
          exact: true
        }
      ],
      errorCauseFragments: {
        "400 Bad Request": ["JSON", "`linkedin_profile_url`", "missing"],
        "401 Unauthorized": ["Bearer token", "missing", "invalid"],
        "403 Forbidden": ["fewer than 40 credits"],
        "413 Content Too Large": ["exceeds 256 KiB"],
        "429 Too Many Requests": ["3,000 requests", "current minute"],
        "502 Bad Gateway": ["API-key validation", "temporarily unavailable"],
        "503 Service Unavailable": ["successful result", "credit service"],
        "500 Internal Server Error": ["unexpected worker error"]
      },
      mutationLayer: "summary",
      mutate: (source) => source.replace(
        "40 credits only when the response has `status: \"success\"`",
        "41 credits only when the response has `status: \"success\"`"
      )
    },
    "api-reference/personal-email": {
      description: "Find a personal email address from a professional profile.",
      summaryRows: [
        ["Rate limit", "2,000 requests per minute per workspace"],
        ["Request body limit", "256 KiB"],
        ["Airscale credit cost", "3–12 credits for a successful result, depending on the result source; `not_found` is not charged."]
      ],
      requestRows: [
        ["`linkedin_profile_url`", "string", "Yes"],
        ["`verification`", "boolean or string", "No"]
      ],
      responseRows: [
        ["`status`", "string"],
        ["`email`", "string or null"]
      ],
      requestFragments: [
        "`linkedin_profile_url`", "`linkedin.com`", "one profile slug", "`/in/`",
        "optional trailing slash", "`verification`", "`true`", "`\"yes\"`"
      ],
      responseFragments: [
        "`200 OK`", "Personal email on success", "`null`", "`200 OK`", "without charging credits"
      ],
      requestExamples: [
        { label: "profile-identification", shape: { linkedin_profile_url: String }, exact: true }
      ],
      responseExamples: [
        { label: "successful personal-email", shape: { status: "success", email: String }, exact: true },
        { label: "not-found personal-email", shape: { status: "not_found", email: null }, exact: true }
      ],
      errorCauseFragments: {
        "400 Bad Request": ["JSON", "profile URL", "missing", "LinkedIn `/in/` URL"],
        "401 Unauthorized": ["Bearer token", "missing", "invalid"],
        "403 Forbidden": ["3-credit minimum", "final result cost"],
        "413 Content Too Large": ["exceeds 256 KiB"],
        "429 Too Many Requests": ["2,000 requests", "current minute"],
        "502 Bad Gateway": ["API-key validation", "usage recording", "temporarily unavailable"],
        "503 Service Unavailable": ["successful result", "credit service"],
        "500 Internal Server Error": ["unexpected worker error"]
      },
      mutationLayer: "summary",
      mutate: (source) => source.replace("3–12 credits for a successful result", "3–10 credits for a successful result")
    },
    "api-reference/people-url-finder": {
      description: "Find a professional profile URL from person and company details.",
      summaryRows: [
        ["Rate limit", "6 requests per second per workspace"],
        ["Request body limit", "256 KiB"],
        ["Airscale credit cost", "0.5 credits only when the response has `status: \"success\"`; `not_found` is not charged."]
      ],
      requestRows: [
        ["`first_name`", "string", "Yes"],
        ["`last_name`", "string", "Yes"],
        ["`company_name`", "string", "Yes"]
      ],
      responseRows: [
        ["`status`", "string"],
        ["`url`", "string"]
      ],
      requestFragments: ["required non-empty strings", "`first_name`", "`last_name`", "`company_name`"],
      responseFragments: [
        "`200 OK`", "Matched profile URL", "success", "`200 OK`", "without charging credits"
      ],
      requestExamples: [{
        label: "person-and-company identification",
        shape: { first_name: String, last_name: String, company_name: String },
        exact: true
      }],
      responseExamples: [
        { label: "successful profile match", shape: { status: "success", url: String }, exact: true },
        { label: "not-found profile match", shape: { status: "not_found" }, exact: true }
      ],
      errorCauseFragments: {
        "400 Bad Request": ["JSON", "required field", "missing", "empty"],
        "401 Unauthorized": ["Bearer token", "missing", "invalid"],
        "403 Forbidden": ["fewer than 0.5 credits"],
        "413 Content Too Large": ["exceeds 256 KiB"],
        "429 Too Many Requests": ["6 requests", "current second"],
        "502 Bad Gateway": ["API-key validation", "temporarily unavailable"],
        "503 Service Unavailable": ["credit reservation service", "temporarily unavailable"],
        "500 Internal Server Error": ["unexpected worker error"]
      },
      mutationLayer: "summary",
      mutate: (source) => source.replace("6 requests per second per workspace", "7 requests per second per workspace")
    }
  };
  const mutationLayers = Object.values(contracts).map(({ mutationLayer }) => mutationLayer);
  assert.ok(mutationLayers.includes("response"), "at least one mutation must prove parsed response-shape enforcement");
  assert.ok(mutationLayers.includes("errors"), "at least one mutation must prove error-status mapping enforcement");
  const manifest = JSON.parse(readFileSync("contracts/public-api-contracts.json", "utf8"));

  assert.equal(
    hasApprovedBearerCredentialSource([
      'const apiKey = "live-secret";',
      "const unused = process.env.AIRSCALE_API_KEY;",
      "const headers = { Authorization: `Bearer ${apiKey}` };"
    ].join("\n")),
    false,
    "an unused environment reference must not make a literal-backed Bearer variable safe"
  );

  for (const [path, contract] of Object.entries(contracts)) {
    const { source, body, frontmatter } = readPage(path);
    const pageName = path.replace("api-reference/", "");
    const evidence = manifest.pages[pageName];

    assert.equal(frontmatter.description, contract.description, `${path} must use the approved description`);
    assert.ok(frontmatter.description, `${path} must have a description`);
    assert.doesNotMatch(body, /^#\s+/m, `${path} must not repeat its title as a body H1`);
    assert.ok(!localDocumentationLinks(source).includes(`/${path}`), `${path} must not link to itself`);
    assert.ok(evidence, `${path} must have contract evidence`);
    for (const endpoint of evidence.endpoints) {
      assert.match(source, new RegExp(`\\b${endpoint.method}\\b`), `${path} must document ${endpoint.method}`);
      assert.ok(source.includes(endpoint.path), `${path} must document ${endpoint.path}`);
      assert.ok(
        source.includes(`<Badge color="blue">${endpoint.method}</Badge> \`${endpoint.path}\``),
        `${path} must show a native method badge beside the full public path`
      );
    }
    assert.match(source, /^## Request$/m, `${path} must have a Request section`);
    assert.match(source, /^## Response$/m, `${path} must have a Response section`);
    assert.match(source, /^## Errors$/m, `${path} must have an Errors section`);
    assert.match(source, /^## Examples$/m, `${path} must have an Examples section`);
    assert.match(source, /^## Next step$/m, `${path} must have a Next step section`);
    assert.match(source, /^```bash(?:\s|$)/m, `${path} must have a bash example`);
    assert.match(source, /^```json(?:\s|$)/m, `${path} must have a JSON example`);
    assert.match(source, /\b(?:credit|billing|charge)\b/i, `${path} must document credit behavior or link to billing guidance`);

    const sectionPositions = ["Request", "Response", "Errors", "Examples", "Next step"]
      .map((heading) => source.indexOf(`## ${heading}`));
    assert.deepEqual(
      sectionPositions,
      [...sectionPositions].sort((left, right) => left - right),
      `${path} must use the approved section order`
    );
    assert.match(source, /## Examples\n\n<CodeGroup>\n```bash cURL/, `${path} examples must use a CodeGroup with cURL first`);

    const authorizationExamples = Array.from(source.matchAll(/^```[^\n]*\n([\s\S]*?)^```/gm), ([, code]) => code)
      .filter((code) => /Authorization[\s\S]*Bearer/i.test(code));
    assert.ok(authorizationExamples.length > 0, `${path} must include an authenticated code example`);
    for (const code of authorizationExamples) {
      assert.equal(hasUnsafeBearerAuthorization(code), false, `${path} code examples must not contain static API keys`);
      assert.equal(
        hasApprovedBearerCredentialSource(code),
        true,
        `${path} code examples must source every Bearer credential from an approved placeholder or environment reference`
      );
    }

    assertContactPageContract(source, contract, path);
    const mutatedSource = contract.mutate(source);
    assert.notEqual(mutatedSource, source, `${path} mutation fixture must change a material contract value`);
    assert.throws(
      () => assertContactPageContract(mutatedSource, contract, `${path} mutated fixture`),
      `${path} contract helper must reject its material-value mutation`
    );
  }
});
