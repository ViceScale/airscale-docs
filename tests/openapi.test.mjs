import assert from "node:assert/strict";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import SwaggerParser from "@apidevtools/swagger-parser";
import { baseSpec } from "../openapi/base.mjs";
import { accountOperations } from "../openapi/operations/account.mjs";
import { contactDataOperations } from "../openapi/operations/contact-data.mjs";
import { profileLookupOperations } from "../openapi/operations/profile-lookup.mjs";
import { searchDiscoveryOperations } from "../openapi/operations/search-discovery.mjs";
import { buildSpec } from "../scripts/build-openapi.mjs";
import { outputMatchesSerialized } from "../scripts/build-openapi.mjs";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runCli, writeOpenApiAtomic } from "../scripts/build-openapi.mjs";

const SOURCE_SHA = "8606866a5fb1f9405a94d49cfa9fbddaf4aaf431";
const ACCOUNT_CONTACT_PATHS = new Set([
  "/v1/credits",
  "/v1/email",
  "/v1/email-bulk",
  "/v1/phone",
  "/v1/personal-email",
  "/v1/url-search-people"
]);
const PROFILE_LOOKUP_PATHS = new Set([
  "/v1/profile",
  "/v1/company",
  "/v1/reverse-email",
  "/v1/reverse-phone"
]);

function operation(method, path, operationId) {
  return {
    method,
    path,
    operation: { operationId, responses: { 200: { description: "OK" } } }
  };
}

function catalog(...operations) {
  return { operations };
}

function accountContactSpec() {
  const approvedCatalog = JSON.parse(readFileSync("contracts/public-api-operations.json", "utf8"));
  const partialCatalog = {
    operations: approvedCatalog.operations.filter(({ path }) => ACCOUNT_CONTACT_PATHS.has(path))
  };
  assert.equal(partialCatalog.operations.length, 6);
  return buildSpec({ catalog: partialCatalog, operationModules: [accountOperations, contactDataOperations] });
}

function profileLookupSpec() {
  const approvedCatalog = JSON.parse(readFileSync("contracts/public-api-operations.json", "utf8"));
  const partialCatalog = {
    operations: approvedCatalog.operations.filter(({ path }) => PROFILE_LOOKUP_PATHS.has(path))
  };
  assert.equal(partialCatalog.operations.length, 4);
  return buildSpec({ catalog: partialCatalog, operationModules: [profileLookupOperations] });
}

function moduleOperation(method, path) {
  return searchDiscoveryOperations.find((entry) => entry.method === method && entry.path === path)?.operation;
}

function operationFromSpec(spec, method, path) {
  return spec.paths[path]?.[method.toLowerCase()];
}

function committedSpec() {
  return JSON.parse(readFileSync("openapi.json", "utf8"));
}

function requestSchema(operation) {
  return operation.requestBody?.content?.["application/json"]?.schema;
}

function schemaValidator(schema) {
  const ajv = new Ajv2020({ strict: false, validateFormats: false });
  return ajv.compile({
    ...structuredClone(schema),
    components: { schemas: structuredClone(baseSpec.components.schemas) }
  });
}

function requestValidator(schema) {
  return schemaValidator(schema);
}

function errorStatuses(operation) {
  return Object.keys(operation.responses).filter((status) => !["200", "202"].includes(status));
}

function assertUnauthorizedReference(operation) {
  assert.deepEqual(operation.responses["401"], { $ref: "#/components/responses/Unauthorized" });
}

function assertPublicOperationMetadata(operation) {
  assert.ok(operation.summary.length > 0);
  assert.ok(operation.description.length > 0);
}

function assertJsonErrors(operation, statuses) {
  for (const status of statuses.filter((value) => value !== "401")) {
    assert.equal(typeof operation.responses[status].description, "string");
    assert.ok(operation.responses[status].description.length > 0);
    assert.deepEqual(operation.responses[status].content["application/json"].schema, {
      $ref: "#/components/schemas/Error"
    });
  }
}

function assertExamplePrivacy(exampleValues) {
  const serialized = JSON.stringify(exampleValues);
  for (const [label, pattern] of [
    ["real provider identity", /\b(?:Prospeo|Icypeas|RapidAPI|Leadmagic|SalesQL|Limadata|ContactOut|Wiza|Forager|Bounceban|Findymail|Trykitt|Kitt|A-?Leads)\b/i],
    ["internal identity", /\b(?:HistoricalImport|EmailLogCache|Supabase|Bubble|Durable Object)\b/i],
    ["bearer credential", /\bBearer\s+[A-Za-z0-9._~-]+/i],
    ["named credential", /"(?:api[_-]?key|authorization|secret|password|token)"\s*:\s*"[^"\s]+"/i]
  ]) {
    assert.doesNotMatch(serialized, pattern, label);
  }

  const privateIdentityFields = new Set(["provider", "verifier", "provider_internal"]);
  function inspect(value) {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (privateIdentityFields.has(key) && child !== null) {
        assert.fail(`non-null ${key} example field`);
      }
      inspect(child);
    }
  }
  for (const example of exampleValues) inspect(example);
}

function collectExampleValues(value, examples = [], parentKey = "") {
  if (!value || typeof value !== "object") return examples;
  for (const [key, child] of Object.entries(value)) {
    if (key === "example") examples.push(child);
    if (parentKey === "examples" && child && typeof child === "object" && Object.hasOwn(child, "value")) {
      examples.push(child.value);
    }
    collectExampleValues(child, examples, key);
  }
  return examples;
}

