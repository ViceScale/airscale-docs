import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import {
  acquireGeneratedPairWriterLock,
  assertGeneratedPairWriterLock,
  assertNoIncompleteTransactionForCheck,
  assertNoWriterLockForCheck,
  finishGeneratedPairWriterLockRecovery,
  isGeneratedPairReservedPath,
  recoverGeneratedPair,
  releaseGeneratedPairWriterLock,
  writeGeneratedPair
} from "./lib/atomic-generated-pair.mjs";

const DEFAULT_CONTRACT_PATH = fileURLToPath(new URL("../contracts/mcp-tools.json", import.meta.url));
const DEFAULT_CATALOG_PATH = fileURLToPath(new URL("../mcp/tools.mdx", import.meta.url));
const DEFAULT_PUBLIC_PATH = fileURLToPath(new URL("../mcp-tools.json", import.meta.url));
const PUBLIC_DESCRIPTION = "Browse all 22 typed tools exposed by the Airscale MCP server.";
const CATEGORY_GROUPS = [
  { key: "workspace", title: "Workspace", count: 1 },
  { key: "search_and_research", title: "Search and research", count: 5 },
  { key: "contact_and_profile_enrichment", title: "Contact and profile enrichment", count: 9 },
  { key: "async_exports_and_managed_batches", title: "Async exports and managed batches", count: 7 }
];
const CATEGORY_TITLES = new Map(CATEGORY_GROUPS.map(({ key, title }) => [key, title]));
const RESULT_BEHAVIOR = {
  airscale_check_credits: "Returns the workspace's current Airscale credit balance without spending credits.",
  airscale_find_people: "Returns one page of matching people and a cursor when another page is available.",
  airscale_count_find_people: "Returns the number of people matching the supplied query filters.",
  airscale_find_companies: "Returns one page of matching companies and pagination metadata for any remaining results.",
  airscale_find_companies_filter_values: "Returns accepted values for the selected company filter and search text.",
  airscale_airsearch: "Returns the research answer and any structured fields requested in the prompt schema.",
  airscale_find_email: "Returns a professional email result when found, or a documented not-found result.",
  airscale_find_email_bulk: "Returns an acceptance result immediately; one result per input is delivered to the webhook URL.",
  airscale_find_mobile_phone: "Returns the discovered mobile phone result, or a documented not-found result.",
  airscale_find_personal_email: "Returns the discovered personal email result, or a documented not-found result.",
  airscale_find_people_by_url: "Returns a matching LinkedIn person-profile URL, or a documented not-found result.",
  airscale_extract_people_profile: "Returns the extracted person profile for the supplied LinkedIn URL.",
  airscale_extract_company_profile: "Returns the extracted company or school profile for the supplied LinkedIn URL.",
  airscale_reverse_email: "Returns the enriched person profile resolved from the email address, not only a profile URL.",
  airscale_reverse_phone: "Returns the enriched person profile resolved from the phone number, not only a profile URL.",
  airscale_start_companies_export: "Returns an `export_id`; poll `airscale_get_export_status` before requesting the file.",
  airscale_start_people_export: "Returns an `export_id`; poll `airscale_get_export_status` before requesting the file.",
  airscale_create_contact_enrichment_batch: "Returns a managed `batch_id` that can receive contact chunks before enrichment starts.",
  airscale_add_contacts_to_enrichment_batch: "Returns the updated managed-batch state after accepting the contact chunk.",
  airscale_start_contact_enrichment_export: "Returns an `export_id`; poll status, then request the completed export file.",
  airscale_get_export_status: "Returns the export state and progress metadata, including the server-provided polling interval when present.",
  airscale_get_export_file: "Returns a download URL and MCP resource link after the export has completed."
};
// JSON Schema cannot express every runtime cross-field rule or a safe paid
// request size. Keep those examples intentionally narrow and synthetic.
const SAFE_EXAMPLE_ARGUMENTS = Object.freeze({
  airscale_find_people: {
    query: { companyDomain: { include: ["example.com"] } },
    size: 1
  },
  airscale_find_companies: {
    filters: { companyName: "Example Company" },
    size: 1
  },
  airscale_find_email: {
    first_name: "Example",
    last_name: "Person",
    domain: "example.com"
  },
  airscale_find_email_bulk: {
    webhook_url: "https://hooks.example.com/airscale",
    inputs: [{
      custom_id: "example-contact-1",
      first_name: "Example",
      last_name: "Person",
      domain: "example.com"
    }]
  },
  airscale_extract_company_profile: {
    linkedin_profile_url: "https://www.linkedin.com/company/example-company"
  },
  airscale_start_companies_export: {
    filters: { companyName: "Example Company" },
    max_rows: 1,
    format: "csv",
    confirm_credit_spend: true
  },
  airscale_start_people_export: {
    query: { companyDomain: { include: ["example.com"] } },
    max_rows: 1,
    format: "csv",
    confirm_credit_spend: true
  },
  airscale_create_contact_enrichment_batch: {
    name: "Example contact enrichment batch"
  },
  airscale_add_contacts_to_enrichment_batch: {
    batch_id: "example-batch-id",
    contacts: [{
      custom_id: "example-contact-1",
      first_name: "Example",
      last_name: "Person",
      domain: "example.com"
    }]
  },
  airscale_start_contact_enrichment_export: {
    batch_id: "example-batch-id",
    enrichments: ["work_email"],
    format: "csv",
    confirm_credit_spend: true
  }
});
const defaultFileIO = {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync
};

export class ExampleSynthesisError extends Error {
  constructor(toolName, path, detail, options = {}) {
    super(`Cannot synthesize a valid example for ${toolName} at ${path}: ${detail}`, options);
    this.name = "ExampleSynthesisError";
    this.toolName = toolName;
    this.schemaPath = path;
  }
}

function clone(value) {
  return structuredClone(value);
}

function countOccurrences(source, literal) {
  return source.split(literal).length - 1;
}

function schemaValidator(schema) {
  const ajv = new Ajv2020({ strict: false });
  addFormats(ajv);
  return ajv.compile(clone(schema));
}

function assertSafeContractProse(value, label) {
  if (typeof value !== "string") return;
  if (
    /<\s*\/?\s*[A-Za-z][^>]*>/u.test(value)
    || /(?:javascript|vbscript|data)\s*:/iu.test(value)
  ) {
    throw new Error(`Unsafe contract prose in ${label}`);
  }
}

function validateSchemaProse(value, label, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const child of value) validateSchemaProse(child, label, seen);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (["description", "title"].includes(key)) assertSafeContractProse(child, `${label}.${key}`);
    else validateSchemaProse(child, `${label}.${key}`, seen);
  }
}

