import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import SwaggerParser from "@apidevtools/swagger-parser";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: true });
addFormats(ajv);

const rawDocument = JSON.parse(readFileSync("openapi.json", "utf8"));
const document = await SwaggerParser.dereference(structuredClone(rawDocument));

const BODYLESS_OPERATIONS = new Set([
  "GET /v1/find-companies/filter-values",
  "POST /v1/credits"
]);
const PRIVATE_IDENTITY_FIELDS = new Set(["provider", "verifier", "provider_internal"]);
const PROVIDER_IDENTITIES = /\b(?:Prospeo|Icypeas|RapidAPI|Leadmagic|SalesQL|Limadata|ContactOut|Wiza|Forager|Bounceban|Findymail|Trykitt|Kitt|A-?Leads|Explorium|OpenAI|Serper|Jina|HistoricalImport|EmailLogCache|Supabase|Bubble|Durable Object)\b/i;
const DISALLOWED_EXAMPLE = /(sk_live|pk_live|Bearer\s+|@gmail\.com|@yahoo\.com|@googlemail\.com)/i;
const APPROVED_BEARER_PLACEHOLDERS = new Set([
  "Bearer $AIRSCALE_API_KEY",
  "Bearer YOUR_API_KEY",
  "Bearer <YOUR_API_KEY>"
]);
const APPROVED_CREDENTIAL_PLACEHOLDERS = new Set([
  "$AIRSCALE_API_KEY",
  "YOUR_API_KEY",
  "<YOUR_API_KEY>",
  ...APPROVED_BEARER_PLACEHOLDERS
]);
const APPROVED_PHONE = "+12025550147";

function assertValid(schema, value, label) {
  const validate = ajv.compile(structuredClone(schema));
  assert.equal(validate(value), true, `${label}: ${ajv.errorsText(validate.errors)}`);
}

function operationsFrom(openapiDocument) {
  const operations = [];
  for (const [path, pathItem] of Object.entries(openapiDocument.paths ?? {})) {
    for (const method of ["get", "post"]) {
      if (pathItem[method]) {
        operations.push({
          method: method.toUpperCase(),
          path,
          operation: pathItem[method],
          parameters: [...(pathItem.parameters ?? []), ...(pathItem[method].parameters ?? [])]
        });
      }
    }
  }
  return operations;
}

function namedExampleValue(exampleObject, label) {
  assert.ok(
    exampleObject && typeof exampleObject === "object" && !Array.isArray(exampleObject),
    `${label}: named example must be an Example Object with a value`
  );
  assert.ok(
    Object.hasOwn(exampleObject, "value"),
    `${label}: named example must contain a real value; $ref-only and externalValue examples are unsupported`
  );
  return exampleObject.value;
}

function assertRealDirectExample(value, label) {
  assert.ok(
    !(value && typeof value === "object" && !Array.isArray(value)
      && Object.keys(value).length > 0
      && Object.keys(value).every((key) => key === "$ref" || key === "externalValue")),
    `${label}: example must contain a real value, not only $ref/externalValue metadata`
  );
}

function assertExampleContainerShapes(container, label) {
  const values = [];
  if (Object.hasOwn(container, "example")) {
    assertRealDirectExample(container.example, `${label} example`);
    values.push({ label: `${label} example`, value: container.example });
  }
  for (const [name, exampleObject] of Object.entries(container.examples ?? {})) {
    const exampleLabel = `${label} example ${name}`;
    const value = namedExampleValue(exampleObject, exampleLabel);
    assertRealDirectExample(value, exampleLabel);
    values.push({ label: exampleLabel, value });
  }
  return values;
}