function assertNoExecutableExamples(exampleValues) {
  const serialized = JSON.stringify(exampleValues);
  for (const pattern of [
    /\bcurl\b/i,
    /\bfetch\s*\(/i,
    /\baxios\b/i,
    /\b(?:require|import)\s*\(/i,
    /Authorization\s*:/i
  ]) {
    assert.doesNotMatch(serialized, pattern);
  }
}

function assertContentExamplesValidate(content, label, examples) {
  const validate = schemaValidator(content.schema);
  for (const [name, example] of Object.entries(content.examples ?? {})) {
    examples.push(example.value);
    assert.equal(validate(example.value), true, `${label} ${name}: ${JSON.stringify(validate.errors)}`);
  }
}

function inTemporaryDirectory(run) {
  const directory = mkdtempSync(join(tmpdir(), "openapi-builder-"));
  try {
    run(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function fixtureSpec() {
  return {
    openapi: "3.1.0",
    info: { title: "Fixture", version: "1" },
    paths: {}
  };
}

function serializedFixtureSpec() {
  return JSON.stringify(fixtureSpec(), null, 2) + "\n";
}

function assertNoTemporaryFiles(directory) {
  assert.deepEqual(readdirSync(directory).filter((name) => name.endsWith(".tmp")), []);
}

function snapshotFile(filePath) {
  return existsSync(filePath) ? { exists: true, contents: readFileSync(filePath) } : { exists: false };
}

function assertAtomicFailure({ failure, initialContents }) {
  inTemporaryDirectory((directory) => {
    const targetPath = join(directory, "openapi.json");
    if (initialContents !== undefined) writeFileSync(targetPath, initialContents);
    const beforeExists = initialContents !== undefined;
    const before = beforeExists ? readFileSync(targetPath) : undefined;
    const temporaryPath = join(directory, "openapi.json.atomic.tmp");
    const fsImpl = failure === "write"
      ? { writeFileSync() { throw new Error("write failed"); } }
      : { renameSync() { throw new Error("rename failed"); } };

    assert.throws(
      () => writeOpenApiAtomic("new artifact\n", { outputPath: targetPath, temporaryPath, fsImpl }),
      new RegExp(`${failure} failed`)
    );
    assert.equal(Boolean(beforeExists), Boolean(readdirSync(directory).includes("openapi.json")));
    if (beforeExists) assert.deepEqual(readFileSync(targetPath), before);
    assertNoTemporaryFiles(directory);
  });
}

test("base spec identifies the Airscale public API", () => {
  assert.equal(baseSpec.openapi, "3.1.0");
  assert.equal(baseSpec.info.title, "Airscale Public API");
  assert.equal(baseSpec.info.version, "2026-08-30");
  assert.equal(baseSpec.info.description, "Search, enrich, and resolve public business data with Airscale.");
  assert.equal(baseSpec.info["x-airscale-source-repository"], "ViceScale/airscale-code");
  assert.equal(baseSpec.info["x-airscale-source-sha"], SOURCE_SHA);
  assert.deepEqual(baseSpec.servers, [
    { url: "https://api.airscale.io", description: "Production" }
  ]);
  assert.deepEqual(baseSpec.security, [{ bearerAuth: [] }]);
  assert.deepEqual(baseSpec.tags, [
    { name: "Search and discovery", description: "Search people, companies, and the web." },
    { name: "Contact data", description: "Find professional and personal contact data." },
    { name: "Profiles and reverse lookup", description: "Extract profiles or resolve a person from known contact data." },
    { name: "Account", description: "Inspect workspace account state." }
  ]);
  assert.deepEqual(baseSpec.components.securitySchemes.bearerAuth, {
    type: "http",
    scheme: "bearer",
    bearerFormat: "API key",
    description: "Use an Airscale workspace API key. Never expose the key in client-side code."
  });
});

test("account and contact operations share permissive public schemas", () => {
  assert.deepEqual(baseSpec.components.schemas.Status, {
    type: "string",
    enum: ["success", "not_found", "timeout"]
  });
  assert.deepEqual(baseSpec.components.schemas.LinkedInPersonUrl, {
    type: "string",
    minLength: 1,
    description: "A recognized LinkedIn person-profile URL or identifier. Airscale normalizes supported profile inputs.",
    example: "https://www.linkedin.com/in/example-person-000000"
  });
  assert.deepEqual(baseSpec.components.schemas.SuccessEmail, {
    type: "object",
    required: ["status", "email"],
    additionalProperties: true,
    properties: {
      status: { type: "string", const: "success" },
      email: { type: "string", format: "email" },
      email_status: {
        type: "string",
        description: "The value is \"valid\" on a successful result."
      },
      provider: { type: "string" },
      verifier: { type: "string" },
      catch_all: { type: "string", enum: ["yes", "no"] },
      linkedin_profile_url: { $ref: "#/components/schemas/LinkedInPersonUrl" }
    }
  });
  assert.deepEqual(baseSpec.components.schemas.NotFoundEmail, {
    type: "object",
    required: ["status", "email"],
    additionalProperties: true,
    properties: {
      status: { type: "string", const: "not_found" },
      email: { type: "null" }
    }
  });
});

test("account and contact named examples reject provider identities and credentials", () => {
  const spec = accountContactSpec();
  const credits = spec.paths["/v1/credits"].post;
  const email = spec.paths["/v1/email"].post;
  const bulk = spec.paths["/v1/email-bulk"].post;
  const phone = spec.paths["/v1/phone"].post;
  const personal = spec.paths["/v1/personal-email"].post;
  const profileUrl = spec.paths["/v1/url-search-people"].post;
  const examples = [
    credits.responses["200"].content["application/json"].examples.success.value,
    email.requestBody.content["application/json"].examples.byProfile.value,
    email.requestBody.content["application/json"].examples.byName.value,
    email.responses["200"].content["application/json"].examples.success.value,
    email.responses["200"].content["application/json"].examples.notFound.value,
    bulk.requestBody.content["application/json"].examples.batch.value,
    bulk.responses["202"].content["application/json"].examples.accepted.value,
    phone.requestBody.content["application/json"].examples.profile.value,
    phone.responses["200"].content["application/json"].examples.success.value,
    phone.responses["200"].content["application/json"].examples.notFound.value,
    personal.requestBody.content["application/json"].examples.profile.value,
    personal.responses["200"].content["application/json"].examples.success.value,
    personal.responses["200"].content["application/json"].examples.notFound.value,
    profileUrl.requestBody.content["application/json"].examples.person.value,
    profileUrl.responses["200"].content["application/json"].examples.success.value,
    profileUrl.responses["200"].content["application/json"].examples.notFound.value
  ];

  assert.doesNotThrow(() => assertExamplePrivacy(examples));
  assert.throws(() => assertExamplePrivacy([...examples, { provider: "Prospeo" }]), /real provider identity/);
  assert.throws(() => assertExamplePrivacy([...examples, { provider_internal: "HistoricalImport" }]), /internal identity/);
  assert.throws(() => assertExamplePrivacy([...examples, { authorization: "Bearer synthetic-token" }]), /bearer credential/);
  assert.throws(() => assertExamplePrivacy([...examples, { api_key: "sk-synthetic-credential" }]), /named credential/);
  assert.throws(() => assertExamplePrivacy([...examples, { nested: { provider: "SalesQL_cached" } }]), /non-null provider/);
  assert.throws(() => assertExamplePrivacy([...examples, { nested: { verifier: "synthetic-verifier" } }]), /non-null verifier/);
  assert.throws(() => assertExamplePrivacy([...examples, { nested: { provider_internal: "InternalOnly" } }]), /non-null provider_internal/);
});

test("Account Credits operation models the stable balance contract", () => {
  const operation = accountContactSpec().paths["/v1/credits"]?.post;

  assert.ok(operation);
  assert.equal(operation.operationId, "getCredits");
  assert.deepEqual(operation.tags, ["Account"]);
  assert.equal(operation["x-airscale-rate-limit"], "No endpoint-specific rate limit is documented.");
  assert.equal(operation["x-airscale-credit-cost"], "No charge; checking the balance does not debit Airscale credits.");
  assert.equal(operation.requestBody, undefined);
  assertPublicOperationMetadata(operation);
  assert.deepEqual(operation.responses["200"].content["application/json"].schema, {
    type: "object",
    required: ["status", "response"],
    additionalProperties: false,
    properties: {
      status: { type: "string", const: "success" },
      response: {
        type: "object",
        required: ["credits"],
        additionalProperties: false,
        properties: { credits: { type: "number" } }
      }
    }
  });
  assert.deepEqual(operation.responses["200"].content["application/json"].examples.success.value, {
    status: "success",
    response: { credits: 1200 }
  });
  assert.deepEqual(errorStatuses(operation), ["401", "500", "503"]);
  assertUnauthorizedReference(operation);
  assertJsonErrors(operation, errorStatuses(operation));
});

test("Contact Email operation accepts profile or complete name identification", () => {
  const operation = accountContactSpec().paths["/v1/email"]?.post;
  const schema = requestSchema(operation);

  assert.ok(operation);
  assert.equal(operation.operationId, "findProfessionalEmail");
  assert.deepEqual(operation.tags, ["Contact data"]);
  assert.equal(operation["x-airscale-rate-limit"], "3,000 requests per minute per workspace.");
  assert.equal(operation["x-airscale-credit-cost"], "2 credits only when the response has status success; not_found is not charged.");
  assertPublicOperationMetadata(operation);
  assert.match(operation.description, /256 KiB/);
  assert.equal(operation.requestBody.required, true);
  assert.equal(schema.type, "object");
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.anyOf, [
    { required: ["linkedin_profile_url"] },
    {
      required: ["first_name", "last_name"],
      anyOf: [{ required: ["domain"] }, { required: ["company_name"] }]
    }
  ]);
  assert.deepEqual(schema.properties.linkedin_profile_url, { $ref: "#/components/schemas/LinkedInPersonUrl" });
  for (const property of ["first_name", "last_name", "domain", "company_name"]) {
    assert.deepEqual(schema.properties[property], { type: "string", minLength: 1 });
  }
  assert.deepEqual(operation.requestBody.content["application/json"].examples.byProfile.value, {
    linkedin_profile_url: "https://www.linkedin.com/in/example-person-000000"
  });
  assert.deepEqual(operation.requestBody.content["application/json"].examples.byName.value, {
    first_name: "Example",
    last_name: "Person",
    domain: "example.test"
  });
  assert.deepEqual(operation.responses["200"].content["application/json"].schema.oneOf, [
    { $ref: "#/components/schemas/SuccessEmail" },
    { $ref: "#/components/schemas/NotFoundEmail" }
  ]);
  assert.deepEqual(operation.responses["200"].content["application/json"].examples.success.value, {
    status: "success",
    email: "example.person@example.test"
  });
  assert.deepEqual(operation.responses["200"].content["application/json"].examples.notFound.value, {
    status: "not_found",
    email: null
  });
  assert.deepEqual(errorStatuses(operation), ["400", "401", "403", "413", "429", "500", "502", "503"]);
  assertUnauthorizedReference(operation);
  assertJsonErrors(operation, errorStatuses(operation));
});

test("Contact Email Bulk operation accepts bounded batches and returns only 202", () => {
  const operation = accountContactSpec().paths["/v1/email-bulk"]?.post;
  const schema = requestSchema(operation);
  const itemSchema = schema.properties.inputs.items;

  assert.ok(operation);
  assert.equal(operation.operationId, "findProfessionalEmailsBulk");
  assert.deepEqual(operation.tags, ["Contact data"]);
  assert.equal(operation["x-airscale-rate-limit"], "3,000 input items per minute per workspace.");
  assert.equal(operation["x-airscale-credit-cost"], "2 credits per item with status success; misses and timeouts are not charged.");
  assertPublicOperationMetadata(operation);
  assert.equal(operation.requestBody.required, true);
  assert.deepEqual(schema.required, ["webhook_url", "inputs"]);
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.properties.webhook_url, { type: "string", minLength: 1, pattern: "^http" });
  assert.equal(schema.properties.inputs.minItems, 1);
  assert.equal(schema.properties.inputs.maxItems, 100);
  assert.equal(itemSchema.additionalProperties, false);
  assert.deepEqual(itemSchema.properties.custom_id, {
    description: "If omitted or null, the item's zero-based array index is used; any other JSON value is echoed unchanged."
  });
  assert.equal(itemSchema.required, undefined);
  assert.deepEqual(itemSchema.anyOf, [
    { required: ["linkedin_profile_url"] },
    {
      required: ["first_name", "last_name"],
      anyOf: [{ required: ["domain"] }, { required: ["company_name"] }]
    }
  ]);
  for (const property of ["first_name", "last_name", "domain", "company_name"]) {
    assert.equal(itemSchema.properties[property].minLength, 1);
  }
  assert.deepEqual(operation.requestBody.content["application/json"].examples.batch.value, {
    webhook_url: "https://webhook.example.test/email-results",
    inputs: [
      { custom_id: "contact-001", linkedin_profile_url: "https://www.linkedin.com/in/example-person-000000" },
      { custom_id: 2002, first_name: "Sample", last_name: "Contact", company_name: "Example Company" }
    ]
  });
  assert.equal(operation.responses["200"], undefined);
  assert.deepEqual(operation.responses["202"].content["application/json"].schema, {
    type: "object",
    required: ["status", "count"],
    additionalProperties: false,
    properties: {
      status: { type: "string", const: "accepted" },
      count: { type: "integer", minimum: 1, maximum: 100 }
    }
  });
  assert.deepEqual(operation.responses["202"].content["application/json"].examples.accepted.value, {
    status: "accepted",
    count: 2
  });
  assert.deepEqual(errorStatuses(operation), ["400", "401", "403", "413", "429", "500", "502"]);
  assertUnauthorizedReference(operation);
  assertJsonErrors(operation, errorStatuses(operation));
});

test("Contact Email Bulk custom IDs accept every JSON value and omission", () => {
  const operation = accountContactSpec().paths["/v1/email-bulk"].post;
  const validate = requestValidator(requestSchema(operation));
  const identity = { linkedin_profile_url: "https://www.linkedin.com/in/example-person-000000" };

  for (const customId of [null, "", "contact-001", 2002, true, [], { source: "synthetic" }]) {
    const input = { ...identity, custom_id: customId };
    assert.equal(validate({ webhook_url: "https://webhook.example.test/results", inputs: [input] }), true, JSON.stringify(customId));
  }
  assert.equal(validate({ webhook_url: "https://webhook.example.test/results", inputs: [identity] }), true, "omitted custom_id");
});

test("Contact Mobile operation requires a profile and models success and miss envelopes", () => {
  const operation = accountContactSpec().paths["/v1/phone"]?.post;
  const schema = requestSchema(operation);
  const successContent = operation.responses["200"].content["application/json"];

  assert.ok(operation);
  assert.equal(operation.operationId, "findMobilePhone");
  assert.deepEqual(operation.tags, ["Contact data"]);
  assert.equal(operation["x-airscale-rate-limit"], "3,000 requests per minute per workspace.");
  assert.equal(operation["x-airscale-credit-cost"], "40 credits only when the response has status success; not_found is not charged.");
  assertPublicOperationMetadata(operation);
  assert.equal(operation.requestBody.required, true);
  assert.deepEqual(schema.required, ["linkedin_profile_url"]);
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.properties.linkedin_profile_url, { $ref: "#/components/schemas/LinkedInPersonUrl" });
  assert.deepEqual(operation.requestBody.content["application/json"].examples.profile.value, {
    linkedin_profile_url: "https://www.linkedin.com/in/example-person-000000"
  });
  assert.equal(successContent.schema.oneOf.length, 2);
  assert.deepEqual(successContent.schema.oneOf.map(({ required }) => required), [
    ["status", "linkedin_profile_url", "phone_numbers", "provider"],
    ["status", "linkedin_profile_url", "phone_numbers", "provider"]
  ]);
  assert.equal(Object.hasOwn(successContent.examples.success.value, "provider"), true);
  assert.deepEqual(successContent.examples.success.value, {
    status: "success",
    linkedin_profile_url: "https://www.linkedin.com/in/example-person-000000",
    phone_numbers: "+12025550123",
    provider: null
  });
  assert.deepEqual(successContent.examples.notFound.value, {
    status: "not_found",
    linkedin_profile_url: "https://www.linkedin.com/in/example-person-000000",
    phone_numbers: null,
    provider: null
  });
  assert.deepEqual(errorStatuses(operation), ["400", "401", "403", "413", "429", "500", "502", "503"]);
  assertUnauthorizedReference(operation);
  assertJsonErrors(operation, errorStatuses(operation));
});

test("Contact Personal Email operation accepts boolean or string verification", () => {
  const operation = accountContactSpec().paths["/v1/personal-email"]?.post;
  const schema = requestSchema(operation);
  const successContent = operation.responses["200"].content["application/json"];

  assert.ok(operation);
  assert.equal(operation.operationId, "findPersonalEmail");
  assert.deepEqual(operation.tags, ["Contact data"]);
  assert.equal(operation["x-airscale-rate-limit"], "2,000 requests per minute per workspace.");
  assert.equal(operation["x-airscale-credit-cost"], "3–12 credits for a successful result; not_found is not charged.");
  assertPublicOperationMetadata(operation);
  assert.equal(operation.requestBody.required, true);
  assert.deepEqual(schema.required, ["linkedin_profile_url"]);
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.properties.linkedin_profile_url, {
    description: "A LinkedIn person-profile input accepted and canonicalized after trimming whitespace. Valid URL user info, numeric ports, queries, and fragments are accepted but omitted from the canonical profile URL.",
    allOf: [
      { $ref: "#/components/schemas/LinkedInPersonUrl" },
      {
        pattern: "^\\s*(?:[Hh][Tt][Tt][Pp][Ss]?:\\/\\/)?(?:[^\\s\\/@:]+(?::[^\\s\\/@]*)?@)?(?:[Ww]{3}\\.)?[Ll][Ii][Nn][Kk][Ee][Dd][Ii][Nn]\\.[Cc][Oo][Mm](?::(?:0*[0-9]{1,4}|0*(?:[1-5][0-9]{4}|6[0-4][0-9]{3}|65[0-4][0-9]{2}|655[0-2][0-9]|6553[0-5])))?\\/in\\/(?:[A-Za-z0-9_-]|%[0-9A-Fa-f]{2})+\\/?(?:\\?[^\\s#]*)?(?:#[^\\s]*)?\\s*$"
      }
    ]
  });
  assert.deepEqual(schema.properties.verification, {
    description: "Verification is enabled only for boolean true or the case-insensitive string \"yes\"; all other values leave verification disabled.",
    oneOf: [{ type: "boolean" }, { type: "string" }]
  });
  assert.equal(
    operation.requestBody.description,
    "Provide the recognized person profile. Verification is enabled only for boolean true or the case-insensitive string \"yes\"; all other values leave verification disabled."
  );
  assert.deepEqual(operation.requestBody.content["application/json"].examples.profile.value, {
    linkedin_profile_url: "https://www.linkedin.com/in/example-person-000000",
    verification: true
  });
  assert.deepEqual(successContent.schema.oneOf, [
    {
      type: "object",
      required: ["status", "email"],
      additionalProperties: true,
      properties: {
        status: { type: "string", const: "success" },
        email: { type: "string", format: "email" }
      }
    },
    { $ref: "#/components/schemas/NotFoundEmail" }
  ]);
  for (const property of ["email_status", "provider", "verifier", "catch_all", "linkedin_profile_url"]) {
    assert.equal(successContent.schema.oneOf[0].properties[property], undefined);
  }
  assert.deepEqual(successContent.examples.success.value, {
    status: "success",
    email: "personal.example@example.test"
  });
  assert.deepEqual(successContent.examples.notFound.value, { status: "not_found", email: null });
  assert.deepEqual(errorStatuses(operation), ["400", "401", "403", "413", "429", "500", "502", "503"]);
  assertUnauthorizedReference(operation);
  assertJsonErrors(operation, errorStatuses(operation));
});

test("Contact Personal Email profile URLs match runtime normalization semantics", () => {
  const operation = accountContactSpec().paths["/v1/personal-email"].post;
  const validate = requestValidator(requestSchema(operation));

  for (const linkedin_profile_url of [
    "https://www.linkedin.com/in/example-person",
    "http://linkedin.com/in/example_person-2/",
    "linkedin.com/in/example%2Dperson",
    "  HtTpS://WWW.LINKEDIN.COM/in/example-person/  ",
    "https://www.linkedin.com/in/example-person?source=test",
    "https://www.linkedin.com/in/example-person#section",
    "https://linkedin.com:443/in/example-person",
    "https://user:pass@linkedin.com/in/example-person"
  ]) {
    assert.equal(validate({ linkedin_profile_url }), true, linkedin_profile_url);
  }

  for (const linkedin_profile_url of [
    "https://www.linkedin.com/company/example",
    "https://example.com/in/example-person",
    "not-a-profile",
    "https://www.linkedin.com/IN/example-person",
    "https://www.linkedin.com/in/example/person",
    "https://linkedin.com:abc/in/example-person",
    "https://linkedin.com:65536/in/example-person"
  ]) {
    assert.equal(validate({ linkedin_profile_url }), false, linkedin_profile_url);
  }
});

test("Contact Profile URL operation requires complete person and company names", () => {
  const operation = accountContactSpec().paths["/v1/url-search-people"]?.post;
  const schema = requestSchema(operation);
  const successContent = operation.responses["200"].content["application/json"];

  assert.ok(operation);
  assert.equal(operation.operationId, "findPeopleProfileUrl");
  assert.deepEqual(operation.tags, ["Contact data"]);
  assert.equal(operation["x-airscale-rate-limit"], "6 requests per second per workspace.");
  assert.equal(operation["x-airscale-credit-cost"], "0.5 credits only when the response has status success; not_found is not charged.");
  assertPublicOperationMetadata(operation);
  assert.equal(operation.requestBody.required, true);
  assert.deepEqual(schema.required, ["first_name", "last_name", "company_name"]);
  assert.equal(schema.additionalProperties, false);
  for (const property of schema.required) {
    assert.deepEqual(schema.properties[property], { type: "string", minLength: 1 });
  }
  assert.deepEqual(operation.requestBody.content["application/json"].examples.person.value, {
    first_name: "Example",
    last_name: "Person",
    company_name: "Example Company"
  });
  assert.deepEqual(successContent.schema.oneOf.map(({ required }) => required), [
    ["status", "url"],
    ["status"]
  ]);
  assert.deepEqual(successContent.examples.success.value, {
    status: "success",
    url: "https://www.linkedin.com/in/example-person-000000"
  });
  assert.deepEqual(successContent.examples.notFound.value, { status: "not_found" });
  assert.deepEqual(errorStatuses(operation), ["400", "401", "403", "413", "429", "500", "502", "503"]);
  assertUnauthorizedReference(operation);
  assertJsonErrors(operation, errorStatuses(operation));
});

test("profile and reverse lookup shared schemas preserve variable public payloads", () => {
  const schemas = baseSpec.components.schemas;

  assert.equal(schemas.VariablePersonProfile.type, "object");
  assert.equal(schemas.VariablePersonProfile.additionalProperties, true);
  assert.equal(schemas.VariablePersonProfile.required, undefined);
  assert.deepEqual(schemas.VariablePersonProfile.properties.url, { type: ["string", "null"] });
  assert.deepEqual(schemas.VariablePersonProfile.properties.identifier, { type: ["string", "null"] });
  for (const property of ["profile", "link", "firstname", "lastname", "headline", "industry", "location"]) {
    assert.equal(typeof schemas.VariablePersonProfile.properties[property].description, "string", property);
    assert.equal(schemas.VariablePersonProfile.properties[property].type, undefined, property);
  }

  assert.equal(schemas.VariableCompanyProfile.type, "object");
  assert.equal(schemas.VariableCompanyProfile.additionalProperties, true);
  assert.equal(schemas.VariableCompanyProfile.required, undefined);
  for (const property of ["url", "name", "universalName", "website"]) {
    assert.deepEqual(schemas.VariableCompanyProfile.properties[property], { type: ["string", "null"] });
  }
  for (const property of ["staff", "locations"]) {
    assert.deepEqual(schemas.VariableCompanyProfile.properties[property], {
      type: ["object", "null"],
      additionalProperties: true
    });
  }
  for (const property of ["industries", "specialities"]) {
    assert.deepEqual(schemas.VariableCompanyProfile.properties[property], {
      type: ["array", "null"],
      items: {}
    });
  }

  assert.deepEqual(schemas.NotFoundStatus, {
    type: "object",
    required: ["status"],
    additionalProperties: false,
    properties: { status: { type: "string", const: "not_found" } }
  });
});

test("profile routes share URL-selected response semantics while keeping page-specific examples", () => {
  const spec = profileLookupSpec();
  const expected = [
    {
      path: "/v1/profile",
      operationId: "extractPersonProfile",
      request: {
        linkedin_profile_url: "linkedin.com/in/example-person-000000?source=synthetic",
        mode: "p3"
      },
      response: {
        url: "https://www.linkedin.com/in/example-person-000000",
        identifier: "example-person-000000",
        firstname: "Example",
        lastname: "Person",
        headline: "Example role at Example Company",
        industry: "Software Development",
        location: { country: "United States", city: "Example City", state: "Example State" }
      }
    },
    {
      path: "/v1/company",
      operationId: "extractCompanyProfile",
      request: {
        linkedin_profile_url: "https://www.linkedin.com/company/example-company-000000/about/",
        mode: "p3"
      },
      response: {
        url: "https://www.linkedin.com/company/example-company-000000",
        name: "Example Company",
        universalName: "example-company-000000",
        website: "https://www.example.test",
        description: "Synthetic company profile for API documentation.",
        staff: { total: 120, range: "51-200" },
        locations: {
          headquarter: { country: "United States", city: "Example City" },
          other: []
        },
        industries: ["Software Development"],
        specialities: ["Synthetic data"]
      }
    }
  ];

  for (const fixture of expected) {
    const operation = spec.paths[fixture.path]?.post;
    const schema = requestSchema(operation);
    const responseContent = operation.responses["200"].content["application/json"];

    assert.ok(operation);
    assert.equal(operation.operationId, fixture.operationId);
    assert.deepEqual(operation.tags, ["Profiles and reverse lookup"]);
    assert.equal(operation["x-airscale-rate-limit"], "3,000 requests per minute per workspace.");
    assert.equal(
      operation["x-airscale-credit-cost"],
      "URL-selected: /in/ successes cost 1 credit by default (workspace-specific pricing may differ); /company/ or /school/ successes cost 0.5 credits; unsuccessful requests are not charged."
    );
    assertPublicOperationMetadata(operation);
    assert.match(operation.description, /submitted URL/i);
    assert.match(operation.requestBody.description, /trimmed/i);
    assert.match(operation.requestBody.description, /missing scheme/i);
    assert.match(operation.requestBody.description, /linkedin\.com or a subdomain/i);
    assert.match(operation.requestBody.description, /\/in\//);
    assert.match(operation.requestBody.description, /\/company\//);
    assert.match(operation.requestBody.description, /\/school\//);
    assert.match(operation.requestBody.description, /query and extra path/i);
    assert.equal(operation.requestBody.required, true);
    assert.deepEqual(schema.required, ["linkedin_profile_url"]);
    assert.equal(schema.additionalProperties, false);
    assert.deepEqual(schema.properties.linkedin_profile_url, { type: "string", minLength: 1 });
    assert.deepEqual(schema.properties.mode, { type: "string", enum: ["p1", "p2", "p3"] });
    assert.equal(schema.properties.linkedin_profile_url.pattern, undefined);
    assert.equal(schema.properties.linkedin_profile_url.format, undefined);
    assert.deepEqual(operation.requestBody.content["application/json"].examples.profile.value, fixture.request);
    assert.deepEqual(responseContent.schema, {
      anyOf: [
        { $ref: "#/components/schemas/VariablePersonProfile" },
        { $ref: "#/components/schemas/VariableCompanyProfile" }
      ]
    });
    assert.deepEqual(responseContent.examples.success.value, fixture.response);
    assert.deepEqual(errorStatuses(operation), ["400", "401", "403", "404", "413", "429", "500", "502", "503"]);
    assertUnauthorizedReference(operation);
    assertJsonErrors(operation, errorStatuses(operation));

    const validateRequest = requestValidator(schema);
    assert.equal(validateRequest(fixture.request), true, JSON.stringify(validateRequest.errors));
    assert.equal(validateRequest({ linkedin_profile_url: "linkedin.com/school/example-school", mode: "p1" }), true);
    assert.equal(validateRequest({ linkedin_profile_url: "linkedin.com/in/example", mode: "default" }), false);
    assert.equal(validateRequest({ mode: "p3" }), false);
    assert.equal(validateRequest({ linkedin_profile_url: "" }), false);
  }
});

test("reverse email models source-compatible input and object-or-string results", () => {
  const operation = profileLookupSpec().paths["/v1/reverse-email"]?.post;
  const schema = requestSchema(operation);
  const responseContent = operation.responses["200"].content["application/json"];

  assert.ok(operation);
  assert.equal(operation.operationId, "reverseEmailLookup");
  assert.deepEqual(operation.tags, ["Profiles and reverse lookup"]);
  assert.equal(operation["x-airscale-rate-limit"], "25 requests per second per workspace.");
  assert.equal(operation["x-airscale-credit-cost"], "2 credits only when a profile is returned; \"not found\" and errors are not charged.");
  assertPublicOperationMetadata(operation);
  assert.match(operation.requestBody.description, /trimmed and lowercased/i);
  assert.equal(operation.requestBody.required, true);
  assert.deepEqual(schema.required, ["email"]);
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.email.type, "string");
  assert.equal(schema.properties.email.format, undefined);
  assert.deepEqual(responseContent.schema, {
    oneOf: [
      { $ref: "#/components/schemas/VariablePersonProfile" },
      { type: "string", enum: ["not found"] }
    ]
  });
  assert.deepEqual(operation.requestBody.content["application/json"].examples.email.value, {
    email: " Example.Person@Example.Test "
  });
  assert.deepEqual(responseContent.examples.success.value, {
    url: "https://www.linkedin.com/in/example-person-000000",
    identifier: "example-person-000000",
    firstname: "Example",
    lastname: "Person",
    headline: "Example role at Example Company"
  });
  assert.equal(responseContent.examples.notFound.value, "not found");
  assert.deepEqual(errorStatuses(operation), ["400", "401", "403", "413", "429", "500", "502", "503"]);
  assertUnauthorizedReference(operation);
  assertJsonErrors(operation, errorStatuses(operation));

  const validateResponse = schemaValidator(responseContent.schema);
  const passThroughResponse = {
    url: null,
    identifier: null,
    profile: null,
    link: null,
    location: "Example City"
  };
  assert.equal(validateResponse(passThroughResponse), true, JSON.stringify(validateResponse.errors));

  const validate = requestValidator(schema);
  for (const email of [
    "person@example.test",
    " Person@Example.Test ",
    "a+b@sub.example.test"
  ]) {
    assert.equal(validate({ email }), true, email);
  }
  for (const email of [
    "",
    "   ",
    "person.example.test",
    "@example.test",
    "person@",
    "person@example",
    "person @example.test",
    "person@ example.test"
  ]) {
    assert.equal(validate({ email }), false, email);
  }
});

test("reverse phone accepts non-E.164 inputs and models success or exact not_found", () => {
  const operation = profileLookupSpec().paths["/v1/reverse-phone"]?.post;
  const schema = requestSchema(operation);
  const responseContent = operation.responses["200"].content["application/json"];

  assert.ok(operation);
  assert.equal(operation.operationId, "reversePhoneLookup");
  assert.deepEqual(operation.tags, ["Profiles and reverse lookup"]);
  assert.equal(operation["x-airscale-rate-limit"], "2,000 requests per minute per workspace.");
  assert.equal(operation["x-airscale-credit-cost"], "10 credits only when a profile is returned; not_found and errors are not charged.");
  assertPublicOperationMetadata(operation);
  assert.match(operation.requestBody.description, /trim/);
  assert.match(operation.requestBody.description, /lowercase strings "null" and "undefined"/);
  assert.doesNotMatch(operation.requestBody.description, /E\.164/i);
  assert.equal(operation.requestBody.required, true);
  assert.deepEqual(schema.required, ["mobile_phone"]);
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.mobile_phone.type, "string");
  assert.equal(schema.properties.mobile_phone.format, undefined);
  assert.deepEqual(operation.requestBody.content["application/json"].examples.phone.value, {
    mobile_phone: "+12025550147"
  });
  assert.equal(responseContent.schema.oneOf.length, 2);
  assert.equal(responseContent.schema.oneOf[0].type, "object");
  assert.equal(responseContent.schema.oneOf[0].additionalProperties, true);
  assert.deepEqual(responseContent.schema.oneOf[0].required, ["body"]);
  assert.deepEqual(responseContent.schema.oneOf[0].properties.body, {
    type: "object",
    additionalProperties: true
  });
  for (const property of ["url", "identifier", "link", "firstname", "lastname"]) {
    assert.equal(typeof responseContent.schema.oneOf[0].properties[property].description, "string", property);
    assert.equal(responseContent.schema.oneOf[0].properties[property].type, undefined, property);
  }
  assert.deepEqual(responseContent.schema.oneOf[1], { $ref: "#/components/schemas/NotFoundStatus" });
  assert.deepEqual(responseContent.examples.success.value, {
    url: "https://www.linkedin.com/in/example-person-000000",
    identifier: "example-person-000000",
    firstname: "Example",
    lastname: "Person",
    link: { linkedin: "https://www.linkedin.com/in/example-person-000000" },
    body: {
      url: "https://www.linkedin.com/in/example-person-000000",
      identifier: "example-person-000000",
      firstname: "Example",
      lastname: "Person",
      link: { linkedin: "https://www.linkedin.com/in/example-person-000000" }
    }
  });
  assert.deepEqual(responseContent.examples.notFound.value, { status: "not_found" });
  assert.deepEqual(errorStatuses(operation), ["400", "401", "403", "413", "429", "500", "502", "503"]);
  assertUnauthorizedReference(operation);
  assertJsonErrors(operation, errorStatuses(operation));

  const validateResponse = schemaValidator(responseContent.schema);
  const passThroughResponse = {
    link: null,
    body: {
      id: 42001,
      arbitrary_provider_field: ["synthetic", { nested: true }]
    }
  };
  assert.equal(validateResponse(passThroughResponse), true, JSON.stringify(validateResponse.errors));

  const validate = requestValidator(schema);
  for (const mobile_phone of [
    "+12025550147",
    "020 7946 0958",
    "extension 42",
    " 555-0147 ",
    "NULL",
    "undefined-value"
  ]) {
    assert.equal(validate({ mobile_phone }), true, mobile_phone);
  }
  for (const mobile_phone of ["", " ", "\t\n", "null", " undefined "]) {
    assert.equal(validate({ mobile_phone }), false, JSON.stringify(mobile_phone));
  }
});

test("profile and reverse lookup examples are schema-valid, synthetic, and public", async () => {
  const spec = profileLookupSpec();
  const examples = [];

  for (const path of PROFILE_LOOKUP_PATHS) {
    const operation = spec.paths[path].post;
    const requestContent = operation.requestBody.content["application/json"];
    const responseContent = operation.responses["200"].content["application/json"];
    const validateRequest = schemaValidator(requestContent.schema);
    const validateResponse = schemaValidator(responseContent.schema);

    for (const example of Object.values(requestContent.examples)) {
      examples.push(example.value);
      assert.equal(validateRequest(example.value), true, `${path} request: ${JSON.stringify(validateRequest.errors)}`);
    }
    for (const example of Object.values(responseContent.examples)) {
      examples.push(example.value);
      assert.equal(validateResponse(example.value), true, `${path} response: ${JSON.stringify(validateResponse.errors)}`);
    }
  }

  assert.doesNotThrow(() => assertExamplePrivacy(examples));
  await assert.doesNotReject(() => SwaggerParser.validate(structuredClone(spec)));
});

test("search and discovery shared schemas preserve the public filter and result shapes", () => {
  const schemas = baseSpec.components.schemas;

  assert.deepEqual(schemas.IncludeExcludeFilter, {
    type: "object",
    additionalProperties: false,
    properties: {
      include: {
        type: "array",
        maxItems: 200,
        items: { type: "string", minLength: 1 }
      },
      exclude: {
        type: "array",
        maxItems: 200,
        items: { type: "string", minLength: 1 }
      }
    },
    anyOf: [{ required: ["include"] }, { required: ["exclude"] }]
  });
  assert.deepEqual(schemas.IntegerRangeFilter, {
    type: "object",
    minProperties: 1,
    additionalProperties: false,
    properties: {
      ">": { type: "integer" },
      ">=": { type: "integer" },
      "<": { type: "integer" },
      "<=": { type: "integer" }
    }
  });
  assert.equal(schemas.GrowthFilter.type, "object");
  assert.equal(schemas.GrowthFilter.additionalProperties, false);
  assert.match(schemas.GrowthFilter.description, /min must be less than or equal to max/i);
  assert.deepEqual(schemas.GrowthFilter.required, ["timespan"]);
  assert.deepEqual(schemas.GrowthFilter.anyOf, [{ required: ["min"] }, { required: ["max"] }]);
  assert.deepEqual(schemas.GrowthFilter.properties.timespan.enum, ["6months", "12months", "24months"]);
  for (const property of ["min", "max"]) {
    assert.deepEqual(schemas.GrowthFilter.properties[property], {
      type: "number",
      minimum: -100,
      maximum: 10000
    });
  }
  assert.equal(schemas.FlexibleResult.type, "object");
  assert.equal(schemas.FlexibleResult.additionalProperties, true);
  assert.equal(schemas.FlexibleResult.required, undefined);
  for (const property of ["provider", "verifier", "provider_internal"]) {
    assert.equal(schemas.FlexibleResult.properties[property], undefined);
  }
});

test("Find People models the complete public query and page contract", () => {
  const operation = moduleOperation("POST", "/v1/find-people");
  assert.ok(operation, "missing POST /v1/find-people");
  const schema = requestSchema(operation);
  const query = schema.properties.query;
  const includeExcludeFilters = [
    "firstname", "lastname", "jobTitle", "school", "languages", "skills", "location", "keyword",
    "currentCompanyName", "companyDomain", "companyLinkedinUrl", "currentCompany.type",
    "currentCompany.industry", "currentCompany.location", "currentCompany.keyword", "pastJobTitle",
    "pastCompanyName", "pastCompanyId", "pastCompanyWebsite", "pastCompanyUrn", "pastCompany.type",
    "pastCompany.industry", "pastCompany.location", "pastCompany.keyword"
  ];
  const integerRangeFilters = [
    "totalYearsOfExperience", "timeInCurrentCompany", "currentCompany.headcount", "currentCompany.revenue",
    "pastCompany.headcount", "pastCompany.revenue"
  ];
  const growthFilters = ["currentCompany.headcountGrowth", "pastCompany.headcountGrowth"];

  assert.equal(operation.operationId, "findPeople");
  assert.deepEqual(operation.tags, ["Search and discovery"]);
  assert.equal(operation["x-airscale-rate-limit"], "6 requests per second per workspace.");
  assert.equal(operation["x-airscale-credit-cost"], "0.1 credits per returned lead; no charge when no leads are returned.");
  assertPublicOperationMetadata(operation);
  assert.match(operation.description, /256 KiB/);
  assert.equal(operation.requestBody.required, true);
  assert.deepEqual(schema.required, ["query"]);
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.properties.size, { type: "integer", minimum: 1, maximum: 100, default: 100 });
  assert.equal(schema.properties.cursor.type, "string");
  assert.equal(schema.properties.cursor.minLength, 1);
  assert.match(schema.properties.cursor.description, /opaque/i);
  assert.equal(query.type, "object");
  assert.equal(query.minProperties, 1);
  assert.equal(query.additionalProperties, false);
  assert.deepEqual(Object.keys(query.properties), [...includeExcludeFilters, ...integerRangeFilters, ...growthFilters]);
  for (const property of includeExcludeFilters) {
    assert.deepEqual(query.properties[property], { $ref: "#/components/schemas/IncludeExcludeFilter" });
  }
  for (const property of integerRangeFilters) {
    assert.deepEqual(query.properties[property], { $ref: "#/components/schemas/IntegerRangeFilter" });
  }
  for (const property of growthFilters) {
    assert.deepEqual(query.properties[property], { $ref: "#/components/schemas/GrowthFilter" });
  }
  assert.deepEqual(operation.requestBody.content["application/json"].examples.audience.value, {
    query: {
      jobTitle: { include: ["Revenue Operations Manager"] },
      location: { include: ["Example Country"] }
    },
    size: 50
  });
  assert.deepEqual(operation.responses["200"].content["application/json"].schema, {
    type: "object",
    required: ["total", "leads", "next_cursor"],
    additionalProperties: false,
    properties: {
      total: { type: "number" },
      leads: { type: "array", items: { $ref: "#/components/schemas/FlexibleResult" } },
      next_cursor: { type: ["string", "null"] }
    }
  });
  assert.deepEqual(errorStatuses(operation), ["400", "401", "403", "404", "413", "429", "502", "503"]);
  assertUnauthorizedReference(operation);
  assertJsonErrors(operation, errorStatuses(operation));
});

test("Find People query filters and Search pagination enforce runtime boundaries", () => {
  const search = moduleOperation("POST", "/v1/find-people");
  assert.ok(search, "missing POST /v1/find-people");
  const validate = requestValidator(requestSchema(search));
  const values200 = Array.from({ length: 200 }, (_, index) => `Role ${index}`);
  const base = { query: { jobTitle: { include: ["Founder"] } } };

  assert.equal(validate({ query: { jobTitle: { include: values200 } }, size: 1 }), true);
  assert.equal(validate({ ...base, size: 100 }), true);
  assert.equal(validate({ ...base, size: 0 }), false);
  assert.equal(validate({ ...base, size: 101 }), false);
  assert.equal(validate({ query: { jobTitle: { include: [...values200, "One too many"] } } }), false);
  assert.equal(validate({ query: { jobTitle: {} } }), false);
  assert.equal(validate({ query: { jobTitle: { include: [] } } }), true, "source accepts a present empty include array");
  assert.equal(validate({ query: { jobTitle: { include: [""] } } }), false);
  assert.equal(validate({ query: { unsupported: { include: ["value"] } } }), false);
  assert.equal(validate({ query: { totalYearsOfExperience: { ">=": 5, "<": 20 } } }), true);
  assert.equal(validate({ query: { totalYearsOfExperience: { eq: 5 } } }), false);
  assert.equal(validate({ query: { totalYearsOfExperience: { ">=": 5.5 } } }), false);
  assert.equal(validate({ query: { "currentCompany.headcountGrowth": { min: 10, timespan: "6months" } } }), true);
  assert.equal(validate({ query: { "currentCompany.headcountGrowth": { max: 20, timespan: "12months" } } }), true);
  assert.equal(validate({ query: { "currentCompany.headcountGrowth": { timespan: "24months" } } }), false);
  assert.equal(validate({ query: { "currentCompany.headcountGrowth": { min: 10, timespan: "3months" } } }), false);
});

test("Count People reuses the exact query contract without Search pagination", () => {
  const search = moduleOperation("POST", "/v1/find-people");
  const count = moduleOperation("POST", "/v1/find-people/count");
  assert.ok(search, "missing POST /v1/find-people");
  assert.ok(count, "missing POST /v1/find-people/count");
  const searchSchema = requestSchema(search);
  const countSchema = requestSchema(count);

  assert.equal(count.operationId, "countPeople");
  assert.deepEqual(count.tags, ["Search and discovery"]);
  assert.equal(count["x-airscale-rate-limit"], "6 requests per second per workspace.");
  assert.equal(count["x-airscale-credit-cost"], "No charge; Count does not debit Airscale credits.");
  assertPublicOperationMetadata(count);
  assert.equal(count.requestBody.required, true);
  assert.deepEqual(countSchema.required, ["query"]);
  assert.equal(countSchema.additionalProperties, false);
  assert.deepEqual(Object.keys(countSchema.properties), ["query"]);
  assert.deepEqual(countSchema.properties.query, searchSchema.properties.query);
  assert.deepEqual(count.responses["200"].content["application/json"].schema, {
    type: "object",
    required: ["total"],
    additionalProperties: false,
    properties: { total: { type: "number" } }
  });
  assert.deepEqual(errorStatuses(count), ["400", "401", "403", "404", "413", "429", "502", "503"]);
  assertUnauthorizedReference(count);
  assertJsonErrors(count, errorStatuses(count));

  const validate = requestValidator(countSchema);
  assert.equal(validate({ query: { jobTitle: { include: ["Founder"] } } }), true);
  assert.equal(validate({ query: { jobTitle: { include: ["Founder"] } }, size: 25 }), false);
  assert.equal(validate({ query: { jobTitle: { include: ["Founder"] } }, cursor: "fp_example" }), false);
});

test("Find Companies models public filters, cursor precedence, and stable results", () => {
  const operation = moduleOperation("POST", "/v1/find-companies");
  assert.ok(operation, "missing POST /v1/find-companies");
  const schema = requestSchema(operation);
  const filters = schema.properties.filters;

  assert.equal(operation.operationId, "findCompanies");
  assert.deepEqual(operation.tags, ["Search and discovery"]);
  assert.equal(operation["x-airscale-rate-limit"], "6 requests per second per workspace.");
  assert.equal(operation["x-airscale-credit-cost"], "0.1 credits per returned company; no charge when no companies are returned.");
  assertPublicOperationMetadata(operation);
  assert.match(operation.description, /256 KiB/);
  assert.deepEqual(schema.required, ["filters"]);
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.properties.page, { type: "integer", minimum: 0, default: 0 });
  assert.deepEqual(schema.properties.size, { type: "integer", minimum: 1, maximum: 100, default: 50 });
  assert.equal(schema.properties.cursor.pattern, "^fc_");
  assert.match(schema.properties.cursor.description, /saved page size takes precedence/i);
  assert.equal(filters.type, "object");
  assert.equal(filters.minProperties, 1);
  assert.equal(filters.additionalProperties, false);
  assert.deepEqual(Object.keys(filters.properties), [
    "country", "region", "city", "industry", "size", "revenue", "age", "techStack", "keywords",
    "topics", "events", "locations", "companyName", "eventWindow", "locationMatch", "hasWebsite",
    "isPublicCompany"
  ]);
  assert.deepEqual(filters.properties.eventWindow, {
    type: "string",
    enum: ["30 days", "60 days", "90 days"],
    default: "30 days"
  });
  assert.deepEqual(filters.properties.locationMatch, {
    type: "string",
    enum: ["hqOnly", "hqOperating"],
    default: "hqOnly"
  });
  for (const property of ["hasWebsite", "isPublicCompany"]) {
    assert.deepEqual(filters.properties[property], { type: ["boolean", "null"] });
  }
  const requestExample = operation.requestBody.content["application/json"].examples.audience.value;
  assert.deepEqual(requestExample.filters.country, ["FR"]);
  const responseExample = operation.responses["200"].content["application/json"].examples.reservedData.value;
  assert.equal(responseExample.rows[0].domain, "example.test");
  assert.deepEqual(
    JSON.parse(Buffer.from(responseExample.next_cursor.slice(3), "base64url").toString("utf8")),
    { v: 1, mode: "page", page: 1, pageSize: 25, providerSize: 10000 }
  );
  assert.deepEqual(operation.responses["200"].content["application/json"].schema, {
    type: "object",
    required: ["rows", "total", "page", "size", "next_cursor"],
    additionalProperties: false,
    properties: {
      rows: { type: "array", items: { $ref: "#/components/schemas/FlexibleResult" } },
      total: { type: "number" },
      page: { type: "number" },
      size: { type: "number" },
      next_cursor: { type: ["string", "null"] }
    }
  });
  assert.deepEqual(errorStatuses(operation), ["400", "401", "403", "413", "429", "500", "502", "503"]);
  assertUnauthorizedReference(operation);
  assertJsonErrors(operation, errorStatuses(operation));
});

