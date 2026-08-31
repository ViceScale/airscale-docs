import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const SOURCE_SHA = "b06ea2c46276f8415a97721f6901437ce07f13fa";
const GROUPS = {
  workspace: ["airscale_check_credits"],
  search_and_research: [
    "airscale_find_people",
    "airscale_count_find_people",
    "airscale_find_companies",
    "airscale_find_companies_filter_values",
    "airscale_airsearch"
  ],
  contact_and_profile_enrichment: [
    "airscale_find_email",
    "airscale_find_email_bulk",
    "airscale_find_mobile_phone",
    "airscale_find_personal_email",
    "airscale_find_people_by_url",
    "airscale_extract_people_profile",
    "airscale_extract_company_profile",
    "airscale_reverse_email",
    "airscale_reverse_phone"
  ],
  async_exports_and_managed_batches: [
    "airscale_start_companies_export",
    "airscale_start_people_export",
    "airscale_create_contact_enrichment_batch",
    "airscale_add_contacts_to_enrichment_batch",
    "airscale_start_contact_enrichment_export",
    "airscale_get_export_status",
    "airscale_get_export_file"
  ]
};
const EXPECTED_NAMES = Object.values(GROUPS).flat();
const EXPECTED_SCHEMA_HASHES = {
  airscale_check_credits: "32062bdb9024160d3b9816f12ba2f337808ee107449f8bf08d55b0026944f51e",
  airscale_find_people: "f4e0c9585d58df1e585faa8c4db5ffbe8db67c5beed0862f8869052a410de7ad",
  airscale_count_find_people: "3c628e22c28b00ac2f068fd1a60a52d8518a9668f756fdd1abfd6eb4c533288c",
  airscale_find_companies: "722b39325e2a58bd38eeae1158bfbded55bae1e6a7732a90bb6d69282dcc1893",
  airscale_find_companies_filter_values: "35353a8d4c8e36ab8cbfac3bf1e56555b9300851dd3ddca4e64c4f111d20d233",
  airscale_airsearch: "0be91964e4342cc0aac0febe8862b313b2019f192796bf641b832a2dd73dd5c6",
  airscale_find_email: "f141aa1d244d3ecd7ade2ca13c2ebbd40525c90f28da889455c7486301974af8",
  airscale_find_email_bulk: "fd3805f9a97ea3f3364299d45a7ccbaa46fe02d6222b674000340445f5b8a361",
  airscale_find_mobile_phone: "cc663236a886df41f8c905201ce399d42449208876313db9ed462162aad88b7e",
  airscale_find_personal_email: "cc663236a886df41f8c905201ce399d42449208876313db9ed462162aad88b7e",
  airscale_find_people_by_url: "4694ba04f658f72ed57c07dfbceefc8f3087a8e3e50dc78201981ed6df066506",
  airscale_extract_people_profile: "ce820f9bc7dfed522aac61cd1a70604522ea2c314da5ca4e4b676d24f1852e77",
  airscale_extract_company_profile: "43d12b720603f47a984810599b3cc068e8aa50eb700b7e66e300b79b23697b58",
  airscale_reverse_email: "a68478a86e7de5cb9bc36933abda7da8d754687301d3f80a64ad503ce8fe6495",
  airscale_reverse_phone: "81b8482d99786d7449b159ce5ae8cca7799ea49a2fec846c0a2a4094f9f91f1b",
  airscale_start_companies_export: "9890fc3ec61621bde790cda27ba8a86713a3829d5ecef6157e4c42b41d492da1",
  airscale_start_people_export: "ff815d3556f721e0117994fe39cf6b270c3cbd884bf16fd23f669a077a6b15c3",
  airscale_create_contact_enrichment_batch: "4a8995ab4c2a5570a50e5f2b13be103d7f90ed9ee138decbf673288d547cbaf3",
  airscale_add_contacts_to_enrichment_batch: "f7f836d97ca294c46a71591c1ccce04f789069a4ebeb4486599bfabb9b470943",
  airscale_start_contact_enrichment_export: "58261581fa87773c2042c7920069d999427c7dfc3e7ec0ff2399dd94d2d3de37",
  airscale_get_export_status: "ebc050cb7b8f1381217283e51ad11a05a7f7ef9b2432023a3395c0614513e341",
  airscale_get_export_file: "f7c6d4890b99aa4992b4dbaf1467f8ae5ae87075e4cce059cdba1155884752ce"
};
const CORE_OPERATION_IDS = {
  airscale_check_credits: "getCredits",
  airscale_find_people: "findPeople",
  airscale_count_find_people: "countPeople",
  airscale_find_companies: "findCompanies",
  airscale_find_companies_filter_values: "listFindCompanyFilterValues",
  airscale_airsearch: "airsearch",
  airscale_find_email: "findProfessionalEmail",
  airscale_find_email_bulk: "findProfessionalEmailsBulk",
  airscale_find_mobile_phone: "findMobilePhone",
  airscale_find_personal_email: "findPersonalEmail",
  airscale_find_people_by_url: "findPeopleProfileUrl",
  airscale_extract_people_profile: "extractPersonProfile",
  airscale_extract_company_profile: "extractCompanyProfile",
  airscale_reverse_email: "reverseEmailLookup",
  airscale_reverse_phone: "reversePhoneLookup"
};
const PAID_EXPORT_STARTS = [
  "airscale_start_companies_export",
  "airscale_start_people_export",
  "airscale_start_contact_enrichment_export"
];