function assertSchemaExampleShapes(schema, label, seen = new Set()) {
  if (!schema || typeof schema !== "object" || seen.has(schema)) return;
  seen.add(schema);
  if (Object.hasOwn(schema, "example")) {
    assertRealDirectExample(schema.example, `${label} schema example`);
  }
  if (Object.hasOwn(schema, "examples")) {
    assert.ok(Array.isArray(schema.examples), `${label}: JSON Schema examples must be an array`);
    for (const [index, value] of schema.examples.entries()) {
      assertRealDirectExample(value, `${label} schema example ${index}`);
    }
  }
  for (const [key, child] of Object.entries(schema)) {
    if (key === "example" || key === "examples") continue;
    if (Array.isArray(child)) {
      for (const [index, value] of child.entries()) {
        assertSchemaExampleShapes(value, `${label}.${key}[${index}]`, seen);
      }
    } else {
      assertSchemaExampleShapes(child, `${label}.${key}`, seen);
    }
  }
}

function assertAuthoredExampleShapes(openapiDocument) {
  const seenSchemas = new Set();
  for (const { method, path, operation, parameters } of operationsFrom(openapiDocument)) {
    const operationLabel = `${method} ${path}`;
    assertCodeSampleShapes(operation, operationLabel);
    for (const [mediaType, content] of Object.entries(operation.requestBody?.content ?? {})) {
      assertExampleContainerShapes(content, `${operationLabel} request ${mediaType}`);
      assertSchemaExampleShapes(content.schema, `${operationLabel} request ${mediaType}`, seenSchemas);
    }
    for (const [status, response] of Object.entries(operation.responses ?? {})) {
      if (response.$ref) continue;
      for (const [mediaType, content] of Object.entries(response.content ?? {})) {
        assertExampleContainerShapes(content, `${operationLabel} response ${status} ${mediaType}`);
        assertSchemaExampleShapes(content.schema, `${operationLabel} response ${status} ${mediaType}`, seenSchemas);
      }
    }
    for (const [index, parameter] of parameters.entries()) {
      const parameterLabel = `${operationLabel} parameter ${parameter.name ?? index}`;
      if (parameter.schema) {
        assertExampleContainerShapes(parameter, parameterLabel);
        assertSchemaExampleShapes(parameter.schema, parameterLabel, seenSchemas);
      }
      for (const [mediaType, content] of Object.entries(parameter.content ?? {})) {
        for (const example of assertExampleContainerShapes(content, `${parameterLabel} ${mediaType}`)) {
          assertSafeExampleValue(example.value, example.label);
        }
        assertSchemaExampleShapes(content.schema, `${parameterLabel} ${mediaType}`, seenSchemas);
      }
    }
  }
  for (const [name, schema] of Object.entries(openapiDocument.components?.schemas ?? {})) {
    assertSchemaExampleShapes(schema, `component schema ${name}`, seenSchemas);
  }
  for (const [name, exampleObject] of Object.entries(openapiDocument.components?.examples ?? {})) {
    const label = `component example ${name}`;
    const value = namedExampleValue(exampleObject, label);
    assertRealDirectExample(value, label);
    assertSafeExampleValue(value, label);
  }
}

function validateExampleContainer(container, schema, label, values) {
  let count = 0;
  if (Object.hasOwn(container, "example")) {
    assertRealDirectExample(container.example, `${label} example`);
    assertValid(schema, container.example, `${label} example`);
    values.push({ label: `${label} example`, value: container.example });
    count += 1;
  }
  for (const [name, exampleObject] of Object.entries(container.examples ?? {})) {
    const exampleLabel = `${label} example ${name}`;
    const value = namedExampleValue(exampleObject, exampleLabel);
    assertRealDirectExample(value, exampleLabel);
    assertValid(schema, value, exampleLabel);
    values.push({ label: exampleLabel, value });
    count += 1;
  }
  return count;
}

function validateParameterExamples(parameter, label, values, seenSchemas) {
  let count = 0;
  if (parameter.schema) {
    count += validateExampleContainer(parameter, parameter.schema, label, values);
    count += collectSchemaExamples(parameter.schema, label, values, seenSchemas);
  }
  for (const [mediaType, content] of Object.entries(parameter.content ?? {})) {
    const contentLabel = `${label} ${mediaType}`;
    assert.ok(content.schema, `${contentLabel}: parameter content needs a schema`);
    count += validateExampleContainer(content, content.schema, contentLabel, values);
    count += collectSchemaExamples(content.schema, contentLabel, values, seenSchemas);
  }
  return count;
}