test("Find Companies pagination and fixed presets reject undocumented values", () => {
  const operation = moduleOperation("POST", "/v1/find-companies");
  assert.ok(operation, "missing POST /v1/find-companies");
  const validate = requestValidator(requestSchema(operation));
  const base = { filters: { country: "Example Country" } };
  const accepted = {
    size: ["1-10", "11-50", "51-200", "201-500", "501-1000", "1001-5000", "5001-10000", "10001+"],
    revenue: ["0-500K", "500K-1M", "1M-5M", "5M-10M", "10M-25M", "25M-75M", "75M-200M", "200M-500M", "500M-1B", "1B-10B", "10B-100B", "100B-1T", "1T-10T", "10T+"],
    age: ["0-3", "3-6", "6-10", "10-20", "20+"],
    locations: ["0-1", "2-5", "6-20", "21-50", "51-100", "101-1000", "1001+"]
  };

  assert.equal(validate({ ...base, page: 0, size: 1 }), true);
  assert.equal(validate({ ...base, size: 100, cursor: "fc_synthetic" }), true);
  assert.equal(validate({ ...base, page: -1 }), false);
  assert.equal(validate({ ...base, size: 0 }), false);
  assert.equal(validate({ ...base, size: 101 }), false);
  assert.equal(validate({ ...base, cursor: "not-a-company-cursor" }), false);
  assert.equal(validate({ filters: { eventWindow: "30 days" } }), false, "defaults alone are not a real filter");
  for (const [property, values] of Object.entries(accepted)) {
    assert.equal(validate({ filters: { [property]: values[0] } }), true, `${property} scalar`);
    assert.equal(validate({ filters: { [property]: values } }), true, `${property} array`);
    assert.equal(validate({ filters: { [property]: "invented-value" } }), false, `${property} fixed enum`);
  }
});

