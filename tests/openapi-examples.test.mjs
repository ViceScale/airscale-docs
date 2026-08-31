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
  if (Object.hasOwn(container, "example")) {
    assertRealDirectExample(container.example, `${label} example`);
  }
  for (const [name, exampleObject] of Object.entries(container.examples ?? {})) {
    const exampleLabel = `${label} example ${name}`;
    assertRealDirectExample(namedExampleValue(exampleObject, exampleLabel), exampleLabel);
  }
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
      if (!parameter.schema) continue;
      const parameterLabel = `${operationLabel} parameter ${parameter.name ?? index}`;
      assertExampleContainerShapes(parameter, parameterLabel);
      assertSchemaExampleShapes(parameter.schema, parameterLabel, seenSchemas);
    }
  }
  for (const [name, schema] of Object.entries(openapiDocument.components?.schemas ?? {})) {
    assertSchemaExampleShapes(schema, `component schema ${name}`, seenSchemas);
  }
  for (const [name, exampleObject] of Object.entries(openapiDocument.components?.examples ?? {})) {
    namedExampleValue(exampleObject, `component example ${name}`);
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
  return /(?:^|\.)example\.(?:com|org)$/i.test(hostname) || /\.example$/i.test(hostname);
}

function isApprovedExampleEmailHost(hostname) {
  return /(?:^|\.)example\.(?:com|org)$/i.test(hostname);
}

function isLinkedInHostname(hostname) {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  return normalized === "linkedin.com" || normalized.endsWith(".linkedin.com");
}

function parseLinkedInUrl(value) {
  try {
    const parsed = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    return isLinkedInHostname(parsed.hostname) ? parsed : null;
  } catch {
    return null;
  }
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

  if (!APPROVED_BEARER_PLACEHOLDERS.has(value)) {
    assert.doesNotMatch(value, DISALLOWED_EXAMPLE, `${label}: credential or consumer-domain value is forbidden`);
  }
  assert.doesNotMatch(value, PROVIDER_IDENTITIES, `${label}: provider/internal identity is forbidden`);

  for (const match of value.matchAll(/[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})/gi)) {
    assert.ok(isApprovedExampleEmailHost(match[1]), `${label}: email must use example.com or example.org`);
  }

  const normalizedKey = key.toLowerCase().replaceAll(/[^a-z]/g, "");
  if (["phone", "phonenumber", "phonenumbers", "mobilephone", "mobilephonenumber", "mobilephonenumbers"].includes(normalizedKey)) {
    assert.equal(value, APPROVED_PHONE, `${label}: phone must use the approved non-routable fixture`);
  }

  const linkedInUrl = parseLinkedInUrl(value);
  if (linkedInUrl) {
    assertSyntheticLinkedIn(linkedInUrl, label);
    return;
  }

  if (/^https?:\/\//i.test(value)) {
    const hostname = new URL(value).hostname;
    assert.ok(isReservedExampleHost(hostname), `${label}: URL origin ${hostname} is not an approved example origin`);
  }

  if (normalizedKey.includes("domain") && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(value)) {
    assert.ok(isReservedExampleHost(value), `${label}: domain must use example.com or example.org`);
  }

  if (/^(?:authorization|apikey|accesstoken|secret|password|token)$/i.test(normalizedKey)) {
    assert.ok(
      APPROVED_CREDENTIAL_PLACEHOLDERS.has(value),
      `${label}: credential examples must use an approved placeholder`
    );
  }
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
      if (!parameter.schema) continue;
      parameterExamples += validateExampleContainer(
        parameter,
        parameter.schema,
        `${operationLabel} parameter ${parameter.name ?? index}`,
        exampleValues
      );
      parameterExamples += collectSchemaExamples(
        parameter.schema,
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