function collectSchemaExamples(schema, label, values, seen = new Set()) {
  if (!schema || typeof schema !== "object" || seen.has(schema)) return 0;
  seen.add(schema);
  let count = 0;

  if (Object.hasOwn(schema, "example")) {
    assertRealDirectExample(schema.example, `${label} schema example`);
    assertValid(schema, schema.example, `${label} schema example`);
    values.push({ label: `${label} schema example`, value: schema.example });
    count += 1;
  }
  if (Object.hasOwn(schema, "examples")) {
    assert.ok(Array.isArray(schema.examples), `${label}: JSON Schema examples must be an array`);
    for (const [index, value] of schema.examples.entries()) {
      assertRealDirectExample(value, `${label} schema example ${index}`);
      assertValid(schema, value, `${label} schema example ${index}`);
      values.push({ label: `${label} schema example ${index}`, value });
      count += 1;
    }
  }

  for (const [key, child] of Object.entries(schema)) {
    if (key === "example" || key === "examples") continue;
    if (Array.isArray(child)) {
      for (const [index, value] of child.entries()) {
        count += collectSchemaExamples(value, `${label}.${key}[${index}]`, values, seen);
      }
    } else {
      count += collectSchemaExamples(child, `${label}.${key}`, values, seen);
    }
  }
  return count;
}

function isReservedExampleHost(hostname) {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  return /(?:^|\.)example\.(?:com|org|net)$/.test(normalized)
    || /(?:^|\.)[^.]+\.test$/.test(normalized)
    || /\.example$/.test(normalized);
}

function isApprovedExampleEmailHost(hostname) {
  return isReservedExampleHost(hostname);
}

function isLinkedInHostname(hostname) {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  return normalized === "linkedin.com" || normalized.endsWith(".linkedin.com");
}

function isUrlBearingKey(normalizedKey) {
  return normalizedKey === "url"
    || normalizedKey.endsWith("url")
    || normalizedKey.includes("website")
    || normalizedKey.includes("domain")
    || normalizedKey === "link"
    || normalizedKey.endsWith("link")
    || normalizedKey.startsWith("linkedin")
    || normalizedKey === "source"
    || normalizedKey === "sources";
}

function parseExampleUrl(value, normalizedKey, label) {
  const normalizedValue = isUrlBearingKey(normalizedKey) ? value.trim() : value;
  let candidate;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(normalizedValue)) {
    candidate = normalizedValue;
  } else if (normalizedValue.startsWith("//")) {
    candidate = `https:${normalizedValue}`;
  } else if (
    isUrlBearingKey(normalizedKey)
    && /^(?:(?:[a-z0-9-]+\.)+[a-z0-9-]+|localhost)(?::[0-9]+)?(?:[/?#][^\s]*)?$/i.test(normalizedValue)
  ) {
    candidate = `https://${normalizedValue}`;
  } else {
    return null;
  }

  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    assert.fail(`${label}: malformed URL value`);
  }
  assert.ok(
    parsed.protocol === "http:" || parsed.protocol === "https:",
    `${label}: URL scheme must be http or https`
  );
  return parsed;
}

function assertSyntheticLinkedIn(parsed, label) {
  assert.match(parsed.pathname, /(?:^|[-_/])example(?:[-_/]|$)/i, `${label}: LinkedIn URL needs a synthetic example slug`);
}