function contract() {
  return JSON.parse(readFileSync("contracts/mcp-tools.json", "utf8"));
}

function schemaHash(schema) {
  return createHash("sha256").update(JSON.stringify(schema)).digest("hex");
}

function containsApiKeyArgument(value) {
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, child]) => key === "api_key" || containsApiKeyArgument(child));
}

test("MCP contract is pinned to the approved Airscale source", () => {
  const manifest = contract();
  assert.equal(manifest.sourceRepository, "ViceScale/airscale-code");
  assert.equal(manifest.sourceSha, SOURCE_SHA);
  assert.deepEqual(manifest.sourceFiles, [
    "mcp/airscale-public-api/src/endpoints.ts",
    "mcp/airscale-public-api/src/exportJobs.ts",
    "mcp/airscale-public-api/src/contactEnrichmentJobs.ts",
    "mcp/airscale-public-api/src/worker.ts"
  ]);
});

test("MCP contract contains the exact twenty-two tools in approved groups", () => {
  const tools = contract().tools;
  assert.equal(tools.length, 22);
  assert.equal(new Set(tools.map(({ name }) => name)).size, 22);
  assert.deepEqual(tools.map(({ name }) => name), EXPECTED_NAMES);
  assert.deepEqual(
    Object.fromEntries(Object.keys(GROUPS).map((category) => [category, tools.filter((tool) => tool.category === category).length])),
    { workspace: 1, search_and_research: 5, contact_and_profile_enrichment: 9, async_exports_and_managed_batches: 7 }
  );
  for (const [category, names] of Object.entries(GROUPS)) {
    assert.deepEqual(tools.filter((tool) => tool.category === category).map(({ name }) => name), names);
  }
});

test("every MCP tool carries a complete documentation contract and exact runtime schema", () => {
  for (const tool of contract().tools) {
    assert.deepEqual(Object.keys(tool), [
      "name",
      "anchor",
      "category",
      "description",
      "inputSchema",
      "spend",
      "asynchronous",
      "operationId",
      "apiPage"
    ]);
    assert.match(tool.name, /^airscale_[a-z_]+$/);
    assert.equal(tool.anchor, tool.name.replaceAll("_", "-"));
    assert.ok(tool.description.length >= 20);
    assert.equal(tool.inputSchema.type, "object");
    assert.ok(tool.inputSchema.properties && typeof tool.inputSchema.properties === "object");
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.equal(schemaHash(tool.inputSchema), EXPECTED_SCHEMA_HASHES[tool.name]);
    assert.equal(containsApiKeyArgument(tool.inputSchema), false);
    assert.match(tool.spend.kind, /^(free|variable|paid_export)$/);
    assert.ok(typeof tool.spend.summary === "string" && tool.spend.summary.length > 0);
    assert.equal(typeof tool.asynchronous, "boolean");
    assert.equal(tool.operationId === null, tool.apiPage === null);
  }
});

test("core tools map one-to-one to approved OpenAPI operations and batch tools map to none", () => {
  const manifest = contract();
  const tools = manifest.tools.filter(({ operationId }) => operationId);
  const batchTools = manifest.tools.filter(({ operationId }) => !operationId);
  const operations = JSON.parse(readFileSync("contracts/public-api-operations.json", "utf8")).operations;
  const operationsById = new Map(operations.map((operation) => [operation.operationId, operation]));

  assert.equal(tools.length, 15);
  assert.equal(new Set(tools.map(({ operationId }) => operationId)).size, 15);
  assert.deepEqual(Object.fromEntries(tools.map(({ name, operationId }) => [name, operationId])), CORE_OPERATION_IDS);
  assert.deepEqual(
    tools.map(({ operationId }) => operationId).sort(),
    operations.map(({ operationId }) => operationId).sort()
  );
  for (const tool of tools) {
    assert.equal(tool.apiPage, `/${operationsById.get(tool.operationId).page}`);
  }
  assert.deepEqual(batchTools.map(({ name }) => name), GROUPS.async_exports_and_managed_batches);
  assert.ok(batchTools.every(({ operationId, apiPage }) => operationId === null && apiPage === null));
});

test("paid export starts require explicit confirmation and Airsearch costs two credits", () => {
  const tools = new Map(contract().tools.map((tool) => [tool.name, tool]));
  assert.deepEqual(
    contract().tools.filter(({ spend }) => spend.kind === "paid_export").map(({ name }) => name),
    PAID_EXPORT_STARTS
  );
  for (const name of PAID_EXPORT_STARTS) {
    assert.equal(tools.get(name).spend.confirmationField, "confirm_credit_spend");
    assert.deepEqual(tools.get(name).inputSchema.properties.confirm_credit_spend, {
      type: "boolean",
      description:
        name === "airscale_start_contact_enrichment_export"
          ? "Must be true to start paid contact enrichment."
          : "Must be true to start a paid fresh-row export."
    });
  }
  assert.deepEqual(tools.get("airscale_airsearch").spend, { kind: "variable", summary: "2 credits per call" });
});