test("Company Filter-values models alias coercion and public option metadata", () => {
  const operation = moduleOperation("GET", "/v1/find-companies/filter-values");
  assert.ok(operation, "missing GET /v1/find-companies/filter-values");
  const parameters = Object.fromEntries(operation.parameters.map((parameter) => [parameter.name, parameter]));

  assert.equal(operation.operationId, "listFindCompanyFilterValues");
  assert.deepEqual(operation.tags, ["Search and discovery"]);
  assert.equal(operation["x-airscale-rate-limit"], "6 requests per second per workspace.");
  assert.equal(operation["x-airscale-credit-cost"], "No charge; Filter-values does not debit Airscale credits.");
  assertPublicOperationMetadata(operation);
  assert.equal(operation.requestBody, undefined);
  assert.deepEqual(Object.keys(parameters), ["filter", "q", "query", "limit", "country", "region"]);
  assert.equal(parameters.filter.in, "query");
  assert.equal(parameters.filter.required, true);
  assert.deepEqual(parameters.filter.schema.enum, ["city", "region", "industry", "topics", "techStack"]);
  for (const alias of ["q", "query"]) {
    assert.equal(parameters[alias].required, false);
    assert.equal(parameters[alias].schema.minLength, 2);
    assert.equal(parameters[alias].schema.maxLength, 120);
    assert.match(parameters[alias].description, /at least one of q or query is required/i);
  }
  assert.equal(parameters.limit.required, false);
  assert.match(parameters.limit.description, /non-numeric/i);
  assert.match(parameters.limit.description, /explicit empty/i);
  assert.match(parameters.limit.description, /clamps to 1/i);
  assert.match(parameters.limit.description, /clamp(?:s)? to 100/i);
  for (const context of ["country", "region"]) {
    assert.equal(parameters[context].required, false);
    assert.match(parameters[context].description, /repeat or comma-separated/i);
  }

  const validateLimit = schemaValidator(parameters.limit.schema);
  for (const value of [20, 0, 101, "", "not-a-number", "2.5", "25"]) {
    assert.equal(validateLimit(value), true, `runtime-coerced limit ${JSON.stringify(value)}`);
  }
  assert.equal(validateLimit(null), false);

  assert.deepEqual(operation.responses["200"].content["application/json"].schema, {
    type: "object",
    required: ["filter", "query", "values"],
    additionalProperties: false,
    properties: {
      filter: { type: "string", enum: ["city", "region", "industry", "topics", "techStack"] },
      query: { type: "string" },
      values: {
        type: "array",
        items: {
          type: "object",
          required: ["label", "value"],
          additionalProperties: false,
          properties: {
            label: { type: "string" },
            value: { type: "string" },
            query: { type: "string" },
            city: { type: "string" },
            region: { type: "string" },
            countryCode: { type: "string" },
            regionCode: { type: "string" }
          }
        }
      }
    }
  });
  assert.deepEqual(errorStatuses(operation), ["400", "401", "403", "413", "429", "500", "502", "503"]);
  assertUnauthorizedReference(operation);
  assertJsonErrors(operation, errorStatuses(operation));
});

