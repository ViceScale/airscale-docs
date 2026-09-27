// Real response bodies (captured live or read from the airscale-code response
// builders and worker tests) must match the published schemas. Examples are
// authored against the schema, so this is the check that catches a schema
// that has drifted away from what the API actually returns.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import SwaggerParser from "@apidevtools/swagger-parser";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const SAMPLE_DIR = new URL("../contracts/response-samples/", import.meta.url);
const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: true });
addFormats(ajv);

const document = await SwaggerParser.dereference(JSON.parse(readFileSync("openapi.json", "utf8")));
const samples = readdirSync(SAMPLE_DIR)
  .filter((name) => name.endsWith(".json"))
  .map((name) => ({ name, ...JSON.parse(readFileSync(new URL(name, SAMPLE_DIR), "utf8")) }));

// Operations without a sample, and why. Every operation is currently sampled.
const UNSAMPLED = {};

// Operations that spread provider fields into the body. Samples must still
// validate, but may carry fields the schema does not list.
const PASSTHROUGH = new Set();

function operations() {
  const found = [];
  for (const [path, item] of Object.entries(document.paths)) {
    for (const method of ["get", "post", "patch", "delete"]) {
      if (item[method]) found.push({ key: `${method.toUpperCase()} ${path}`, operation: item[method] });
    }
  }
  return found;
}

function responseSchema(operationKey, status) {
  const entry = operations().find(({ key }) => key === operationKey);
  assert.ok(entry, `${operationKey}: operation is not published`);
  const response = entry.operation.responses[String(status)];
  assert.ok(response, `${operationKey}: HTTP ${status} is not documented`);
  const schema = response.content?.["application/json"]?.schema;
  assert.ok(schema, `${operationKey}: HTTP ${status} has no JSON schema`);
  return schema;
}

function branches(schema) {
  if (!schema || typeof schema !== "object") return [];
  const nested = [...(schema.anyOf ?? []), ...(schema.oneOf ?? []), ...(schema.allOf ?? [])];
  return [schema, ...nested.flatMap(branches)];
}

// Returns the paths of object keys in value that no schema branch declares.
export function undocumentedKeys(value, schemas, path = "$") {
  const all = schemas.flatMap(branches);
  if (Array.isArray(value)) {
    const itemSchemas = all.map((schema) => schema.items).filter(Boolean);
    return value.flatMap((child, index) => undocumentedKeys(child, itemSchemas, `${path}[${index}]`));
  }
  if (!value || typeof value !== "object") return [];
  const missing = [];
  for (const [key, child] of Object.entries(value)) {
    const childSchemas = all.map((schema) => schema.properties?.[key]).filter(Boolean);
    // A typed additionalProperties schema documents a map of caller-defined
    // keys, such as the fields requested through an Airsearch schema.
    if (childSchemas.length === 0) {
      childSchemas.push(...all.map((schema) => schema.additionalProperties).filter((extra) => extra && typeof extra === "object"));
    }
    if (childSchemas.length === 0) {
      missing.push(`${path}.${key}`);
      continue;
    }
    missing.push(...undocumentedKeys(child, childSchemas, `${path}.${key}`));
  }
  return missing;
}

test("every published operation has a real response sample or a recorded reason", () => {
  const sampled = new Set(samples.map((sample) => sample.operation));
  for (const { key } of operations()) {
    assert.ok(sampled.has(key) || Object.hasOwn(UNSAMPLED, key), `${key}: add a response sample under contracts/response-samples/`);
  }
  for (const key of Object.keys(UNSAMPLED)) {
    assert.ok(operations().some((entry) => entry.key === key), `${key}: stale UNSAMPLED entry`);
    assert.ok(!sampled.has(key), `${key}: has a sample, remove it from UNSAMPLED`);
  }
});