function validateContract(contract) {
  if (!contract || typeof contract !== "object" || Array.isArray(contract)) {
    throw new Error("MCP contract must be an object");
  }
  if (typeof contract.sourceSha !== "string" || contract.sourceSha.length === 0) {
    throw new Error("MCP contract must include a source SHA");
  }
  if (!Array.isArray(contract.tools) || contract.tools.length !== 22) {
    throw new Error("MCP contract must contain exactly 22 tools");
  }

  const names = new Set();
  const anchors = new Set();
  for (const tool of contract.tools) {
    if (!tool || typeof tool !== "object") throw new Error("Each MCP tool must be an object");
    if (typeof tool.name !== "string" || !/^airscale_[a-z0-9]+(?:_[a-z0-9]+)*$/u.test(tool.name)) {
      throw new Error(`Invalid MCP tool name grammar: ${tool.name}`);
    }
    if (names.has(tool.name)) throw new Error(`Duplicate MCP tool name: ${tool.name}`);
    if (
      typeof tool.anchor !== "string"
      || !/^airscale-[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(tool.anchor)
      || tool.anchor !== tool.name.replaceAll("_", "-")
    ) {
      throw new Error(`Invalid MCP anchor grammar: ${tool.anchor}`);
    }
    if (anchors.has(tool.anchor)) throw new Error(`Duplicate MCP anchor: ${tool.anchor}`);
    if (!CATEGORY_TITLES.has(tool.category)) throw new Error(`Unknown MCP tool category: ${tool.category}`);
    if (typeof tool.description !== "string" || tool.description.length === 0) throw new Error(`Missing description for ${tool.name}`);
    assertSafeContractProse(tool.description, `${tool.name}.description`);
    if (!tool.spend || !["free", "variable", "paid_export"].includes(tool.spend.kind)) {
      throw new Error(`Invalid spend classification for ${tool.name}`);
    }
    if (typeof tool.spend.summary !== "string" || tool.spend.summary.length === 0) {
      throw new Error(`Missing spend summary for ${tool.name}`);
    }
    assertSafeContractProse(tool.spend.summary, `${tool.name}.spend.summary`);
    if (typeof tool.asynchronous !== "boolean") throw new Error(`Invalid asynchronous flag for ${tool.name}`);
    if (!tool.inputSchema || typeof tool.inputSchema !== "object") throw new Error(`Missing input schema for ${tool.name}`);
    validateSchemaProse(tool.inputSchema, `${tool.name}.inputSchema`);
    try {
      assertSchemaWithinSynthesisBudgets(tool.inputSchema, tool.name);
      schemaValidator(tool.inputSchema);
    } catch (error) {
      if (error instanceof ExampleSynthesisError) throw error;
      throw new Error(`Invalid input schema for ${tool.name}: ${error.message}`, { cause: error });
    }

    const hasApiOperation = typeof tool.operationId === "string" && typeof tool.apiPage === "string";
    const hasNoApiOperation = tool.operationId === null && tool.apiPage === null;
    if (!hasApiOperation && !hasNoApiOperation) throw new Error(`Incomplete API mapping for ${tool.name}`);
    if (hasApiOperation && !/^[A-Za-z][A-Za-z0-9]*$/u.test(tool.operationId)) {
      throw new Error(`Invalid operation id grammar for ${tool.name}`);
    }
    if (
      hasApiOperation
      && !/^\/api-reference\/[a-z0-9][a-z0-9()-]*(?:\/[a-z0-9][a-z0-9()-]*)*$/u.test(tool.apiPage)
    ) {
      throw new Error(`Invalid API page route grammar for ${tool.name}`);
    }
    if (tool.spend.kind === "paid_export") {
      const confirmationField = tool.spend.confirmationField;
      if (confirmationField !== "confirm_credit_spend") {
        throw new Error(`Paid export ${tool.name} must declare confirm_credit_spend`);
      }
      if (tool.inputSchema.properties?.[confirmationField]?.type !== "boolean") {
        throw new Error(`Paid export ${tool.name} must expose a boolean confirm_credit_spend input`);
      }
    }
    names.add(tool.name);
    anchors.add(tool.anchor);
  }

  let lastCategory = -1;
  for (const tool of contract.tools) {
    const currentCategory = CATEGORY_GROUPS.findIndex(({ key }) => key === tool.category);
    if (currentCategory < lastCategory) throw new Error("MCP tools must preserve the approved category order");
    lastCategory = currentCategory;
  }
  for (const group of CATEGORY_GROUPS) {
    const count = contract.tools.filter(({ category }) => category === group.key).length;
    if (count !== group.count) throw new Error(`${group.title} must contain exactly ${group.count} tools`);
  }

  const apiMappedCount = contract.tools.filter(({ operationId }) => operationId !== null).length;
  if (apiMappedCount !== 15) throw new Error("Exactly 15 core MCP tools must map to the API reference");
}

function decodePointerSegment(value) {
  return value.replaceAll("~1", "/").replaceAll("~0", "~");
}

function resolveLocalReference(reference, rootSchema, toolName, path) {
  if (reference === "#") return rootSchema;
  if (!reference.startsWith("#/")) {
    throw new ExampleSynthesisError(toolName, path, `unsupported non-local schema reference ${reference}`);
  }
  let resolved = rootSchema;
  for (const segment of reference.slice(2).split("/").map(decodePointerSegment)) {
    if (!resolved || typeof resolved !== "object" || !Object.hasOwn(resolved, segment)) {
      throw new ExampleSynthesisError(toolName, path, `unresolvable schema reference ${reference}`);
    }
    resolved = resolved[segment];
  }
  return resolved;
}

const MAX_SYNTHESIS_CANDIDATES = 128;
const MAX_SYNTHESIS_RECURSION_DEPTH = 64;
const MAX_SYNTHESIS_REFERENCE_DEPTH = 32;
const MAX_SYNTHESIS_COMBINATOR_BRANCHES = 128;
const MAX_SYNTHESIS_ENUM_VALUES = 128;
const MAX_SYNTHESIS_ARRAY_ITEMS = 1_000;
const MAX_SYNTHESIS_STRING_LENGTH = 4_096;
const MAX_SYNTHESIS_SERIALIZED_BYTES = 16_384;
const MAX_SYNTHESIS_VISITED_SCHEMA_NODES = 4_096;
const MAX_SYNTHESIS_REFERENCE_EXPANSIONS = 256;
const MAX_SYNTHESIS_CANDIDATE_WORK = 65_536;
const MAX_SYNTHESIS_OUTPUT_STRUCTURE = 32_768;
const SCHEMA_ANNOTATION_KEYS = new Set([
  "$defs",
  "$id",
  "$schema",
  "definitions",
  "deprecated",
  "description",
  "examples",
  "example",
  "readOnly",
  "title",
  "writeOnly"
]);

function uniqueCandidates(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const key = JSON.stringify(value);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
    if (result.length >= MAX_SYNTHESIS_CANDIDATES) break;
  }
  return result;
}

function synthesisBudgetError(toolName, detail) {
  return new ExampleSynthesisError(toolName, "arguments", detail);
}

function consumeSynthesisBudget(context, key, limit, label, amount = 1) {
  context.synthesisBudget[key] += amount;
  if (context.synthesisBudget[key] > limit) {
    throw synthesisBudgetError(context.toolName, `${label} budget of ${limit} was exceeded`);
  }
}

function consumeCandidateWork(context, amount = 1) {
  consumeSynthesisBudget(context, "candidateWork", MAX_SYNTHESIS_CANDIDATE_WORK, "candidate work", amount);
}

function consumeReferenceExpansion(context) {
  consumeSynthesisBudget(
    context,
    "referenceExpansions",
    MAX_SYNTHESIS_REFERENCE_EXPANSIONS,
    "reference expansion"
  );
}

function consumeOutputStructure(context, amount = 1) {
  consumeSynthesisBudget(
    context,
    "outputStructure",
    MAX_SYNTHESIS_OUTPUT_STRUCTURE,
    "output structure",
    amount
  );
}

function cloneCandidate(value, context) {
  const pending = [value];
  while (pending.length > 0) {
    const entry = pending.pop();
    consumeOutputStructure(context);
    if (entry && typeof entry === "object") pending.push(...Object.values(entry));
  }
  return clone(value);
}

function candidateStructureUnits(value) {
  let units = 0;
  const pending = [value];
  while (pending.length > 0) {
    const entry = pending.pop();
    units += 1;
    if (units > MAX_SYNTHESIS_OUTPUT_STRUCTURE) return units;
    if (entry && typeof entry === "object") pending.push(...Object.values(entry));
  }
  return units;
}

function assertSchemaWithinSynthesisBudgets(rootSchema, toolName) {
  let visitedNodes = 0;
  let referenceExpansions = 0;

  function visit(value, depth) {
    if (!value || typeof value !== "object") return;
    if (depth > MAX_SYNTHESIS_RECURSION_DEPTH) {
      throw synthesisBudgetError(toolName, `recursion depth budget of ${MAX_SYNTHESIS_RECURSION_DEPTH} was exceeded`);
    }
    visitedNodes += 1;
    if (visitedNodes > MAX_SYNTHESIS_VISITED_SCHEMA_NODES) {
      throw synthesisBudgetError(
        toolName,
        `visited schema node budget of ${MAX_SYNTHESIS_VISITED_SCHEMA_NODES} was exceeded`
      );
    }
    if (Array.isArray(value)) {
      for (const child of value) visit(child, depth + 1);
      return;
    }

    if (Number.isInteger(value.minItems) && value.minItems > MAX_SYNTHESIS_ARRAY_ITEMS) {
      throw synthesisBudgetError(toolName, `array item budget of ${MAX_SYNTHESIS_ARRAY_ITEMS} was exceeded`);
    }
    if (
      (Number.isInteger(value.minLength) && value.minLength > MAX_SYNTHESIS_STRING_LENGTH)
      || (Number.isInteger(value.maxLength) && value.maxLength > MAX_SYNTHESIS_STRING_LENGTH)
    ) {
      throw synthesisBudgetError(toolName, `string length budget of ${MAX_SYNTHESIS_STRING_LENGTH} was exceeded`);
    }
    if (typeof value.const === "string" && value.const.length > MAX_SYNTHESIS_STRING_LENGTH) {
      throw synthesisBudgetError(toolName, `string length budget of ${MAX_SYNTHESIS_STRING_LENGTH} was exceeded`);
    }
    if (Array.isArray(value.enum)) {
      if (value.enum.length > MAX_SYNTHESIS_ENUM_VALUES) {
        throw synthesisBudgetError(toolName, `enum value budget of ${MAX_SYNTHESIS_ENUM_VALUES} was exceeded`);
      }
      if (value.enum.some((entry) => typeof entry === "string" && entry.length > MAX_SYNTHESIS_STRING_LENGTH)) {
        throw synthesisBudgetError(toolName, `string length budget of ${MAX_SYNTHESIS_STRING_LENGTH} was exceeded`);
      }
    }
    for (const keyword of ["allOf", "anyOf", "oneOf"]) {
      if (Array.isArray(value[keyword]) && value[keyword].length > MAX_SYNTHESIS_COMBINATOR_BRANCHES) {
        throw synthesisBudgetError(
          toolName,
          `combinator branch budget of ${MAX_SYNTHESIS_COMBINATOR_BRANCHES} was exceeded`
        );
      }
    }
    for (const child of Object.values(value)) visit(child, depth + 1);
  }

  visit(rootSchema, 0);

  function visitReferences(value, referenceStack = new Set()) {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const child of value) visitReferences(child, referenceStack);
      return;
    }
    if (typeof value.$ref === "string") {
      referenceExpansions += 1;
      if (referenceExpansions > MAX_SYNTHESIS_REFERENCE_EXPANSIONS) {
        throw synthesisBudgetError(
          toolName,
          `reference expansion budget of ${MAX_SYNTHESIS_REFERENCE_EXPANSIONS} was exceeded`
        );
      }
      if (referenceStack.has(value.$ref)) {
        throw new ExampleSynthesisError(
          toolName,
          "arguments",
          `recursive schema reference ${value.$ref} cannot be synthesized`
        );
      }
      if (referenceStack.size >= MAX_SYNTHESIS_REFERENCE_DEPTH) {
        throw synthesisBudgetError(
          toolName,
          `reference depth budget of ${MAX_SYNTHESIS_REFERENCE_DEPTH} was exceeded`
        );
      }
      const nextStack = new Set([...referenceStack, value.$ref]);
      visitReferences(resolveLocalReference(value.$ref, rootSchema, toolName, "arguments"), nextStack);
    }
    for (const [key, child] of Object.entries(value)) {
      if (key !== "$ref") visitReferences(child, referenceStack);
    }
  }

  visitReferences(rootSchema);
}