test("Airsearch constrains public prompts and schema hints while preserving dynamic output keys", () => {
  const operation = moduleOperation("POST", "/v1/airsearch");
  assert.ok(operation, "missing POST /v1/airsearch");
  const schema = requestSchema(operation);
  const response = operation.responses["200"].content["application/json"].schema;

  assert.equal(operation.operationId, "airsearch");
  assert.deepEqual(operation.tags, ["Search and discovery"]);
  assert.equal(operation["x-airscale-rate-limit"], "300 requests per minute per workspace.");
  assert.equal(operation["x-airscale-credit-cost"], "1 credit only for status success; not_found and timeout are not charged.");
  assertPublicOperationMetadata(operation);
  assert.match(operation.description, /256 KiB/);
  assert.deepEqual(schema.required, ["prompt"]);
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.prompt.type, "string");
  assert.equal(schema.properties.prompt.minLength, 1);
  assert.ok(schema.properties.prompt.pattern);
  assert.equal(schema.properties.schema.type, "object");
  assert.deepEqual(schema.properties.schema.additionalProperties, {
    type: "string",
    minLength: 1,
    pattern: "\\S"
  });

  const validate = requestValidator(schema);
  assert.equal(validate({ prompt: "Find the synthetic company summary." }), true);
  assert.equal(validate({ prompt: "   " }), false);
  assert.equal(validate({ prompt: "Research a synthetic company.", schema: { website: "url", summary: "Short summary" } }), true);
  assert.equal(validate({ prompt: "Research a synthetic company.", schema: { website: "" } }), false);
  assert.equal(validate({ prompt: "Research a synthetic company.", schema: { website: "   " } }), false);
  assert.equal(validate({ prompt: "Research a synthetic company.", schema: { website: 42 } }), false);

  assert.deepEqual(response.required, [
    "status", "response", "reasoning", "sources", "confidence_score", "certainty_tag", "duration_ms"
  ]);
  assert.deepEqual(response.properties.status, { $ref: "#/components/schemas/Status" });
  assert.deepEqual(response.properties.response.oneOf, [
    { type: "string" },
    { type: "object", additionalProperties: true }
  ]);
  assert.deepEqual(response.properties.reasoning, { type: ["string", "null"] });
  assert.deepEqual(response.properties.sources, {
    type: "array",
    items: { type: "string", format: "uri" }
  });
  assert.deepEqual(response.properties.confidence_score, { type: "number", minimum: 0, maximum: 1 });
  assert.deepEqual(response.properties.certainty_tag, { type: "string", enum: ["low", "medium", "high"] });
  assert.deepEqual(response.properties.duration_ms, { type: "number", minimum: 0 });
  assert.deepEqual(response.additionalProperties, { type: ["string", "null"] });
  assert.deepEqual(errorStatuses(operation), ["400", "401", "403", "413", "429", "500", "502", "503", "504"]);
  assertUnauthorizedReference(operation);
  assertJsonErrors(operation, errorStatuses(operation));
});