// Samples are published with the docs: they must not name a data provider.
const PROVIDER_IDENTITIES = /(?:prospeo|icypeas|rapidapi|leadmagic|salesql|limadata|contactout|wiza|forager|bounceban|findymail|trykitt|a-?leads|explorium|upcell|adyntel|ai[\s._-]*ark|harvest|unipile|b2b-?enrichment|openai|serper|jina)/i;

test("response samples never name a data provider", () => {
  for (const name of readdirSync(SAMPLE_DIR).filter((file) => file.endsWith(".json"))) {
    assert.doesNotMatch(readFileSync(new URL(name, SAMPLE_DIR), "utf8"), PROVIDER_IDENTITIES, name);
  }
});

test("every response sample records its provenance", () => {
  for (const sample of samples) {
    assert.ok(["live", "code"].includes(sample.source), `${sample.name}: source must be live or code`);
    assert.equal(typeof sample.evidence, "string", `${sample.name}: evidence is required`);
    assert.ok(Number.isInteger(sample.status), `${sample.name}: status is required`);
    if (sample.source === "code") {
      assert.match(sample.sourceSha ?? "", /^[0-9a-f]{40}$/, `${sample.name}: code samples pin an airscale-code commit`);
    }
  }
});

for (const sample of samples) {
  test(`${sample.name} matches the published ${sample.operation} HTTP ${sample.status} schema`, () => {
    const schema = responseSchema(sample.operation, sample.status);
    const validate = ajv.compile(structuredClone(schema));
    assert.equal(validate(sample.body), true, ajv.errorsText(validate.errors));
    if (!PASSTHROUGH.has(sample.operation)) {
      assert.deepEqual(undocumentedKeys(sample.body, [schema]), [], "fields returned by the API are missing from the schema");
    }
  });
}

test("undocumented-field detection sees nested, array, and union fields", () => {
  const schema = {
    oneOf: [
      { type: "object", properties: { rows: { type: "array", items: { type: "object", properties: { name: {} } } } } },
      { type: "string" }
    ]
  };
  assert.deepEqual(undocumentedKeys({ rows: [{ name: "a" }] }, [schema]), []);
  assert.deepEqual(undocumentedKeys({ rows: [{ name: "a", extra: 1 }], top: true }, [schema]), ["$.rows[0].extra", "$.top"]);
  assert.deepEqual(undocumentedKeys("not found", [schema]), []);
  const map = { type: "object", properties: { status: {} }, additionalProperties: { type: "string" } };
  assert.deepEqual(undocumentedKeys({ status: "ok", category: "x" }, [map]), []);
  assert.deepEqual(undocumentedKeys({ extra: 1 }, [{ type: "object", properties: {}, additionalProperties: true }]), ["$.extra"]);
});

function shapePaths(value, path = "$", out = new Map()) {
  if (Array.isArray(value)) {
    out.set(path, "array");
    for (const child of value) shapePaths(child, `${path}[]`, out);
  } else if (value && typeof value === "object") {
    out.set(path, "object");
    for (const [key, child] of Object.entries(value)) shapePaths(child, `${path}.${key}`, out);
  } else {
    out.set(path, value === null ? "null" : typeof value);
  }
  return out;
}

// The examples shown in the reference must show every field and value type
// seen in a live response, so readers see the shape they will receive.
for (const sample of samples.filter((entry) => entry.source === "live")) {
  test(`${sample.name}: a published example shows every field of the live response`, () => {
    const entry = operations().find(({ key }) => key === sample.operation);
    const examples = Object.values(entry.operation.responses[String(sample.status)].content["application/json"].examples ?? {});
    const live = shapePaths(sample.body);
    const gaps = examples.map((example) => {
      const shown = shapePaths(example.value);
      return [...live].filter(([path, type]) => !shown.has(path)
        || (shown.get(path) !== type && type !== "null" && shown.get(path) !== "null"))
        .map(([path, type]) => `${path} (${type})`);
    });
    const closest = gaps.reduce((best, gap) => (gap.length < best.length ? gap : best));
    assert.deepEqual(closest, [], "extend the example so it reflects the live response");
  });
}