function assertSerializedExampleWithinBudget(value, toolName) {
  let bytes = 0;
  const add = (count) => {
    bytes += count;
    if (bytes > MAX_SYNTHESIS_SERIALIZED_BYTES) {
      throw synthesisBudgetError(
        toolName,
        `serialized example byte budget of ${MAX_SYNTHESIS_SERIALIZED_BYTES} was exceeded`
      );
    }
  };
  const visit = (entry) => {
    if (Array.isArray(entry)) {
      add(2 + Math.max(0, entry.length - 1));
      for (const child of entry) visit(child);
      return;
    }
    if (entry && typeof entry === "object") {
      const properties = Object.entries(entry);
      add(2 + Math.max(0, properties.length - 1));
      for (const [key, child] of properties) {
        add(Buffer.byteLength(JSON.stringify(key), "utf8") + 1);
        visit(child);
      }
      return;
    }
    add(Buffer.byteLength(JSON.stringify(entry), "utf8"));
  };
  visit(value);
}

function assertionSiblings(schema, omittedKeyword) {
  return Object.fromEntries(Object.entries(schema).filter(([key]) => (
    key !== omittedKeyword && !SCHEMA_ANNOTATION_KEYS.has(key)
  )));
}

function hasAssertions(schema) {
  return Object.keys(schema).length > 0;
}

function withAbsoluteLocalReferences(value, rootSchemaId) {
  if (Array.isArray(value)) return value.map((child) => withAbsoluteLocalReferences(child, rootSchemaId));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [
    key,
    key === "$ref" && typeof child === "string" && child.startsWith("#")
      ? `${rootSchemaId}${child}`
      : withAbsoluteLocalReferences(child, rootSchemaId)
  ]));
}

function candidateValidator(schema, context) {
  if (schema === true) return () => true;
  if (schema === false) return () => false;
  const cached = context.validatorCache.get(schema);
  if (cached) return cached;
  const validate = schema === context.rootSchema
    ? context.ajv.getSchema(context.rootSchemaId)
    : context.ajv.compile(withAbsoluteLocalReferences(schema, context.rootSchemaId));
  if (!validate) throw new Error(`registered root schema is unavailable at ${context.rootSchemaId}`);
  context.validatorCache.set(schema, validate);
  return validate;
}

function validCandidateValues(schema, context) {
  const validate = candidateValidator(schema, context);
  const candidates = candidateValues(schema, context);
  consumeCandidateWork(context, candidates.length);
  return candidates.filter((candidate) => validate(candidate));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cartesianMergeObjects(pools, context) {
  let combinations = [{}];
  let sawObjectPool = false;
  for (const pool of pools) {
    const objects = pool.filter(isPlainObject);
    if (objects.length === 0) continue;
    sawObjectPool = true;
    const next = [];
    for (const combination of combinations) {
      for (const object of objects) {
        consumeCandidateWork(context);
        consumeOutputStructure(context);
        next.push({ ...combination, ...object });
        if (next.length >= MAX_SYNTHESIS_CANDIDATES) break;
      }
      if (next.length >= MAX_SYNTHESIS_CANDIDATES) break;
    }
    combinations = next;
  }
  return sawObjectPool ? combinations : [];
}

function conjunctiveCandidates(schemas, context) {
  const pools = schemas.map((schema) => validCandidateValues(schema, context));
  return uniqueCandidates([
    ...cartesianMergeObjects(pools, context),
    ...numericIntersectionCandidates(schemas, context),
    ...pools.flat()
  ]);
}

function collectConjunctiveAssertions(schema, context, referenceStack = new Set(), assertions = []) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return assertions;
  if (assertions.length >= MAX_SYNTHESIS_CANDIDATES) return assertions;
  if (schema.$ref) {
    if (referenceStack.has(schema.$ref)) {
      throw new ExampleSynthesisError(
        context.toolName,
        context.path.join("."),
        `recursive schema reference ${schema.$ref} cannot be synthesized`
      );
    }
    const nextStack = new Set([...referenceStack, schema.$ref]);
    collectConjunctiveAssertions(
      resolveLocalReference(schema.$ref, context.rootSchema, context.toolName, context.path.join(".")),
      context,
      nextStack,
      assertions
    );
    const siblings = assertionSiblings(schema, "$ref");
    if (hasAssertions(siblings)) collectConjunctiveAssertions(siblings, context, nextStack, assertions);
    return assertions;
  }
  if (Array.isArray(schema.allOf)) {
    for (const branch of schema.allOf) {
      collectConjunctiveAssertions(branch, context, referenceStack, assertions);
      if (assertions.length >= MAX_SYNTHESIS_CANDIDATES) break;
    }
    const siblings = assertionSiblings(schema, "allOf");
    if (hasAssertions(siblings)) collectConjunctiveAssertions(siblings, context, referenceStack, assertions);
    return assertions;
  }
  assertions.push(schema);
  return assertions;
}

function strongerLowerBound(current, value, exclusive) {
  if (!Number.isFinite(value)) return current;
  if (!current || value > current.value || (value === current.value && exclusive && !current.exclusive)) {
    return { value, exclusive };
  }
  return current;
}

function strongerUpperBound(current, value, exclusive) {
  if (!Number.isFinite(value)) return current;
  if (!current || value < current.value || (value === current.value && exclusive && !current.exclusive)) {
    return { value, exclusive };
  }
  return current;
}

function numericIntersectionCandidates(schemas, context) {
  const assertions = schemas.flatMap((schema) => collectConjunctiveAssertions(schema, context));
  const numericAssertions = assertions.filter(schemaLooksNumeric);
  if (numericAssertions.length === 0) return [];

  let lower;
  let upper;
  let integer = false;
  const multiples = [];
  for (const schema of numericAssertions) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (types.includes("integer")) integer = true;
    lower = strongerLowerBound(lower, schema.minimum, false);
    lower = strongerLowerBound(lower, schema.exclusiveMinimum, true);
    upper = strongerUpperBound(upper, schema.maximum, false);
    upper = strongerUpperBound(upper, schema.exclusiveMaximum, true);
    if (Number.isFinite(schema.multipleOf) && schema.multipleOf > 0 && !multiples.includes(schema.multipleOf)) {
      multiples.push(schema.multipleOf);
    }
  }

  const intersection = { type: integer ? "integer" : "number" };
  if (lower) intersection[lower.exclusive ? "exclusiveMinimum" : "minimum"] = lower.value;
  if (upper) intersection[upper.exclusive ? "exclusiveMaximum" : "maximum"] = upper.value;
  return uniqueCandidates([
    ...numericCandidates(intersection, integer),
    ...multiples.flatMap((multipleOf) => numericCandidates({ ...intersection, multipleOf }, integer))
  ]);
}

function preferredString(path, schema) {
  const key = path.at(-1)?.toLowerCase() ?? "";
  if (schema.format === "email" || key === "email") return "person@example.com";
  if (schema.format === "uri" || schema.format === "url" || key.includes("webhook_url")) {
    return "https://hooks.example.com/airscale";
  }
  if (schema.format === "hostname" || key === "domain" || key.endsWith("_domain")) return "example.com";
  if (schema.format === "date") return "2026-01-01";
  if (schema.format === "date-time") return "2026-01-01T00:00:00Z";
  if (schema.format === "uuid") return "00000000-0000-4000-8000-000000000000";
  if (key.includes("linkedin") && key.includes("url")) return "https://www.linkedin.com/in/example-person-000000";
  if (key.includes("phone")) return "+12025550147";
  if (key === "prompt") return "Research Example Company using public sources.";
  if (key === "first_name") return "Example";
  if (key === "last_name") return "Person";
  if (key === "company_name") return "Example Company";
  if (key === "q") return "ex";
  if (key.endsWith("_id")) return `example-${key.replaceAll("_", "-")}`;
  return "example";
}