test("all Search and discovery request and response examples are schema-valid and synthetic", () => {
  const examples = [];
  for (const entry of searchDiscoveryOperations) {
    const operation = entry.operation;
    const requestContent = operation.requestBody?.content?.["application/json"];
    if (requestContent) assertContentExamplesValidate(requestContent, `${entry.path} request`, examples);
    assertContentExamplesValidate(operation.responses["200"].content["application/json"], `${entry.path} response`, examples);
  }

  assert.equal(searchDiscoveryOperations.length, 5);
  assert.doesNotThrow(() => assertExamplePrivacy(examples));
  assert.doesNotThrow(() => assertNoExecutableExamples(examples));
});

test("committed OpenAPI 3.1 artifact matches the pinned 15-operation catalog exactly", async () => {
  const parsed = await SwaggerParser.validate("openapi.json");
  const generated = buildSpec();
  const committed = committedSpec();
  const approvedCatalog = JSON.parse(readFileSync("contracts/public-api-operations.json", "utf8"));

  assert.equal(parsed.openapi, "3.1.0");
  assert.deepEqual(committed.info, baseSpec.info);
  assert.deepEqual(committed.servers, baseSpec.servers);
  assert.deepEqual(committed.security, baseSpec.security);
  assert.equal(approvedCatalog.sourceSha, SOURCE_SHA);
  assert.equal(approvedCatalog.operations.length, 15);

  const actualOperations = [];
  for (const [path, pathItem] of Object.entries(committed.paths)) {
    for (const method of ["get", "post"]) {
      if (pathItem[method]) actualOperations.push({ method: method.toUpperCase(), path, operation: pathItem[method] });
    }
  }
  assert.equal(actualOperations.length, 15);
  assert.equal(actualOperations.filter(({ method }) => method === "POST").length, 14);
  assert.equal(actualOperations.filter(({ method }) => method === "GET").length, 1);
  assert.deepEqual(
    actualOperations.map(({ method, path }) => `${method} ${path}`).sort(),
    approvedCatalog.operations.map(({ method, path }) => `${method} ${path}`).sort()
  );

  for (const expected of approvedCatalog.operations) {
    const operation = operationFromSpec(committed, expected.method, expected.path);
    assert.ok(operation, `${expected.method} ${expected.path}`);
    assert.equal(operation.operationId, expected.operationId);
    assert.equal(operation.tags[0], expected.tag);
    assertPublicOperationMetadata(operation);
    assert.ok(operation.responses["200"] || operation.responses["202"]);
    assertUnauthorizedReference(operation);
  }

  const examples = collectExampleValues(committed);
  assert.doesNotThrow(() => assertExamplePrivacy(examples));
  assert.doesNotThrow(() => assertNoExecutableExamples(examples));
  assert.deepEqual(readFileSync("openapi.json"), Buffer.from(JSON.stringify(generated, null, 2) + "\n", "utf8"));
});