function assertSafeExampleValue(value, label, key = "") {
  if (Array.isArray(value)) {
    for (const [index, child] of value.entries()) {
      assertSafeExampleValue(child, `${label}[${index}]`, key);
    }
    return;
  }
  if (value && typeof value === "object") {
    for (const [childKey, child] of Object.entries(value)) {
      assert.ok(
        !PRIVATE_IDENTITY_FIELDS.has(childKey.toLowerCase()) || child === null,
        `${label}.${childKey}: private provider identity fields must be null`
      );
      assertSafeExampleValue(child, `${label}.${childKey}`, childKey);
    }
    return;
  }
  if (typeof value !== "string") return;

  const normalizedKey = key.toLowerCase().replaceAll(/[^a-z]/g, "");

  if (!APPROVED_BEARER_PLACEHOLDERS.has(value)) {
    assert.doesNotMatch(value, DISALLOWED_EXAMPLE, `${label}: credential or consumer-domain value is forbidden`);
  }
  assert.doesNotMatch(value, PROVIDER_IDENTITIES, `${label}: provider/internal identity is forbidden`);

  for (const match of value.matchAll(/[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})/gi)) {
    assert.ok(isApprovedExampleEmailHost(match[1]), `${label}: email must use an RFC-reserved example host`);
  }

  if (["phone", "phonenumber", "phonenumbers", "mobilephone", "mobilephonenumber", "mobilephonenumbers"].includes(normalizedKey)) {
    assert.equal(value, APPROVED_PHONE, `${label}: phone must use the approved non-routable fixture`);
  }

  const parsedUrl = parseExampleUrl(value, normalizedKey, label);
  if (parsedUrl) {
    if (isLinkedInHostname(parsedUrl.hostname)) {
      assertSyntheticLinkedIn(parsedUrl, label);
    } else {
      assert.ok(
        isReservedExampleHost(parsedUrl.hostname),
        `${label}: URL origin ${parsedUrl.hostname} is not an approved example origin`
      );
    }
  }

  if (/^(?:authorization|apikey|accesstoken|secret|password|token)$/i.test(normalizedKey)) {
    assert.ok(
      APPROVED_CREDENTIAL_PLACEHOLDERS.has(value),
      `${label}: credential examples must use an approved placeholder`
    );
  }
}