function fitStringBounds(value, schema) {
  let fitted = value;
  const minimum = schema.minLength ?? 0;
  const maximum = schema.maxLength ?? Number.POSITIVE_INFINITY;
  if (minimum > maximum) return fitted;
  if (fitted.length < minimum) fitted += "x".repeat(minimum - fitted.length);
  if (fitted.length > maximum) fitted = fitted.slice(0, maximum);
  return fitted;
}

function numericValue(schema, integer) {
  let value = schema.minimum ?? 0;
  if (schema.exclusiveMinimum !== undefined) {
    value = Math.max(value, schema.exclusiveMinimum + (integer ? 1 : Number.EPSILON));
  }
  if (integer) value = Math.ceil(value);
  return value;
}

function numericCandidates(schema, integer) {
  const step = 1;
  const candidates = [numericValue(schema, integer)];
  if (schema.minimum !== undefined) candidates.push(schema.minimum, schema.minimum + step);
  if (schema.exclusiveMinimum !== undefined) candidates.push(schema.exclusiveMinimum, schema.exclusiveMinimum + step);
  if (schema.maximum !== undefined) candidates.push(schema.maximum, schema.maximum - step, schema.maximum + step);
  if (schema.exclusiveMaximum !== undefined) {
    candidates.push(schema.exclusiveMaximum, schema.exclusiveMaximum - step, schema.exclusiveMaximum + step);
  }
  if (Number.isFinite(schema.multipleOf) && schema.multipleOf > 0) {
    const lower = schema.exclusiveMinimum ?? schema.minimum ?? 0;
    let nearest = Math.ceil(lower / schema.multipleOf) * schema.multipleOf;
    if (schema.exclusiveMinimum !== undefined && nearest <= schema.exclusiveMinimum) nearest += schema.multipleOf;
    candidates.push(nearest, nearest + schema.multipleOf);
    const upper = schema.exclusiveMaximum ?? schema.maximum;
    if (Number.isFinite(upper)) {
      let nearestBelow = Math.floor(upper / schema.multipleOf) * schema.multipleOf;
      if (schema.exclusiveMaximum !== undefined && nearestBelow >= schema.exclusiveMaximum) {
        nearestBelow -= schema.multipleOf;
      }
      candidates.push(nearestBelow, nearestBelow - schema.multipleOf);
    }
  }
  candidates.push(0, 1, -1);
  return uniqueCandidates(candidates
    .filter(Number.isFinite)
    .map((value) => integer ? Math.trunc(value) : value));
}

function stringCandidates(schema, path) {
  const preferred = fitStringBounds(preferredString(path, schema), schema);
  const candidates = [preferred];
  if (schema.minLength !== undefined) {
    candidates.push("x".repeat(schema.minLength));
    candidates.push("x".repeat(schema.minLength + 1));
  }
  if (schema.maxLength !== undefined && Number.isFinite(schema.maxLength)) {
    candidates.push("x".repeat(schema.maxLength));
    if (schema.maxLength > 0) candidates.push("x".repeat(schema.maxLength - 1));
  }
  candidates.push("example", "x", "");
  return uniqueCandidates(candidates.map((value) => fitStringBounds(value, schema)));
}

function schemaLooksObjectLike(schema) {
  return schema?.type === "object" || schema?.properties || schema?.required || schema?.minProperties || schema?.maxProperties;
}

function schemaLooksArrayLike(schema) {
  return schema?.type === "array" || schema?.items || schema?.minItems || schema?.maxItems;
}

function schemaLooksNumeric(schema) {
  return schema?.type === "integer"
    || schema?.type === "number"
    || schema?.minimum !== undefined
    || schema?.maximum !== undefined
    || schema?.exclusiveMinimum !== undefined
    || schema?.exclusiveMaximum !== undefined
    || schema?.multipleOf !== undefined;
}

function schemaLooksStringLike(schema) {
  return schema?.type === "string"
    || schema?.minLength !== undefined
    || schema?.maxLength !== undefined
    || schema?.pattern !== undefined
    || schema?.format !== undefined;
}

function objectCandidates(schema, context) {
  const { rootSchema, toolName, path, preferNonEmpty = false } = context;
  const properties = schema.properties ?? {};
  const selected = [...(schema.required ?? [])];
  const minimumPropertyCount = schema.minProperties ?? 0;
  const descriptionRequiresOne = /at least one[^.]*required/i.test(schema.description ?? "");
  const desiredCount = Math.max(minimumPropertyCount, descriptionRequiresOne || preferNonEmpty ? 1 : 0);
  for (const property of Object.keys(properties)) {
    if (selected.length >= desiredCount) break;
    if (!selected.includes(property)) selected.push(property);
  }

  let candidates = [{}];
  for (const property of selected) {
    if (!Object.hasOwn(properties, property)) {
      throw new ExampleSynthesisError(toolName, [...path, property].join("."), "required property has no schema");
    }
    const propertyCandidates = validCandidateValues(properties[property], {
      ...context,
      rootSchema,
      toolName,
      path: [...path, property],
      preferNonEmpty: true
    });
    if (propertyCandidates.length === 0) return [];
    const next = [];
    for (const candidate of candidates) {
      for (const propertyCandidate of propertyCandidates) {
        consumeCandidateWork(context);
        consumeOutputStructure(context);
        next.push({ ...candidate, [property]: cloneCandidate(propertyCandidate, context) });
        if (next.length >= MAX_SYNTHESIS_CANDIDATES) break;
      }
      if (next.length >= MAX_SYNTHESIS_CANDIDATES) break;
    }
    candidates = next;
  }
  return candidates;
}

function arrayCandidates(schema, context) {
  const { preferNonEmpty = false, path } = context;
  const preferredCount = schema.minItems ?? (preferNonEmpty ? 1 : 0);
  const counts = uniqueCandidates([
    preferredCount,
    schema.minItems,
    preferNonEmpty ? 1 : 0,
    0,
    1,
    schema.maxItems
  ].filter((value) => Number.isInteger(value) && value >= 0));
  const results = [];
  for (const count of counts) {
    if (count > MAX_SYNTHESIS_ARRAY_ITEMS) {
      throw synthesisBudgetError(context.toolName, `array item budget of ${MAX_SYNTHESIS_ARRAY_ITEMS} was exceeded`);
    }
    if (count === 0) {
      results.push([]);
      continue;
    }
    if (schema.items === undefined) continue;
    const itemCandidates = validCandidateValues(schema.items, {
      ...context,
      path: [...path, "0"],
      preferNonEmpty: true
    });
    if (itemCandidates.length === 0) continue;
    const variants = Math.min(itemCandidates.length, 4);
    for (let offset = 0; offset < variants; offset += 1) {
      consumeCandidateWork(context, count + 1);
      let materializedUnits = 1;
      for (let index = 0; index < count; index += 1) {
        const item = itemCandidates[schema.uniqueItems ? (index + offset) % itemCandidates.length : offset];
        materializedUnits += candidateStructureUnits(item);
        if (context.synthesisBudget.outputStructure + materializedUnits > MAX_SYNTHESIS_OUTPUT_STRUCTURE) {
          throw synthesisBudgetError(
            context.toolName,
            `output structure budget of ${MAX_SYNTHESIS_OUTPUT_STRUCTURE} would be exceeded before array materialization`
          );
        }
      }
      consumeOutputStructure(context, materializedUnits);
      results.push(Array.from({ length: count }, (_, index) => clone(
        itemCandidates[schema.uniqueItems ? (index + offset) % itemCandidates.length : offset]
      )));
      if (results.length >= MAX_SYNTHESIS_CANDIDATES) break;
    }
    if (results.length >= MAX_SYNTHESIS_CANDIDATES) break;
  }
  return uniqueCandidates(results);
}