test("buildSpec inserts fixture operations in catalog order", () => {
  const first = operation("GET", "/first", "firstOperation");
  const second = operation("POST", "/second", "secondOperation");
  const spec = buildSpec({
    base: { paths: {} },
    catalog: catalog(
      { method: "POST", path: "/second", operationId: "secondOperation" },
      { method: "GET", path: "/first", operationId: "firstOperation" }
    ),
    operationModules: [[first], [second]]
  });

  assert.deepEqual(Object.keys(spec.paths), ["/second", "/first"]);
  assert.equal(spec.paths["/second"].post.operationId, "secondOperation");
  assert.equal(spec.paths["/first"].get.operationId, "firstOperation");
});

test("buildSpec clones operations before insertion", () => {
  const fixtureOperation = operation("GET", "/isolated", "isolatedOperation");
  fixtureOperation.operation.summary = "Original";
  const options = {
    base: { paths: {} },
    catalog: catalog({ method: "GET", path: "/isolated", operationId: "isolatedOperation" }),
    operationModules: [[fixtureOperation]]
  };

  const firstSpec = buildSpec(options);
  firstSpec.paths["/isolated"].get.summary = "Mutated";

  assert.equal(fixtureOperation.operation.summary, "Original");
  assert.equal(buildSpec(options).paths["/isolated"].get.summary, "Original");
});

