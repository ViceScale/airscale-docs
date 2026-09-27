import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";

const SOURCE_SHA = "c55176dba55f958f89048a51408f2170caef41de";
const GROUPS = {
  workspace: [
    "airscale_check_credits"
  ],
  search_and_research: [
    "airscale_find_people",
    "airscale_count_find_people",
    "airscale_find_companies",
    "airscale_find_companies_filter_values",
    "airscale_airsearch",
    "airscale_leads_finder"
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
    "airscale_reverse_phone",
    "airscale_domain_to_linkedin",
    "airscale_post_likers",
    "airscale_post_commenters"
  ],
  checks_and_signals: [
    "airscale_verify_email",
    "airscale_check_whatsapp",
    "airscale_get_whatsapp_check",
    "airscale_check_dnc",
    "airscale_meta_ads"
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
const EXPECTED_TOOL_KEYS = [
  "name",
  "anchor",
  "category",
  "description",
  "inputSchema",
  "spend",
  "asynchronous",
  "operationId",
  "apiPage"
];

// To reproduce these oracles, check out SOURCE_SHA in ViceScale/airscale-code,
// capture the pinned Worker's exact `tools/list` output, canonical-hash each
// inputSchema, and transcribe descriptions verbatim. Confirm spend and async
// semantics against the four sourceFiles at that same SHA before updating them.
const EXPECTED_SCHEMA_HASHES = {
  airscale_check_credits: "99334726611ccf58a148b0814696bfa6fe08c1b2d027e946beccf5a74331c9aa",
  airscale_find_people: "d6136bb30d27571f9454f31df26a347c77e730cc01a369f3d5b9c52c289ad3ea",
  airscale_count_find_people: "6f3574e0cb0bb88f34e0f5e2c7bffed5dee71fd08c6e11bc9849536e346432f0",
  airscale_find_companies: "f8a1ed2c7fb7220166c4b9bacd93da7e1eaa653bfe2cde6acb52e1ce4558bd52",
  airscale_find_companies_filter_values: "bc868bbb5c9ee36188a6a05c716d18711e2072ad712f62d3ab0ece8849d6fdc7",
  airscale_airsearch: "03d1d9e646f17c1679efb8d051e055536dc26d355742693b02e85df56c8a9bd9",
  airscale_leads_finder: "8f87c9e74709c5aec2a29c27f06a23272549479e7b5663b4d72a2e3fea39a2dc",
  airscale_find_email: "d585708df6024251db2bba2f87c355219725c2393b91f0e4b559f3c7579de0de",
  airscale_find_email_bulk: "3e0b3f975f4bcb181c9a04fca2edba5375ffa8bf1d2aa02e6edce327267ee946",
  airscale_find_mobile_phone: "fa383c5f1537d9487c87885da08613bafe384bd948cd91350c03dc72be07d85b",
  airscale_find_personal_email: "18550b69ab476358d43eee06a41693f46b668976cb5d8a5803dd7cbae76e665f",
  airscale_find_people_by_url: "4ae808b00ca71f3cd330df5676c6c52408b21946cc6168e39cf5cefd154fdf88",
  airscale_extract_people_profile: "87eb6be7a93c92388021e9fabb9f1b967c6a71f9858829ee192df10372ac4786",
  airscale_extract_company_profile: "13e2bf5b2d5dbddbdc81a31d6d01356bdaf1356833fd4d2c4a0a202c1d842432",
  airscale_reverse_email: "7c0ea69aa350c308dabbba3750fed1e6c07aea598cf1adbb9ea66ac2fbb81518",
  airscale_reverse_phone: "a3424cfa9178070316011d4cfabb8cb711341a8a0ba578177f99e137d7c38df6",
  airscale_domain_to_linkedin: "0ac14042faaf256fa8af6bf7fe594ae08ab784679800fcdb7aa86506289127d6",
  airscale_post_likers: "44c947583313acae67e35f6770b505c225f7c92b45939010b0367e83fb1410f0",
  airscale_post_commenters: "44c947583313acae67e35f6770b505c225f7c92b45939010b0367e83fb1410f0",
  airscale_verify_email: "5ba9e393315b7e9db111616b59d749c8c2531b1ca09f43cbdebe786105b8d3fa",
  airscale_check_whatsapp: "132fdf7765fb26691d3b88ac3417489ae587db69b2dbc6565b67a4172f3bae2b",
  airscale_get_whatsapp_check: "4c22e7e7053682ee8bf072f6ad80953da71704cad71e7016f679e8888b694430",
  airscale_check_dnc: "20577c564c2a6df69f0f0e8bff927df2c2956c2371744ac13aca6d45da5c6afb",
  airscale_meta_ads: "db58d6fa77942cbe1c58cbf70fbb5f7ed5084306512193c254c7e14b27f47e86",
  airscale_start_companies_export: "c79eda1cff8503b1df8f3f75b25a5b4fe3b10b08e4fef95c75c9a94be827fc78",
  airscale_start_people_export: "97e7678c3f004746fbb202fb60ae742b9f84672ebc20f7de7f9849aff0dcf61a",
  airscale_create_contact_enrichment_batch: "aaea2244519a140712407406e62042a40d2cd7454224cc27f6ef9595322174f4",
  airscale_add_contacts_to_enrichment_batch: "8622df11336fb0e4b2b3ba435ddd772f0f61e744f49d38d06c9bef00a2b3afa6",
  airscale_start_contact_enrichment_export: "70fa02c9b8454d774ed4d0499f489ccb88c28c3eca750f0d9631b68be6497e22",
  airscale_get_export_status: "aa7e9ae6f2c9b9e9acd6b8b3cd519f971ef62bb385936e5bdb90bba1d6d8dce6",
  airscale_get_export_file: "4363c5e5abc7533e9cde0eaf5c06b155322252df0d6ab8665643b32c99fa5766"
};
const EXPECTED_TOOL_METADATA = {
  airscale_check_credits: {
    description:
      "Check how many credits remain in the workspace.",
    spend: { kind: "free", summary: "Free; checking the balance does not debit credits" },
    asynchronous: false
  },
  airscale_find_people: {
    description:
      "Search people with public Find People filters for profile, current company, experience, and company growth. Costs 0.1 credits per returned lead. Paginate with cursor.",
    spend: { kind: "variable", summary: "0.1 credits per returned lead" },
    asynchronous: false
  },
  airscale_count_find_people: {
    description:
      "Count people matching find-people query filters. Free, no credits charged.",
    spend: { kind: "free", summary: "Free; no credits charged" },
    asynchronous: false
  },
  airscale_find_companies: {
    description:
      "Search companies by firmographic, location, event, intent, technology, and website keyword filters. Costs 0.1 credits per returned company. Use airscale_find_companies_filter_values to discover accepted values.",
    spend: { kind: "variable", summary: "0.1 credits per returned company" },
    asynchronous: false
  },
  airscale_find_companies_filter_values: {
    description:
      "Discover accepted values for find-companies filters (city, region, industry, topics, techStack). Free, no credits charged.",
    spend: { kind: "free", summary: "Free; no credits charged" },
    asynchronous: false
  },
  airscale_airsearch: {
    description:
      "AI web research agent: ask a natural-language question and optionally specify structured fields to extract. Costs 2 credits per call.",
    spend: { kind: "variable", summary: "2 credits per call" },
    asynchronous: false
  },
  airscale_leads_finder: {
    description:
      "Search people with Leads Finder filters (job, company, location, seniority, skills, company size, funding, and more). Zero-based page pagination. Costs 0.1 credits per returned lead.",
    spend: { kind: "variable", summary: "0.1 credits per returned lead" },
    asynchronous: false
  },
  airscale_find_email: {
    description:
      "Find a contact's professional email. Provide either a LinkedIn profile URL, or first/last name plus a company domain or name.",
    spend: { kind: "variable", summary: "2 credits per successful result" },
    asynchronous: false
  },
  airscale_find_email_bulk: {
    description:
      "Find professional emails for multiple contacts. Returns immediately; results are delivered to webhook_url, one payload per input.",
    spend: { kind: "variable", summary: "2 credits per successful input" },
    asynchronous: true
  },
  airscale_find_mobile_phone: {
    description:
      "Find a contact's mobile phone number from their LinkedIn profile URL.",
    spend: { kind: "variable", summary: "40 credits per successful result" },
    asynchronous: false
  },
  airscale_find_personal_email: {
    description:
      "Find a contact's personal email from their LinkedIn profile URL.",
    spend: { kind: "variable", summary: "3-12 credits per successful result" },
    asynchronous: false
  },
  airscale_find_people_by_url: {
    description:
      "Find a person's LinkedIn profile URL from their name and company.",
    spend: { kind: "variable", summary: "0.5 credits per successful result" },
    asynchronous: false
  },
  airscale_extract_people_profile: {
    description:
      "Extract a full LinkedIn person profile from its URL.",
    spend: { kind: "variable", summary: "URL-selected pricing; person-profile successes cost 1 credit by default and workspace-specific pricing may differ" },
    asynchronous: false
  },
  airscale_extract_company_profile: {
    description:
      "Extract a full LinkedIn company profile from its URL.",
    spend: { kind: "variable", summary: "URL-selected pricing; company or school-profile successes cost 0.5 credits and workspace-specific pricing may differ" },
    asynchronous: false
  },
  airscale_reverse_email: {
    description:
      "Resolve an email address to a LinkedIn profile. Returns the entire enriched profile, not only the URL.",
    spend: { kind: "variable", summary: "2 credits per returned profile" },
    asynchronous: false
  },
  airscale_reverse_phone: {
    description:
      "Resolve a phone number to a LinkedIn profile. Returns the entire enriched profile, not only the URL.",
    spend: { kind: "variable", summary: "10 credits per returned profile" },
    asynchronous: false
  },
  airscale_domain_to_linkedin: {
    description:
      "Find a company's LinkedIn company URL from its domain. Costs 0.5 credits on success; no-result lookups are free. Allow up to 130 seconds.",
    spend: { kind: "variable", summary: "0.5 credits on success; no-result lookups are free" },
    asynchronous: false
  },
  airscale_post_likers: {
    description:
      "List and enrich people who liked a LinkedIn post, one page (up to 25) at a time. Reserves 1 credit per requested slot and refunds unused, not-found, and failed slots.",
    spend: { kind: "variable", summary: "1 credit per enriched profile; unused, not-found, and failed slots are refunded" },
    asynchronous: false
  },
  airscale_post_commenters: {
    description:
      "List and enrich people who commented on a LinkedIn post, one page (up to 25) at a time. Reserves 1 credit per requested slot and refunds unused, not-found, and failed slots.",
    spend: { kind: "variable", summary: "1 credit per enriched profile; unused, not-found, and failed slots are refunded" },
    asynchronous: false
  },
  airscale_verify_email: {
    description:
      "Verify whether an email address is deliverable. Costs 0.5 credits. Allow up to 135 seconds.",
    spend: { kind: "variable", summary: "0.5 credits per verification" },
    asynchronous: false
  },
  airscale_check_whatsapp: {
    description:
      "Check whether a phone number is on WhatsApp. Costs 1 credit for a definitive yes or no. A pending or unknown result returns an operation_id to look up with airscale_get_whatsapp_check.",
    spend: { kind: "variable", summary: "1 credit for a definitive yes or no" },
    asynchronous: false
  },
  airscale_get_whatsapp_check: {
    description:
      "Look up a previous WhatsApp check by its operation_id. Free; does not start a new check.",
    spend: { kind: "free", summary: "Free; no credits charged" },
    asynchronous: false
  },
  airscale_check_dnc: {
    description:
      "Check whether a US phone number is on the Do Not Call list. Costs 1 credit per completed check.",
    spend: { kind: "variable", summary: "1 credit per completed check" },
    asynchronous: false
  },
  airscale_meta_ads: {
    description:
      "Look up a company's Meta (Facebook and Instagram) ads from its domain. Costs 1 credit when ads are found; otherwise free.",
    spend: { kind: "variable", summary: "1 credit when ads are found; otherwise free" },
    asynchronous: false
  },
  airscale_start_companies_export: {
    description:
      "Start an async paid export of Find Companies results to CSV or JSONL. Returns an export_id; poll airscale_get_export_status.",
    spend: { kind: "paid_export", summary: "Up to 0.1 credits per exported company", confirmationField: "confirm_credit_spend" },
    asynchronous: true
  },
  airscale_start_people_export: {
    description:
      "Start an async paid export of Find People results to CSV or JSONL. Returns an export_id; poll airscale_get_export_status.",
    spend: { kind: "paid_export", summary: "Up to 0.1 credits per exported lead", confirmationField: "confirm_credit_spend" },
    asynchronous: true
  },
  airscale_create_contact_enrichment_batch: {
    description:
      "Create a server-side batch for CSV/file/table contact inputs with more than 20 rows before starting a managed bulk work-email enrichment export.",
    spend: { kind: "free", summary: "Free; no enrichment credits charged" },
    asynchronous: false
  },
  airscale_add_contacts_to_enrichment_batch: {
    description:
      "Add CSV/file/table contacts to a managed enrichment batch in chunks of up to 250. Use this for more than 20 rows instead of repeated single-contact lookup tools.",
    spend: { kind: "free", summary: "Free; no enrichment credits charged" },
    asynchronous: false
  },
  airscale_start_contact_enrichment_export: {
    description:
      "Start an async paid work-email enrichment export for a CSV/file/table contact batch with more than 20 rows after checking available credits. Returns an export_id; poll airscale_get_export_status, then use airscale_get_export_file.",
    spend: { kind: "paid_export", summary: "Up to 2 credits per contact", confirmationField: "confirm_credit_spend" },
    asynchronous: true
  },
  airscale_get_export_status: {
    description:
      "Check an async companies, people, or contact-enrichment export job without returning exported rows.",
    spend: { kind: "free", summary: "Free; no credits charged" },
    asynchronous: false
  },
  airscale_get_export_file: {
    description:
      "Get the download URL and MCP resource link for a completed companies, people, or contact-enrichment export file.",
    spend: { kind: "free", summary: "Free; no credits charged" },
    asynchronous: false
  }
};
const CORE_OPERATION_IDS = {
  airscale_check_credits: "getCredits",
  airscale_find_people: "findPeople",
  airscale_count_find_people: "countPeople",
  airscale_find_companies: "findCompanies",
  airscale_find_companies_filter_values: "listFindCompanyFilterValues",
  airscale_airsearch: "airsearch",
  airscale_leads_finder: "searchLeadsFinder",
  airscale_find_email: "findProfessionalEmail",
  airscale_find_email_bulk: "findProfessionalEmailsBulk",
  airscale_find_mobile_phone: "findMobilePhone",
  airscale_find_personal_email: "findPersonalEmail",
  airscale_find_people_by_url: "findPeopleProfileUrl",
  airscale_extract_people_profile: "extractPersonProfile",
  airscale_extract_company_profile: "extractCompanyProfile",
  airscale_reverse_email: "reverseEmailLookup",
  airscale_reverse_phone: "reversePhoneLookup",
  airscale_domain_to_linkedin: "findCompanyLinkedinUrl",
  airscale_post_likers: "listPostLikers",
  airscale_post_commenters: "listPostCommenters",
  airscale_verify_email: "verifyEmail",
  airscale_check_whatsapp: "checkWhatsapp",
  airscale_get_whatsapp_check: "getWhatsappCheckOperation",
  airscale_check_dnc: "checkDnc",
  airscale_meta_ads: "lookupMetaAds"
};
const PAID_EXPORT_STARTS = [
  "airscale_start_companies_export",
  "airscale_start_people_export",
  "airscale_start_contact_enrichment_export"
];
const ajv = new Ajv2020({ strict: true });

function contract() {
  return JSON.parse(readFileSync("contracts/mcp-tools.json", "utf8"));
}

function toolFixture(name) {
  return structuredClone(contract().tools.find((tool) => tool.name === name));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

function schemaHash(schema) {
  return createHash("sha256").update(JSON.stringify(canonicalize(schema))).digest("hex");
}

function assertToolTopLevelKeys(tool) {
  assert.deepEqual(Object.keys(tool).sort(), [...EXPECTED_TOOL_KEYS].sort());
}

function assertValidInputSchema(tool) {
  assert.equal(tool.inputSchema.type, "object");
  assert.ok(tool.inputSchema.properties && typeof tool.inputSchema.properties === "object");
  assert.equal(tool.inputSchema.additionalProperties, false);
  const schemaIsValid = ajv.validateSchema(tool.inputSchema);
  assert.equal(
    schemaIsValid,
    true,
    `${tool.name} inputSchema must be valid JSON Schema 2020-12: ${ajv.errorsText(ajv.errors)}`
  );
}

function assertToolMetadata(tool) {
  const expected = EXPECTED_TOOL_METADATA[tool.name];
  assert.ok(expected, `${tool.name} must have an exact metadata oracle`);
  assert.deepEqual(
    { description: tool.description, spend: tool.spend, asynchronous: tool.asynchronous },
    expected,
    `${tool.name} metadata must match the pinned runtime contract`
  );
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

test("MCP contract contains the exact thirty-one tools in approved groups", () => {
  const tools = contract().tools;
  assert.equal(tools.length, 31);
  assert.equal(new Set(tools.map(({ name }) => name)).size, 31);
  assert.deepEqual(tools.map(({ name }) => name), EXPECTED_NAMES);
  assert.deepEqual(Object.keys(EXPECTED_TOOL_METADATA), EXPECTED_NAMES);
  assert.deepEqual(Object.keys(EXPECTED_SCHEMA_HASHES).sort(), [...EXPECTED_NAMES].sort());
  assert.deepEqual(
    Object.fromEntries(Object.keys(GROUPS).map((category) => [category, tools.filter((tool) => tool.category === category).length])),
    { workspace: 1, search_and_research: 6, contact_and_profile_enrichment: 12, checks_and_signals: 5, async_exports_and_managed_batches: 7 }
  );
  for (const [category, names] of Object.entries(GROUPS)) {
    assert.deepEqual(tools.filter((tool) => tool.category === category).map(({ name }) => name), names);
  }
});

test("metadata validation rejects spend-classification drift", () => {
  const mobile = toolFixture("airscale_find_mobile_phone");
  mobile.spend = { kind: "free", summary: "Free; no credits charged" };
  assert.throws(() => assertToolMetadata(mobile));
});

test("metadata validation rejects description drift", () => {
  const mobile = toolFixture("airscale_find_mobile_phone");
  mobile.description = "Changed documentation text that still passes the completeness threshold.";
  assert.throws(() => assertToolMetadata(mobile));
});

test("metadata validation rejects asynchronous-behavior drift", () => {
  const bulkEmail = toolFixture("airscale_find_email_bulk");
  bulkEmail.asynchronous = false;
  assert.throws(() => assertToolMetadata(bulkEmail));
});

test("schema hashes ignore recursive object-key order", () => {
  const schema = {
    type: "object",
    properties: {
      query: { type: "string", minLength: 1 },
      size: { type: "integer", minimum: 1 }
    },
    required: ["query"],
    additionalProperties: false
  };
  const reordered = {
    additionalProperties: false,
    required: ["query"],
    properties: {
      size: { minimum: 1, type: "integer" },
      query: { minLength: 1, type: "string" }
    },
    type: "object"
  };
  assert.equal(schemaHash(schema), schemaHash(reordered));
});

test("top-level key validation ignores order while rejecting missing and extra keys", () => {
  const original = toolFixture("airscale_check_credits");
  const reordered = Object.fromEntries(Object.entries(original).reverse());
  assert.doesNotThrow(() => assertToolTopLevelKeys(reordered));

  const missing = structuredClone(original);
  delete missing.apiPage;
  assert.throws(() => assertToolTopLevelKeys(missing));

  const extra = { ...original, undocumentedField: true };
  assert.throws(() => assertToolTopLevelKeys(extra));
});

test("input schemas must be valid JSON Schema 2020-12 documents", () => {
  const invalid = toolFixture("airscale_check_credits");
  invalid.inputSchema.required = "not-an-array";
  assert.throws(() => assertValidInputSchema(invalid), /valid JSON Schema 2020-12/);
});

test("every MCP tool carries a complete documentation contract and exact runtime schema", () => {
  for (const tool of contract().tools) {
    assertToolTopLevelKeys(tool);
    assert.match(tool.name, /^airscale_[a-z_]+$/);
    assert.equal(tool.anchor, tool.name.replaceAll("_", "-"));
    assertToolMetadata(tool);
    assertValidInputSchema(tool);
    assert.equal(schemaHash(tool.inputSchema), EXPECTED_SCHEMA_HASHES[tool.name]);
    assert.equal(containsApiKeyArgument(tool.inputSchema), false);
    assert.equal(tool.operationId === null, tool.apiPage === null);
  }
});

test("core tools map one-to-one to approved OpenAPI operations and batch tools map to none", () => {
  const manifest = contract();
  const tools = manifest.tools.filter(({ operationId }) => operationId);
  const batchTools = manifest.tools.filter(({ operationId }) => !operationId);
  const operations = JSON.parse(readFileSync("contracts/public-api-operations.json", "utf8")).operations;
  const operationsById = new Map(operations.map((operation) => [operation.operationId, operation]));
  const coreOperationIds = new Set(tools.map(({ operationId }) => operationId));
  const coreOperations = operations.filter(({ operationId }) => coreOperationIds.has(operationId));

  assert.equal(tools.length, 24);
  assert.equal(new Set(tools.map(({ operationId }) => operationId)).size, 24);
  assert.equal(coreOperations.length, 24);
  assert.deepEqual(Object.fromEntries(tools.map(({ name, operationId }) => [name, operationId])), CORE_OPERATION_IDS);
  assert.deepEqual(
    tools.map(({ operationId }) => operationId).sort(),
    coreOperations.map(({ operationId }) => operationId).sort()
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