function candidateValues(schema, context) {
  const { rootSchema, toolName, path } = context;
  consumeCandidateWork(context);
  if (schema === false) return [];
  if (schema === true) return [null, false, 0, "", [], {}];
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    throw new ExampleSynthesisError(toolName, path.join("."), "the schema is not an object or boolean schema");
  }

  if (Object.hasOwn(schema, "const")) return [cloneCandidate(schema.const, context)];
  if (Array.isArray(schema.enum)) {
    return uniqueCandidates(schema.enum.slice(0, MAX_SYNTHESIS_ENUM_VALUES).map((value) => cloneCandidate(value, context)));
  }
  if (schema.$ref) {
    consumeReferenceExpansion(context);
    if (context.referenceStack.has(schema.$ref)) {
      throw new ExampleSynthesisError(toolName, path.join("."), `recursive schema reference ${schema.$ref} cannot be synthesized`);
    }
    if (context.referenceStack.size >= MAX_SYNTHESIS_REFERENCE_DEPTH) {
      throw synthesisBudgetError(toolName, `reference depth budget of ${MAX_SYNTHESIS_REFERENCE_DEPTH} was exceeded`);
    }
    const resolved = resolveLocalReference(schema.$ref, rootSchema, toolName, path.join("."));
    const siblings = assertionSiblings(schema, "$ref");
    const nextContext = { ...context, referenceStack: new Set([...context.referenceStack, schema.$ref]) };
    return hasAssertions(siblings)
      ? conjunctiveCandidates([resolved, siblings], nextContext)
      : validCandidateValues(resolved, nextContext);
  }
  if (Array.isArray(schema.allOf)) {
    const siblings = assertionSiblings(schema, "allOf");
    return conjunctiveCandidates([
      ...schema.allOf,
      ...(hasAssertions(siblings) ? [siblings] : [])
    ], context);
  }
  for (const keyword of ["anyOf", "oneOf"]) {
    if (!Array.isArray(schema[keyword])) continue;
    const siblings = assertionSiblings(schema, keyword);
    const candidates = [];
    for (const branch of schema[keyword]) {
      const combined = hasAssertions(siblings) ? { allOf: [branch, siblings] } : branch;
      candidates.push(...validCandidateValues(combined, context));
      if (keyword === "oneOf") candidates.push(...candidateValues(combined, context));
    }
    return uniqueCandidates(candidates);
  }

  const declaredTypes = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  const inferredType = schemaLooksObjectLike(schema)
    ? "object"
    : schemaLooksArrayLike(schema)
      ? "array"
      : schemaLooksNumeric(schema)
        ? "number"
        : schemaLooksStringLike(schema)
          ? "string"
          : undefined;
  const types = uniqueCandidates([
    ...declaredTypes.filter((candidate) => candidate !== "null"),
    ...declaredTypes.filter((candidate) => candidate === "null"),
    inferredType
  ].filter(Boolean));
  const candidates = [];
  for (const type of types) {
    if (type === "object") candidates.push(...objectCandidates(schema, context));
    else if (type === "array") candidates.push(...arrayCandidates(schema, context));
    else if (type === "string") candidates.push(...stringCandidates(schema, path));
    else if (type === "integer") candidates.push(...numericCandidates(schema, true));
    else if (type === "number") candidates.push(...numericCandidates(schema, false));
    else if (type === "boolean") candidates.push(false, true);
    else if (type === "null") candidates.push(null);
  }
  if (types.length === 0) candidates.push(null, false, 0, 1, "example", "", [], {});
  return uniqueCandidates(candidates);
}

function synthesizeValue(schema, context) {
  const candidates = validCandidateValues(schema, context);
  if (candidates.length > 0) return cloneCandidate(candidates[0], context);
  throw new ExampleSynthesisError(
    context.toolName,
    context.path.join("."),
    "no deterministic candidate satisfies the complete schema"
  );
}

function synthesizeArguments(tool) {
  let argumentsValue;
  try {
    assertSchemaWithinSynthesisBudgets(tool.inputSchema, tool.name);
    if (Object.hasOwn(SAFE_EXAMPLE_ARGUMENTS, tool.name)) {
      argumentsValue = clone(SAFE_EXAMPLE_ARGUMENTS[tool.name]);
    } else {
      const ajv = new Ajv2020({ strict: false });
      addFormats(ajv);
      const rootSchemaId = `https://airscale.example/mcp-input/${encodeURIComponent(tool.name)}`;
      ajv.addSchema(clone(tool.inputSchema), rootSchemaId);
      argumentsValue = synthesizeValue(tool.inputSchema, {
        rootSchema: tool.inputSchema,
        toolName: tool.name,
        path: ["arguments"],
        preferNonEmpty: false,
        ajv,
        rootSchemaId,
        validatorCache: new WeakMap(),
        referenceStack: new Set(),
        synthesisBudget: {
          referenceExpansions: 0,
          candidateWork: 0,
          outputStructure: 0
        }
      });
    }
    if (!argumentsValue || typeof argumentsValue !== "object" || Array.isArray(argumentsValue)) {
      throw new ExampleSynthesisError(tool.name, "arguments", "the top-level tool input must synthesize to an object");
    }
    if (tool.spend.kind === "paid_export") {
      argumentsValue = { ...argumentsValue, [tool.spend.confirmationField]: true };
    }
    assertSerializedExampleWithinBudget(argumentsValue, tool.name);
    const validate = schemaValidator(tool.inputSchema);
    if (!validate(argumentsValue)) {
      throw new ExampleSynthesisError(tool.name, "arguments", `generated value fails the input schema: ${JSON.stringify(validate.errors)}`);
    }
    return argumentsValue;
  } catch (error) {
    if (error instanceof ExampleSynthesisError) throw error;
    throw new ExampleSynthesisError(tool.name, "arguments", error.message, { cause: error });
  }
}

function strongerDisplayBound(left, right, direction) {
  if (!left) return right;
  if (!right) return left;
  if (direction === "lower") {
    if (right.value > left.value || (right.value === left.value && right.exclusive)) return right;
    return left;
  }
  if (right.value < left.value || (right.value === left.value && right.exclusive)) return right;
  return left;
}

function displayBound(schema, inclusiveKey, exclusiveKey) {
  let result;
  if (Number.isFinite(schema?.[inclusiveKey])) result = { value: schema[inclusiveKey], exclusive: false };
  if (Number.isFinite(schema?.[exclusiveKey])) {
    result = strongerDisplayBound(
      result,
      { value: schema[exclusiveKey], exclusive: true },
      inclusiveKey.startsWith("min") ? "lower" : "upper"
    );
  }
  return result;
}

const DISPLAY_PATTERNS_KEY = "$airscaleDisplayPatterns";
const DISPLAY_FORMATS_KEY = "$airscaleDisplayFormats";
const DISPLAY_MULTIPLES_KEY = "$airscaleDisplayMultiples";

function uniqueDisplayValues(values) {
  const result = [];
  for (const value of values) {
    if (!result.some((existing) => isDeepStrictEqual(existing, value))) result.push(clone(value));
  }
  return result;
}

function displayTypes(schema) {
  if (schema?.type === undefined) return null;
  return Array.isArray(schema.type) ? schema.type : [schema.type];
}

function intersectDisplayTypes(left, right) {
  const leftTypes = displayTypes(left);
  const rightTypes = displayTypes(right);
  if (!leftTypes) return rightTypes;
  if (!rightTypes) return leftTypes;
  const intersection = [];
  for (const leftType of leftTypes) {
    for (const rightType of rightTypes) {
      if (leftType === rightType) intersection.push(leftType);
      else if (
        (leftType === "number" && rightType === "integer")
        || (leftType === "integer" && rightType === "number")
      ) intersection.push("integer");
    }
  }
  return uniqueDisplayValues(intersection);
}