test("buildSpec rejects duplicate method and path entries", () => {
  const expected = { method: "POST", path: "/duplicate", operationId: "duplicateOperation" };
  assert.throws(
    () => buildSpec({
      base: { paths: {} },
      catalog: catalog(expected),
      operationModules: [[
        operation("POST", "/duplicate", "duplicateOperation"),
        operation("POST", "/duplicate", "duplicateOperationTwo")
      ]]
    }),
    /Duplicate OpenAPI method\/path: POST \/duplicate/
  );
});

test("buildSpec rejects case-insensitive duplicate method and path entries", () => {
  assert.throws(
    () => buildSpec({
      base: { paths: {} },
      catalog: catalog({ method: "GET", path: "/same", operationId: "firstOperation" }),
      operationModules: [[
        operation("GET", "/same", "firstOperation"),
        operation("get", "/same", "secondOperation")
      ]]
    }),
    /Duplicate OpenAPI method\/path: GET \/same/
  );
});

test("buildSpec rejects duplicate operation IDs", () => {
  assert.throws(
    () => buildSpec({
      base: { paths: {} },
      catalog: catalog(
        { method: "GET", path: "/one", operationId: "firstOperation" },
        { method: "POST", path: "/two", operationId: "secondOperation" }
      ),
      operationModules: [[
        operation("GET", "/one", "sameOperation"),
        operation("POST", "/two", "sameOperation")
      ]]
    }),
    /Duplicate OpenAPI operationId: sameOperation/
  );
});

test("buildSpec rejects catalog operations missing from modules", () => {
  assert.throws(
    () => buildSpec({
      base: { paths: {} },
      catalog: catalog({ method: "GET", path: "/missing", operationId: "missingOperation" }),
      operationModules: [[]]
    }),
    /Missing OpenAPI operation module entry: GET \/missing/
  );
});

test("buildSpec rejects module operations missing from the catalog", () => {
  assert.throws(
    () => buildSpec({
      base: { paths: {} },
      catalog: catalog({ method: "GET", path: "/expected", operationId: "expectedOperation" }),
      operationModules: [[
        operation("GET", "/expected", "expectedOperation"),
        operation("POST", "/extra", "extraOperation")
      ]]
    }),
    /Extra OpenAPI operation module entry: POST \/extra/
  );
});

test("buildSpec rejects operation ID drift from the catalog", () => {
  assert.throws(
    () => buildSpec({
      base: { paths: {} },
      catalog: catalog({ method: "GET", path: "/drift", operationId: "catalogOperation" }),
      operationModules: [[operation("GET", "/drift", "moduleOperation")]]
    }),
    /Operation ID drift: GET \/drift/
  );
});

test("atomic output preserves an existing target when writing fails", () => {
  assertAtomicFailure({ failure: "write", initialContents: Buffer.from([0xff, 0x00, 0x01]) });
});

test("atomic output leaves an absent target absent when writing fails", () => {
  assertAtomicFailure({ failure: "write" });
});

test("atomic output preserves an existing target when renaming fails", () => {
  assertAtomicFailure({ failure: "rename", initialContents: Buffer.from([0xff, 0x00, 0x01]) });
});

test("atomic output leaves an absent target absent when renaming fails", () => {
  assertAtomicFailure({ failure: "rename" });
});

test("OpenAPI CLI check rejects an absent isolated artifact", () => {
  inTemporaryDirectory((directory) => {
    const targetPath = join(directory, "openapi.json");
    assert.throws(
      () => runCli(["--check"], { buildSpecImpl: fixtureSpec, outputPath: targetPath }),
      /OpenAPI output is missing: openapi.json/
    );
    assert.equal(readdirSync(directory).includes("openapi.json"), false);
  });
});

test("OpenAPI CLI check rejects a stale isolated artifact", () => {
  inTemporaryDirectory((directory) => {
    const targetPath = join(directory, "openapi.json");
    const stale = Buffer.from("stale\n");
    writeFileSync(targetPath, stale);

    assert.throws(
      () => runCli(["--check"], { buildSpecImpl: fixtureSpec, outputPath: targetPath }),
      /OpenAPI output is stale: openapi.json/
    );
    assert.deepEqual(readFileSync(targetPath), stale);
  });
});

test("OpenAPI CLI check accepts an exact isolated artifact", () => {
  inTemporaryDirectory((directory) => {
    const targetPath = join(directory, "openapi.json");
    writeFileSync(targetPath, serializedFixtureSpec());

    assert.doesNotThrow(() => runCli(["--check"], { buildSpecImpl: fixtureSpec, outputPath: targetPath }));
  });
});

test("OpenAPI CLI write atomically creates an isolated artifact", () => {
  inTemporaryDirectory((directory) => {
    const targetPath = join(directory, "openapi.json");
    runCli(["--write"], { buildSpecImpl: fixtureSpec, outputPath: targetPath });

    assert.deepEqual(readFileSync(targetPath), Buffer.from(serializedFixtureSpec(), "utf8"));
    assertNoTemporaryFiles(directory);
  });
});

test("malformed OpenAPI CLI arguments leave an isolated artifact unchanged", () => {
  inTemporaryDirectory((directory) => {
    const targetPath = join(directory, "openapi.json");
    const original = Buffer.from([0xff, 0x00, 0x01]);
    writeFileSync(targetPath, original);

    for (const [args, message] of [
      [["--unsupported"], /Unsupported argument: --unsupported/],
      [[], /Expected exactly one argument: --write or --check/],
      [["--write", "--check"], /Expected exactly one argument: --write or --check/]
    ]) {
      const before = snapshotFile(targetPath);
      assert.throws(() => runCli(args, { buildSpecImpl: fixtureSpec, outputPath: targetPath }), message);
      assert.deepEqual(snapshotFile(targetPath), before);
    }
  });
});

test("OpenAPI output freshness compares bytes instead of lossy UTF-8 text", () => {
  const serialized = "\uFFFD";
  const differentlyEncodedReplacementCharacter = Buffer.from([0xff]);

  assert.equal(differentlyEncodedReplacementCharacter.toString("utf8"), serialized);
  assert.equal(outputMatchesSerialized(serialized, differentlyEncodedReplacementCharacter), false);
});