function assertSafeCodeSampleSource(source, label) {
  assert.doesNotMatch(source, PROVIDER_IDENTITIES, `${label}: provider/internal identity is forbidden`);
  assert.doesNotMatch(
    source,
    /(sk_live|pk_live|@gmail\.com|@yahoo\.com|@googlemail\.com)/i,
    `${label}: credential or consumer-domain value is forbidden`
  );

  const withoutApprovedBearerValues = source
    .replace(/Bearer \$AIRSCALE_API_KEY(?=$|[\s'"`])/g, "")
    .replace(/Bearer \$\{process\.env\.AIRSCALE_API_KEY\}(?=$|[\s'"`])/g, "")
    .replace(/Bearer \{os\.environ\["AIRSCALE_API_KEY"\]\}(?=$|[\s'"`])/g, "");
  assert.doesNotMatch(
    withoutApprovedBearerValues,
    /\bBearer\s+[^\s'"`]+/i,
    `${label}: credential examples must use the AIRSCALE_API_KEY environment placeholder`
  );

  for (const match of source.matchAll(/https?:\/\/[^\s'"`]+/gi)) {
    const parsed = new URL(match[0]);
    assert.ok(
      parsed.hostname === "api.airscale.io" || isReservedExampleHost(parsed.hostname),
      `${label}: URL origin ${parsed.hostname} is not an approved code-sample origin`
    );
  }
}

function assertCodeSampleShapes(operation, label) {
  if (!Object.hasOwn(operation, "x-codeSamples")) return 0;
  const codeSamples = operation["x-codeSamples"];
  assert.ok(Array.isArray(codeSamples), `${label}: x-codeSamples must be an array`);
  for (const [index, codeSample] of codeSamples.entries()) {
    const sampleLabel = `${label} x-codeSamples[${index}]`;
    assert.ok(
      codeSample && typeof codeSample === "object" && !Array.isArray(codeSample),
      `${sampleLabel}: code sample must be an object`
    );
    assert.equal(typeof codeSample.label, "string", `${sampleLabel}: label must be a string`);
    assert.equal(typeof codeSample.lang, "string", `${sampleLabel}: lang must be a string`);
    assert.equal(typeof codeSample.source, "string", `${sampleLabel}: source must be a string`);
    assert.ok(codeSample.source.length > 0, `${sampleLabel}: source must be non-empty`);
    assertSafeCodeSampleSource(codeSample.source, sampleLabel);
  }
  return codeSamples.length;
}

test("all public operation examples validate against their dereferenced schemas", (t) => {
  assertAuthoredExampleShapes(rawDocument);
  const operations = operationsFrom(document);
  assert.equal(operations.length, 15, "expected exactly 15 GET/POST public operations");

  const exampleValues = [];
  const seenSchemas = new Set();
  let requestExamples = 0;
  let responseExamples = 0;
  let parameterExamples = 0;

  for (const { method, path, operation, parameters } of operations) {
    const operationLabel = `${method} ${path}`;
    const expectsNoBody = BODYLESS_OPERATIONS.has(operationLabel);
    assert.equal(Boolean(operation.requestBody), !expectsNoBody, `${operationLabel}: unexpected request-body shape`);

    if (operation.requestBody) {
      let operationRequestExamples = 0;
      for (const [mediaType, content] of Object.entries(operation.requestBody.content ?? {})) {
        operationRequestExamples += validateExampleContainer(
          content,
          content.schema,
          `${operationLabel} request ${mediaType}`,
          exampleValues
        );
        collectSchemaExamples(
          content.schema,
          `${operationLabel} request ${mediaType}`,
          exampleValues,
          seenSchemas
        );
      }
      assert.ok(operationRequestExamples >= 1, `${operationLabel}: request body needs at least one example`);
      requestExamples += operationRequestExamples;
    }

    let successExamples = 0;
    for (const [status, response] of Object.entries(operation.responses ?? {})) {
      for (const [mediaType, content] of Object.entries(response.content ?? {})) {
        const count = validateExampleContainer(
          content,
          content.schema,
          `${operationLabel} response ${status} ${mediaType}`,
          exampleValues
        );
        if (status === "200" || status === "202") successExamples += count;
        responseExamples += count;
        collectSchemaExamples(
          content.schema,
          `${operationLabel} response ${status} ${mediaType}`,
          exampleValues,
          seenSchemas
        );
      }
    }
    assert.ok(successExamples >= 1, `${operationLabel}: 200 or 202 response needs at least one example`);

    for (const [index, parameter] of parameters.entries()) {
      parameterExamples += validateParameterExamples(
        parameter,
        `${operationLabel} parameter ${parameter.name ?? index}`,
        exampleValues,
        seenSchemas
      );
    }
  }

  for (const [name, schema] of Object.entries(document.components?.schemas ?? {})) {
    collectSchemaExamples(schema, `component schema ${name}`, exampleValues, seenSchemas);
  }
  for (const { label, value } of exampleValues) assertSafeExampleValue(value, label);

  t.diagnostic(
    `validated ${operations.length} operations, ${requestExamples} request examples, ${responseExamples} response examples, ${parameterExamples} parameter examples, and ${exampleValues.length} total authored values including schema examples`
  );
});

test("LinkedIn example detection requires an exact LinkedIn hostname", () => {
  for (const value of [
    "https://evil.com/linkedin.com/example-person",
    "https://notlinkedin.com/in/example-person"
  ]) {
    assert.throws(
      () => assertSafeExampleValue(value, "mutant URL"),
      /not an approved example origin/
    );
  }
  assert.doesNotThrow(() => assertSafeExampleValue(
    "https://linkedin.com/in/example-person",
    "exact LinkedIn host"
  ));
  assert.doesNotThrow(() => assertSafeExampleValue(
    "https://www.linkedin.com/company/example-company",
    "LinkedIn subdomain"
  ));
  assert.throws(
    () => assertSafeExampleValue("https://linkedin.com/in/real-person", "LinkedIn slug mutant"),
    /synthetic example slug/
  );
});

test("provider identity guard rejects every known provider without substring false positives", () => {
  for (const provider of ["Explorium", "OpenAI", "Serper", "Jina"]) {
    assert.throws(
      () => assertSafeExampleValue(`Result from ${provider}`, `${provider} mutant`),
      /provider\/internal identity is forbidden/
    );
  }
  for (const safeValue of ["Exploration", "Open API", "serpentine", "jingle"]) {
    assert.doesNotThrow(() => assertSafeExampleValue(safeValue, `${safeValue} control`));
  }
});

test("Bearer placeholders are allowed only as exact whole-string values", () => {
  for (const placeholder of [
    "Bearer $AIRSCALE_API_KEY",
    "Bearer YOUR_API_KEY",
    "Bearer <YOUR_API_KEY>"
  ]) {
    assert.doesNotThrow(() => assertSafeExampleValue({ note: placeholder }, "approved Bearer placeholder"));
  }
  for (const value of [
    "Bearer $AIRSCALE_API_KEY leaked",
    "prefix Bearer YOUR_API_KEY",
    "Bearer <YOUR_API_KEY> suffix",
    "Bearer YOUR_API_KEY/extra"
  ]) {
    assert.throws(
      () => assertSafeExampleValue({ note: value }, "Bearer mutant"),
      /credential or consumer-domain value is forbidden/
    );
  }
});

test("authored x-codeSamples enter the structural privacy and safety walk", () => {
  const safeSource = [
    "curl --request GET \\",
    "  --url 'https://api.airscale.io/v1/find-companies/filter-values?filter=industry&q=example' \\",
    '  --header "Authorization: Bearer $AIRSCALE_API_KEY"'
  ].join("\n");
  const fixture = (source) => ({
    paths: {
      "/fixture": {
        get: {
          "x-codeSamples": [{ label: "cURL", lang: "bash", source }]
        }
      }
    }
  });

  assert.doesNotThrow(() => assertAuthoredExampleShapes(fixture(safeSource)));
  assert.throws(
    () => assertAuthoredExampleShapes(fixture(safeSource.replace("$AIRSCALE_API_KEY", "sk_live_example"))),
    /credential/
  );
  assert.throws(
    () => assertAuthoredExampleShapes(fixture(`${safeSource}\n# OpenAI`)),
    /provider\/internal identity/
  );
  assert.throws(
    () => assertAuthoredExampleShapes(fixture(safeSource.replace("api.airscale.io", "real-company.com"))),
    /not an approved code-sample origin/
  );
});

test("code-sample Bearer environment placeholders require a terminal boundary", () => {
  for (const source of [
    'Authorization: "Bearer $AIRSCALE_API_KEY"',
    'Authorization: `Bearer ${process.env.AIRSCALE_API_KEY}`',
    'Authorization: f\'Bearer {os.environ["AIRSCALE_API_KEY"]}\'',
    "Authorization: Bearer $AIRSCALE_API_KEY\nnext",
    "Authorization: Bearer $AIRSCALE_API_KEY"
  ]) {
    assert.doesNotThrow(() => assertSafeCodeSampleSource(source, "valid boundary control"));
  }

  for (const source of [
    "Authorization: Bearer $AIRSCALE_API_KEYsuffix",
    "Authorization: Bearer ${process.env.AIRSCALE_API_KEY}suffix",
    'Authorization: Bearer {os.environ["AIRSCALE_API_KEY"]}suffix'
  ]) {
    assert.throws(
      () => assertSafeCodeSampleSource(source, "suffix mutant"),
      /credential examples must use the AIRSCALE_API_KEY environment placeholder/
    );
  }
});

test("URL-bearing fields normalize absolute, scheme-relative, and bare-host values", () => {
  for (const [label, value] of [
    ["LinkedIn lookalike", { linkedin_profile_url: "notlinkedin.com/in/real-person" }],
    ["camel-case LinkedIn lookalike", { linkedinProfile: "notlinkedin.com/in/real-person" }],
    ["bare website", { website: "real-company.com" }],
    ["scheme-relative website", { website: "//real-company.com/path" }]
  ]) {
    assert.throws(
      () => assertSafeExampleValue(value, `${label} mutant`),
      /not an approved example origin/
    );
  }
  assert.throws(
    () => assertSafeExampleValue(
      { linkedin_profile_url: "//linkedin.com/in/real-person" },
      "LinkedIn slug mutant"
    ),
    /synthetic example slug/
  );
  for (const value of [
    { linkedin_profile_url: "linkedin.com/in/example-person" },
    { linkedin_profile_url: "//www.linkedin.com/in/example-person" },
    { website: "example.net" },
    { website: "//company.test/path" }
  ]) {
    assert.doesNotThrow(() => assertSafeExampleValue(value, "valid URL control"));
  }
  assert.doesNotThrow(() => assertSafeExampleValue(
    { prompt: "Compare real-company.com positioning with the synthetic fixture." },
    "prose control"
  ));
});

test("parameter content examples use their media schema and enter the privacy walk", () => {
  const inspect = (parameter) => {
    const values = [];
    const count = validateParameterExamples(parameter, "fixture parameter", values, new Set());
    for (const { label, value } of values) assertSafeExampleValue(value, label);
    return count;
  };
  const parameter = {
    name: "filter",
    in: "query",
    content: {
      "application/json": {
        schema: {
          type: "object",
          required: ["website"],
          additionalProperties: false,
          properties: { website: { type: "string" } }
        },
        examples: {
          valid: { value: { website: "example.net" } }
        }
      }
    }
  };
  assert.equal(inspect(parameter), 1);

  parameter.content["application/json"].examples.invalidSchema = {
    value: { website: 42 }
  };
  assert.throws(() => inspect(parameter), /must be string/);
  delete parameter.content["application/json"].examples.invalidSchema;

  parameter.content["application/json"].examples.unsafe = {
    value: { website: "real-company.com" }
  };
  assert.throws(() => inspect(parameter), /not an approved example origin/);
});

test("unreferenced component examples enter the privacy safety walk", () => {
  assert.throws(
    () => assertAuthoredExampleShapes({
      paths: {},
      components: {
        examples: {
          unsafe: {
            value: { website: "real-company.com" }
          }
        }
      }
    }),
    /not an approved example origin/
  );
});

test("reserved example hosts are accepted without suffix lookalikes", () => {
  for (const value of [
    { website: "https://example.com/path" },
    { website: "https://docs.example.org/path" },
    { website: "https://example.net/path" },
    { website: "https://docs.example.net/path" },
    { website: "https://company.test/path" },
    { website: "//company.test/path" },
    { website: "docs.example" },
    { email: "person@example.net" },
    { email: "person@company.test" }
  ]) {
    assert.doesNotThrow(() => assertSafeExampleValue(value, "reserved host control"));
  }
  for (const value of [
    { website: "https://notexample.com/path" },
    { website: "https://example.com.evil/path" },
    { website: "example.net.evil" },
    { email: "person@example.net.evil" },
    { email: "person@company.test.evil" }
  ]) {
    assert.throws(
      () => assertSafeExampleValue(value, "suffix lookalike mutant"),
      /not an approved example origin|email must use/
    );
  }
});

test("bare URL normalization requires a dotted authority signal", () => {
  for (const value of [
    { source: "manual" },
    { sources: ["website"] },
    { link: "profile" },
    { linkedin_status: "active" },
    { linkedinStatus: "inactive" }
  ]) {
    assert.doesNotThrow(() => assertSafeExampleValue(value, "single-token metadata control"));
  }
  for (const value of [
    { source: "real-source.com" },
    { sources: ["real-source.com"] },
    { link: "real-profile.com/path" },
    { linkedin_status: "real-status.com" },
    { website: "localhost" },
    { website: "localhost:3000/path" }
  ]) {
    assert.throws(
      () => assertSafeExampleValue(value, "dotted bare-origin mutant"),
      /not an approved example origin/
    );
  }
  assert.throws(
    () => assertSafeExampleValue({ source: "https://real-source.com" }, "absolute origin mutant"),
    /not an approved example origin/
  );
  assert.throws(
    () => assertSafeExampleValue({ link: "//real-profile.com/path" }, "scheme-relative origin mutant"),
    /not an approved example origin/
  );
});