function valueMatchesDisplayTypes(value, types) {
  if (!types) return true;
  return types.some((type) => {
    if (type === "null") return value === null;
    if (type === "array") return Array.isArray(value);
    if (type === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
    if (type === "integer") return Number.isInteger(value);
    if (type === "number") return typeof value === "number" && Number.isFinite(value);
    return typeof value === type;
  });
}

function allowedDisplayValues(schema) {
  if (Object.hasOwn(schema, "const")) return [schema.const];
  return Array.isArray(schema.enum) ? schema.enum : null;
}

function conjoinedDisplayValues(schema, keyword, displayKey) {
  return uniqueDisplayValues([
    ...(Array.isArray(schema?.[displayKey]) ? schema[displayKey] : []),
    ...(schema?.[keyword] === undefined ? [] : [schema[keyword]])
  ]);
}

function mergeLosslessDisplayKeyword(merged, left, right, keyword, displayKey) {
  const values = uniqueDisplayValues([
    ...conjoinedDisplayValues(left, keyword, displayKey),
    ...conjoinedDisplayValues(right, keyword, displayKey)
  ]);
  delete merged[keyword];
  delete merged[displayKey];
  if (values.length === 1) merged[keyword] = values[0];
  else if (values.length > 1) merged[displayKey] = values;
}

function mergeDisplaySchemas(left, right) {
  if (left === false || right === false) return false;
  if (left === true) return clone(right);
  if (right === true) return clone(left);
  if (!left || typeof left !== "object") return clone(right);
  if (!right || typeof right !== "object") return clone(left);

  const merged = { ...clone(left), ...clone(right) };
  delete merged.$ref;
  delete merged.allOf;

  const types = intersectDisplayTypes(left, right);
  delete merged.type;
  if (types?.length === 0) return false;
  if (types?.length === 1) merged.type = types[0];
  else if (types) merged.type = types;

  const leftAllowed = allowedDisplayValues(left);
  const rightAllowed = allowedDisplayValues(right);
  let allowed = leftAllowed ?? rightAllowed;
  if (leftAllowed && rightAllowed) {
    allowed = leftAllowed.filter((leftValue) => (
      rightAllowed.some((rightValue) => isDeepStrictEqual(leftValue, rightValue))
    ));
  }
  if (allowed) allowed = uniqueDisplayValues(allowed.filter((value) => valueMatchesDisplayTypes(value, types)));
  delete merged.const;
  delete merged.enum;
  if (allowed?.length === 0) return false;
  if (allowed) {
    const constConjunction = Object.hasOwn(left, "const") || Object.hasOwn(right, "const");
    if (constConjunction && allowed.length === 1) merged.const = allowed[0];
    else merged.enum = allowed;
  }

  mergeLosslessDisplayKeyword(merged, left, right, "pattern", DISPLAY_PATTERNS_KEY);
  mergeLosslessDisplayKeyword(merged, left, right, "format", DISPLAY_FORMATS_KEY);
  mergeLosslessDisplayKeyword(merged, left, right, "multipleOf", DISPLAY_MULTIPLES_KEY);

  const propertyNames = [...new Set([
    ...Object.keys(left.properties ?? {}),
    ...Object.keys(right.properties ?? {})
  ])];
  if (propertyNames.length > 0) {
    merged.properties = Object.fromEntries(propertyNames.map((name) => [
      name,
      Object.hasOwn(left.properties ?? {}, name) && Object.hasOwn(right.properties ?? {}, name)
        ? mergeDisplaySchemas(left.properties[name], right.properties[name])
        : clone((right.properties ?? {})[name] ?? left.properties[name])
    ]));
  }
  const required = [...new Set([...(left.required ?? []), ...(right.required ?? [])])];
  if (required.length > 0) merged.required = required;

  const lower = strongerDisplayBound(
    displayBound(left, "minimum", "exclusiveMinimum"),
    displayBound(right, "minimum", "exclusiveMinimum"),
    "lower"
  );
  const upper = strongerDisplayBound(
    displayBound(left, "maximum", "exclusiveMaximum"),
    displayBound(right, "maximum", "exclusiveMaximum"),
    "upper"
  );
  delete merged.minimum;
  delete merged.exclusiveMinimum;
  delete merged.maximum;
  delete merged.exclusiveMaximum;
  if (lower) merged[lower.exclusive ? "exclusiveMinimum" : "minimum"] = lower.value;
  if (upper) merged[upper.exclusive ? "exclusiveMaximum" : "maximum"] = upper.value;

  for (const key of ["minLength", "minItems", "minProperties"]) {
    const values = [left[key], right[key]].filter(Number.isFinite);
    if (values.length > 0) merged[key] = Math.max(...values);
  }
  for (const key of ["maxLength", "maxItems", "maxProperties"]) {
    const values = [left[key], right[key]].filter(Number.isFinite);
    if (values.length > 0) merged[key] = Math.min(...values);
  }
  if (left.additionalProperties === false || right.additionalProperties === false) merged.additionalProperties = false;
  if (left.items && right.items) merged.items = mergeDisplaySchemas(left.items, right.items);
  return merged;
}

function normalizeSchemaForDisplay(schema, rootSchema, referenceStack = new Set()) {
  if (schema === true || schema === false || !schema || typeof schema !== "object" || Array.isArray(schema)) {
    return schema;
  }
  if (schema.$ref) {
    if (referenceStack.has(schema.$ref)) return { ...schema, $ref: undefined };
    const resolved = normalizeSchemaForDisplay(
      resolveLocalReference(schema.$ref, rootSchema, "catalog", "input table"),
      rootSchema,
      new Set([...referenceStack, schema.$ref])
    );
    const siblings = { ...schema };
    delete siblings.$ref;
    return mergeDisplaySchemas(resolved, normalizeSchemaForDisplay(siblings, rootSchema, referenceStack));
  }
  if (Array.isArray(schema.allOf)) {
    const siblings = { ...schema };
    delete siblings.allOf;
    return schema.allOf.reduce(
      (combined, branch) => mergeDisplaySchemas(
        combined,
        normalizeSchemaForDisplay(branch, rootSchema, referenceStack)
      ),
      normalizeSchemaForDisplay(siblings, rootSchema, referenceStack)
    );
  }
  return {
    ...schema,
    ...(schema.properties ? {
      properties: Object.fromEntries(Object.entries(schema.properties).map(([name, child]) => [
        name,
        normalizeSchemaForDisplay(child, rootSchema, referenceStack)
      ]))
    } : {}),
    ...(schema.items ? { items: normalizeSchemaForDisplay(schema.items, rootSchema, referenceStack) } : {}),
    ...(schema.anyOf ? {
      anyOf: schema.anyOf.map((branch) => normalizeSchemaForDisplay(branch, rootSchema, referenceStack))
    } : {}),
    ...(schema.oneOf ? {
      oneOf: schema.oneOf.map((branch) => normalizeSchemaForDisplay(branch, rootSchema, referenceStack))
    } : {})
  };
}

function describeType(schema, rootSchema) {
  if (schema === false) return "never";
  if (schema === true) return "any JSON value";
  schema = normalizeSchemaForDisplay(schema, rootSchema);
  if (Array.isArray(schema.anyOf) || Array.isArray(schema.oneOf)) {
    const branches = schema.anyOf ?? schema.oneOf;
    return [...new Set(branches.map((branch) => describeType(branch, rootSchema)))].join(" or ");
  }
  if (Array.isArray(schema.allOf)) {
    return [...new Set(schema.allOf.map((branch) => describeType(branch, rootSchema)))].join(" and ");
  }
  if (Array.isArray(schema.type)) return schema.type.join(" or ");
  if (schema.type === "array") return `array<${describeType(schema.items ?? true, rootSchema)}>`;
  if (schema.type) return schema.type;
  if (Object.hasOwn(schema, "const")) return schema.const === null ? "null" : typeof schema.const;
  if (schema.properties) return "object";
  return "any JSON value";
}

function codeList(values) {
  return values.map((value) => renderTableInlineCode(JSON.stringify(value))).join(", ");
}

function stringCodeList(values) {
  return values.map((value) => renderTableInlineCode(value)).join(", ");
}

function collectNestedRequirements(schema, rootSchema, prefix = "", seen = new Set()) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema) || seen.has(schema)) return [];
  schema = normalizeSchemaForDisplay(schema, rootSchema);
  seen.add(schema);
  const requirements = [];
  for (const property of schema.required ?? []) requirements.push(prefix ? `${prefix}.${property}` : property);
  for (const [property, child] of Object.entries(schema.properties ?? {})) {
    const childPrefix = prefix ? `${prefix}.${property}` : property;
    requirements.push(...collectNestedRequirements(child, rootSchema, childPrefix, seen));
  }
  if (schema.items) requirements.push(...collectNestedRequirements(schema.items, rootSchema, `${prefix}[]`, seen));
  for (const keyword of ["allOf", "anyOf", "oneOf"]) {
    for (const child of schema[keyword] ?? []) requirements.push(...collectNestedRequirements(child, rootSchema, prefix, seen));
  }
  return [...new Set(requirements)];
}

function describeConstraints(schema, rootSchema) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return "—";
  schema = normalizeSchemaForDisplay(schema, rootSchema);
  const constraints = [];
  const formats = conjoinedDisplayValues(schema, "format", DISPLAY_FORMATS_KEY);
  if (formats.length === 1) constraints.push(`format: ${renderTableInlineCode(formats[0])}`);
  else if (formats.length > 1) constraints.push(`formats: ${stringCodeList(formats)}`);
  if (Object.hasOwn(schema, "const")) {
    constraints.push(`must equal ${renderTableInlineCode(JSON.stringify(schema.const))}`);
  }
  if (schema.enum) constraints.push(`allowed values: ${codeList(schema.enum)}`);
  if (schema.minLength !== undefined) constraints.push(`minimum length: ${schema.minLength}`);
  if (schema.maxLength !== undefined) constraints.push(`maximum length: ${schema.maxLength}`);
  const patterns = conjoinedDisplayValues(schema, "pattern", DISPLAY_PATTERNS_KEY);
  if (patterns.length === 1) constraints.push(`pattern: ${renderTableInlineCode(patterns[0])}`);
  else if (patterns.length > 1) constraints.push(`patterns: ${stringCodeList(patterns)}`);
  if (schema.minimum !== undefined) constraints.push(`minimum: ${schema.minimum}`);
  if (schema.maximum !== undefined) constraints.push(`maximum: ${schema.maximum}`);
  if (schema.exclusiveMinimum !== undefined) constraints.push(`exclusive minimum: ${schema.exclusiveMinimum}`);
  if (schema.exclusiveMaximum !== undefined) constraints.push(`exclusive maximum: ${schema.exclusiveMaximum}`);
  const multiples = conjoinedDisplayValues(schema, "multipleOf", DISPLAY_MULTIPLES_KEY);
  if (multiples.length === 1) constraints.push(`multiple of: ${multiples[0]}`);
  else if (multiples.length > 1) constraints.push(`multiples of: ${multiples.join(", ")}`);
  if (schema.minItems !== undefined) constraints.push(`minimum items: ${schema.minItems}`);
  if (schema.maxItems !== undefined) constraints.push(`maximum items: ${schema.maxItems}`);
  if (schema.uniqueItems) constraints.push("items must be unique");
  if (schema.minProperties !== undefined) constraints.push(`minimum properties: ${schema.minProperties}`);
  const properties = Object.keys(schema.properties ?? {});
  if (properties.length > 0) {
    constraints.push(`allowed properties: ${properties.map((name) => renderTableInlineCode(name)).join(", ")}`);
  }
  const nestedRequirements = collectNestedRequirements(schema, rootSchema);
  if (nestedRequirements.length > 0) {
    constraints.push(
      `nested required fields: ${nestedRequirements.map((name) => renderTableInlineCode(name)).join(", ")}`
    );
  }
  if (schema.additionalProperties === false) constraints.push("additional properties are not allowed");
  if (schema.items) constraints.push(`item type: ${renderTableInlineCode(describeType(schema.items, rootSchema))}`);
  return constraints.join("; ") || "—";
}

function escapeMdxProse(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("{", "&#123;")
    .replaceAll("}", "&#125;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("[", "\\[")
    .replaceAll("]", "\\]");
}

function escapeTableValue(value, { inlineCode = false } = {}) {
  let escaped = "";
  for (const character of String(value)) {
    if (character === "\\") escaped += "\\\\";
    else if (character === "|") escaped += "\\|";
    else if (character === "\n" || character === "\r") escaped += " ";
    else if (!inlineCode && character === "&") escaped += "&amp;";
    else if (!inlineCode && character === "{") escaped += "&#123;";
    else if (!inlineCode && character === "}") escaped += "&#125;";
    else if (!inlineCode && character === "<") escaped += "&lt;";
    else if (!inlineCode && character === ">") escaped += "&gt;";
    else if (!inlineCode && character === "[") escaped += "\\[";
    else if (!inlineCode && character === "]") escaped += "\\]";
    else if (inlineCode && character === "`") escaped += "&#96;";
    else escaped += character;
  }
  return escaped;
}

function escapeTableCell(value) {
  return escapeTableValue(value);
}

function renderSafeCodeElement(content) {
  return `<code>${content
    .replaceAll("&", "&amp;")
    .replaceAll("\\", "&#92;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("{", "&#123;")
    .replaceAll("}", "&#125;")
    .replaceAll("|", "&#124;")}</code>`;
}

function hasOddBackslashRunBeforePipe(content) {
  for (let index = content.indexOf("|"); index !== -1; index = content.indexOf("|", index + 1)) {
    let backslashes = 0;
    for (let cursor = index - 1; cursor >= 0 && content[cursor] === "\\"; cursor -= 1) backslashes += 1;
    if (backslashes % 2 === 1) return true;
  }
  return false;
}

function renderTableInlineCode(value) {
  const content = String(value)
    .replaceAll("\n", " ")
    .replaceAll("\r", " ");
  // GFM consumes one backslash when a table pipe is escaped inside a code
  // span. An odd source run therefore cannot represent an odd original run
  // immediately before a pipe. Use a safe code element for that exact case.
  if (content === "" || /^\s+$/u.test(content) || hasOddBackslashRunBeforePipe(content)) {
    return renderSafeCodeElement(content);
  }
  const escapedContent = content.replaceAll("|", "\\|");
  const longestBacktickRun = Math.max(0, ...[...escapedContent.matchAll(/`+/gu)].map(([run]) => run.length));
  const fence = "`".repeat(longestBacktickRun + 1);
  const needsPadding = longestBacktickRun > 0 || /^\s|\s$/u.test(escapedContent);
  return needsPadding
    ? `${fence} ${escapedContent} ${fence}`
    : `${fence}${escapedContent}${fence}`;
}

function renderInputTable(tool) {
  const rows = ["| Field | Type | Required | Description | Constraints |", "| --- | --- | --- | --- | --- |"];
  const displaySchema = normalizeSchemaForDisplay(tool.inputSchema, tool.inputSchema);
  const properties = Object.entries(displaySchema.properties ?? {});
  if (properties.length === 0) {
    rows.push("| _No input fields_ | — | — | Pass an empty JSON object. | additional properties are not allowed |");
    return rows.join("\n");
  }
  const required = new Set(displaySchema.required ?? []);
  for (const [name, schema] of properties) {
    rows.push(`${[
      `| ${renderTableInlineCode(name)}`,
      renderTableInlineCode(describeType(schema, tool.inputSchema)),
      required.has(name) ? "Yes" : "No",
      escapeTableCell(schema.description ?? "No runtime description supplied."),
      describeConstraints(schema, tool.inputSchema)
    ].join(" | ")} |`);
  }
  return rows.join("\n");
}

function spendClassification(kind) {
  if (kind === "free") return "Free";
  if (kind === "variable") return "Variable credit cost";
  return "Paid export";
}

function renderToolBlock(tool) {
  const execution = tool.asynchronous ? "Asynchronous" : "Synchronous";
  const example = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: tool.name,
      arguments: synthesizeArguments(tool)
    }
  };
  const parts = [
    `<a id="${tool.anchor}"></a>`,
    `## \`${tool.name}\``,
    "**MCP tool**",
    escapeMdxProse(tool.description),
    `- **Category:** ${CATEGORY_TITLES.get(tool.category)}`,
    `- **Spend classification:** ${spendClassification(tool.spend.kind)}`,
    `- **Credit behavior:** ${escapeMdxProse(tool.spend.summary)}`,
    `- **Execution:** ${execution}`,
    "- **Authentication:** Uses the credentials configured on the MCP connection; never include an API key in tool arguments.",
    `<Note>\nCredit behavior: ${escapeMdxProse(tool.spend.summary)}.\n</Note>`
  ];

  if (tool.spend.kind === "paid_export") {
    parts.push(
      `<Warning>\nThis starts paid export work. Review the maximum possible credit spend, then set \`${tool.spend.confirmationField}: true\` only after approval.\n</Warning>`
    );
  }

  parts.push(
    "### Inputs",
    renderInputTable(tool),
    "### Minimal `tools/call` example",
    `\`\`\`json\n${JSON.stringify(example, null, 2)}\n\`\`\``,
    "### Expected result",
    RESULT_BEHAVIOR[tool.name] ?? "Returns the runtime MCP result for the supplied arguments."
  );

  if (tool.operationId !== null) {
    parts.push(`**Related API reference:** [${tool.operationId}](${tool.apiPage})`);
  }
  return parts.join("\n\n");
}

function renderCategorySummary(tools) {
  return [
    "| Tool | Purpose | Credit behavior | Execution |",
    "| --- | --- | --- | --- |",
    ...tools.map((tool) => `${[
      `| [\`${tool.name}\`](#${tool.anchor})`,
      escapeTableCell(tool.description),
      escapeTableCell(tool.spend.summary),
      tool.asynchronous ? "Async" : "Sync"
    ].join(" | ")} |`)
  ].join("\n");
}

export function renderCatalog(contract) {
  validateContract(contract);
  const sections = [
    "---\ntitle: \"MCP tool catalog\"\ndescription: \"Browse all 22 typed tools exposed by the Airscale MCP server.\"\ncanonical: \"https://airscale.mintlify.app/mcp/tools\"\n---",
    "Airscale MCP exposes 22 typed tools for workspace checks, search, enrichment, research, managed batches, and asynchronous exports.",
    "<Warning>\nReview each tool's credit behavior before approval. Paid export starts require `confirm_credit_spend: true`.\n</Warning>",
    "<Note>\nAuthenticate through the MCP connection. OAuth clients complete authentication in the browser; API keys never belong in tool arguments.\n</Note>"
  ];

  for (const group of CATEGORY_GROUPS) {
    const tools = contract.tools.filter(({ category }) => category === group.key);
    sections.push(`# ${group.title}\n\n${renderCategorySummary(tools)}`);
    for (const tool of tools) sections.push(renderToolBlock(tool));
  }
  return `${sections.join("\n\n").trimEnd()}\n`;
}

export function renderPublicManifest(contract) {
  validateContract(contract);
  const manifest = {
    schemaVersion: "1.0",
    name: "Airscale MCP tools",
    description: PUBLIC_DESCRIPTION,
    serverUrl: "https://mcp.airscale.io/mcp",
    toolCount: contract.tools.length,
    sourceSha: contract.sourceSha,
    tools: contract.tools.map((tool) => ({
      name: tool.name,
      anchor: tool.anchor,
      category: tool.category,
      description: tool.description,
      inputSchema: clone(tool.inputSchema),
      spend: clone(tool.spend),
      asynchronous: tool.asynchronous,
      operationId: tool.operationId,
      apiPage: tool.apiPage
    }))
  };
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function validateRenderedPair(contract, catalog, publicManifest) {
  for (const [label, contents] of [["MCP catalog", catalog], ["public MCP manifest", publicManifest]]) {
    if (typeof contents !== "string") throw new Error(`${label} renderer must return a string`);
    if (!contents.endsWith("\n") || contents.endsWith("\n\n")) throw new Error(`${label} must end with one final newline`);
    if (contents.includes("docs.airscale.io")) throw new Error(`${label} contains a forbidden legacy documentation link`);
  }
  for (const tool of contract.tools) {
    if (countOccurrences(catalog, `<a id="${tool.anchor}"></a>`) !== 1) throw new Error(`Rendered catalog anchor drift: ${tool.anchor}`);
    if (countOccurrences(catalog, `## \`${tool.name}\``) !== 1) throw new Error(`Rendered catalog heading drift: ${tool.name}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(publicManifest);
  } catch (error) {
    throw new Error(`Public MCP manifest is not valid JSON: ${error.message}`, { cause: error });
  }
  if (parsed.toolCount !== 22 || !Array.isArray(parsed.tools) || parsed.tools.length !== 22) {
    throw new Error("Public MCP manifest must contain exactly 22 tools");
  }
  if (Object.hasOwn(parsed, "sourceFiles") || Object.hasOwn(parsed, "sourceRepository")) {
    throw new Error("Public MCP manifest contains repository-only source metadata");
  }
  for (const [index, tool] of contract.tools.entries()) {
    const rendered = parsed.tools[index];
    if (rendered?.name !== tool.name || JSON.stringify(rendered.inputSchema) !== JSON.stringify(tool.inputSchema)) {
      throw new Error(`Public MCP manifest drift for ${tool.name}`);
    }
  }
}

function parseArguments(argv) {
  if (!Array.isArray(argv)) throw new Error("CLI arguments must be an array");
  let mode;
  const values = {};
  const seenOptions = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--write" || argument === "--check") {
      if (mode) throw new Error("Choose exactly one mode: --write or --check");
      mode = argument;
      continue;
    }
    if (["--contract", "--catalog", "--public"].includes(argument)) {
      if (seenOptions.has(argument)) throw new Error(`Duplicate option: ${argument}`);
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for ${argument}`);
      values[argument.slice(2)] = value;
      seenOptions.add(argument);
      index += 1;
      continue;
    }
    if (typeof argument === "string" && argument.startsWith("--")) throw new Error(`Unknown option: ${argument}`);
    throw new Error(`Unexpected trailing argument: ${argument}`);
  }
  if (!mode) throw new Error("Expected exactly one mode: --write or --check");
  return { mode, ...values };
}

function canonicalPath(path, io) {
  const absolute = resolve(path);
  if (io.existsSync(absolute)) return io.realpathSync(absolute);
  let existingParent = dirname(absolute);
  while (!io.existsSync(existingParent)) {
    const nextParent = dirname(existingParent);
    if (nextParent === existingParent) return absolute;
    existingParent = nextParent;
  }
  return join(io.realpathSync(existingParent), relative(existingParent, absolute));
}

function sameExistingFile(left, right, io) {
  if (!io.existsSync(left) || !io.existsSync(right)) return false;
  const leftStat = io.statSync(left);
  const rightStat = io.statSync(right);
  return leftStat.dev === rightStat.dev && leftStat.ino === rightStat.ino;
}

function isDescendantPath(candidate, parent) {
  const pathFromParent = relative(parent, candidate);
  return pathFromParent !== ""
    && pathFromParent !== ".."
    && !pathFromParent.startsWith(`..${sep}`)
    && !isAbsolute(pathFromParent);
}

function validateTargetPaths(paths, io) {
  const contractPath = resolve(paths.contractPath);
  const catalogPath = resolve(paths.catalogPath);
  const publicPath = resolve(paths.publicPath);
  for (const [label, path] of [["catalog", catalogPath], ["public manifest", publicPath]]) {
    if (!io.existsSync(path)) continue;
    if (io.lstatSync(path).isSymbolicLink()) throw new Error(`Unsafe ${label} output target: symbolic links are not allowed`);
    if (!io.statSync(path).isFile()) throw new Error(`Unsafe ${label} output target: expected a regular file`);
  }

  const catalogIdentity = canonicalPath(catalogPath, io);
  const publicIdentity = canonicalPath(publicPath, io);
  const contractIdentity = canonicalPath(contractPath, io);
  if (catalogIdentity === publicIdentity || sameExistingFile(catalogPath, publicPath, io)) {
    throw new Error("Unsafe output targets: catalog and public manifest paths must be different files");
  }
  if (isDescendantPath(catalogIdentity, publicIdentity) || isDescendantPath(publicIdentity, catalogIdentity)) {
    throw new Error("Unsafe output targets: catalog and public manifest paths must not contain one another");
  }
  if (
    isGeneratedPairReservedPath(catalogIdentity, publicIdentity)
    || isGeneratedPairReservedPath(publicIdentity, catalogIdentity)
  ) {
    throw new Error("Unsafe output targets: outputs must not occupy each other's reserved transaction namespace");
  }
  if (catalogIdentity === contractIdentity || sameExistingFile(catalogPath, contractPath, io)) {
    throw new Error("Unsafe catalog output target: it would overwrite the source contract");
  }
  if (publicIdentity === contractIdentity || sameExistingFile(publicPath, contractPath, io)) {
    throw new Error("Unsafe public manifest output target: it would overwrite the source contract");
  }
  return { contractPath, catalogPath, publicPath };
}

function bytesMatch(contents, artifact) {
  const bytes = Buffer.isBuffer(artifact) ? artifact : Buffer.from(artifact);
  return bytes.equals(Buffer.from(contents, "utf8"));
}

export async function run(argv, dependencies = {}) {
  const parsed = parseArguments(argv);
  const io = { ...defaultFileIO, ...(dependencies.fsImpl ?? {}) };
  let paths = validateTargetPaths({
    contractPath: parsed.contract ?? DEFAULT_CONTRACT_PATH,
    catalogPath: parsed.catalog ?? DEFAULT_CATALOG_PATH,
    publicPath: parsed.public ?? DEFAULT_PUBLIC_PATH
  }, io);
  if (parsed.mode === "--check") {
    assertNoWriterLockForCheck([paths.catalogPath, paths.publicPath], io);
    assertNoIncompleteTransactionForCheck([paths.catalogPath, paths.publicPath], io);
    const contract = JSON.parse(io.readFileSync(paths.contractPath, "utf8"));
    const catalog = (dependencies.renderCatalogImpl ?? renderCatalog)(contract);
    const publicManifest = (dependencies.renderPublicManifestImpl ?? renderPublicManifest)(contract);
    validateRenderedPair(contract, catalog, publicManifest);
    paths = validateTargetPaths(paths, io);
    assertNoWriterLockForCheck([paths.catalogPath, paths.publicPath], io);
    assertNoIncompleteTransactionForCheck([paths.catalogPath, paths.publicPath], io);
    if (!io.existsSync(paths.catalogPath)) throw new Error(`MCP catalog output is missing: ${basename(paths.catalogPath)}`);
    if (!bytesMatch(catalog, io.readFileSync(paths.catalogPath))) {
      throw new Error(`MCP catalog output is stale: ${basename(paths.catalogPath)}`);
    }
    if (!io.existsSync(paths.publicPath)) throw new Error(`public MCP manifest is missing: ${basename(paths.publicPath)}`);
    if (!bytesMatch(publicManifest, io.readFileSync(paths.publicPath))) {
      throw new Error(`public MCP manifest is stale: ${basename(paths.publicPath)}`);
    }
    return;
  }

  io.mkdirSync(dirname(paths.catalogPath), { recursive: true });
  io.mkdirSync(dirname(paths.publicPath), { recursive: true });
  const transactionToken = `${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}`;
  const writerLock = acquireGeneratedPairWriterLock(
    [paths.catalogPath, paths.publicPath],
    transactionToken,
    io,
    { writerLockPhaseHook: dependencies.writerLockPhaseHook }
  );
  let operationError = null;
  try {
    assertGeneratedPairWriterLock(writerLock, [paths.catalogPath, paths.publicPath], io);
    recoverGeneratedPair([paths.catalogPath, paths.publicPath], io, {
      recoverableTransactionTokens: writerLock.recoverableTransactionTokens
    });
    assertGeneratedPairWriterLock(writerLock, [paths.catalogPath, paths.publicPath], io);
    finishGeneratedPairWriterLockRecovery(writerLock, io);
    assertGeneratedPairWriterLock(writerLock, [paths.catalogPath, paths.publicPath], io);
    paths = validateTargetPaths(paths, io);

    const contract = JSON.parse(io.readFileSync(paths.contractPath, "utf8"));
    const catalog = (dependencies.renderCatalogImpl ?? renderCatalog)(contract);
    const publicManifest = (dependencies.renderPublicManifestImpl ?? renderPublicManifest)(contract);
    validateRenderedPair(contract, catalog, publicManifest);
    assertGeneratedPairWriterLock(writerLock, [paths.catalogPath, paths.publicPath], io);
    paths = validateTargetPaths(paths, io);
    recoverGeneratedPair([paths.catalogPath, paths.publicPath], io);
    assertGeneratedPairWriterLock(writerLock, [paths.catalogPath, paths.publicPath], io);
    paths = validateTargetPaths(paths, io);

    if (
      io.existsSync(paths.catalogPath)
      && io.existsSync(paths.publicPath)
      && bytesMatch(catalog, io.readFileSync(paths.catalogPath))
      && bytesMatch(publicManifest, io.readFileSync(paths.publicPath))
    ) return;

    assertGeneratedPairWriterLock(writerLock, [paths.catalogPath, paths.publicPath], io);
    writeGeneratedPair([
      { targetPath: paths.catalogPath, contents: catalog },
      { targetPath: paths.publicPath, contents: publicManifest }
    ], {
      io,
      transactionToken,
      transactionPhaseHook: dependencies.transactionPhaseHook,
      writerLock
    });
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    try {
      releaseGeneratedPairWriterLock(writerLock, io);
    } catch (releaseError) {
      if (operationError) {
        throw new AggregateError(
          [operationError, releaseError],
          `${operationError.message}; writer lock release was incomplete: ${releaseError.message}`
        );
      }
      throw releaseError;
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  run(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
