import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

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
const defaultFileIO = {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
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
    if (typeof tool.name !== "string" || names.has(tool.name)) throw new Error(`Duplicate or invalid MCP tool name: ${tool.name}`);
    if (typeof tool.anchor !== "string" || anchors.has(tool.anchor)) throw new Error(`Duplicate or invalid MCP anchor: ${tool.anchor}`);
    if (!CATEGORY_TITLES.has(tool.category)) throw new Error(`Unknown MCP tool category: ${tool.category}`);
    if (typeof tool.description !== "string" || tool.description.length === 0) throw new Error(`Missing description for ${tool.name}`);
    if (!tool.spend || !["free", "variable", "paid_export"].includes(tool.spend.kind)) {
      throw new Error(`Invalid spend classification for ${tool.name}`);
    }
    if (typeof tool.spend.summary !== "string" || tool.spend.summary.length === 0) {
      throw new Error(`Missing spend summary for ${tool.name}`);
    }
    if (typeof tool.asynchronous !== "boolean") throw new Error(`Invalid asynchronous flag for ${tool.name}`);
    if (!tool.inputSchema || typeof tool.inputSchema !== "object") throw new Error(`Missing input schema for ${tool.name}`);
    try {
      schemaValidator(tool.inputSchema);
    } catch (error) {
      throw new Error(`Invalid input schema for ${tool.name}: ${error.message}`, { cause: error });
    }

    const hasApiOperation = typeof tool.operationId === "string" && typeof tool.apiPage === "string";
    const hasNoApiOperation = tool.operationId === null && tool.apiPage === null;
    if (!hasApiOperation && !hasNoApiOperation) throw new Error(`Incomplete API mapping for ${tool.name}`);
    if (hasApiOperation && !tool.apiPage.startsWith("/api-reference/")) {
      throw new Error(`Unsafe API documentation link for ${tool.name}`);
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
  return candidateValues(schema, context).filter((candidate) => validate(candidate));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cartesianMergeObjects(pools) {
  let combinations = [{}];
  let sawObjectPool = false;
  for (const pool of pools) {
    const objects = pool.filter(isPlainObject);
    if (objects.length === 0) continue;
    sawObjectPool = true;
    const next = [];
    for (const combination of combinations) {
      for (const object of objects) {
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
    ...cartesianMergeObjects(pools),
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
        next.push({ ...candidate, [property]: clone(propertyCandidate) });
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
  if (schema === false) return [];
  if (schema === true) return [null, false, 0, "", [], {}];
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    throw new ExampleSynthesisError(toolName, path.join("."), "the schema is not an object or boolean schema");
  }

  if (Object.hasOwn(schema, "const")) return [clone(schema.const)];
  if (Array.isArray(schema.enum)) return uniqueCandidates(schema.enum.map(clone));
  if (schema.$ref) {
    if (context.referenceStack.has(schema.$ref)) {
      throw new ExampleSynthesisError(toolName, path.join("."), `recursive schema reference ${schema.$ref} cannot be synthesized`);
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
  if (candidates.length > 0) return clone(candidates[0]);
  throw new ExampleSynthesisError(
    context.toolName,
    context.path.join("."),
    "no deterministic candidate satisfies the complete schema"
  );
}

function synthesizeArguments(tool) {
  let argumentsValue;
  try {
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
      referenceStack: new Set()
    });
    if (!argumentsValue || typeof argumentsValue !== "object" || Array.isArray(argumentsValue)) {
      throw new ExampleSynthesisError(tool.name, "arguments", "the top-level tool input must synthesize to an object");
    }
    if (tool.spend.kind === "paid_export") {
      argumentsValue = { ...argumentsValue, [tool.spend.confirmationField]: true };
    }
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

function resolveSchemaForDisplay(schema, rootSchema) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema) || !schema.$ref) return schema;
  return resolveLocalReference(schema.$ref, rootSchema, "catalog", "input table");
}

function describeType(schema, rootSchema) {
  if (schema === false) return "never";
  if (schema === true) return "any JSON value";
  const resolved = resolveSchemaForDisplay(schema, rootSchema);
  if (resolved !== schema) return describeType(resolved, rootSchema);
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
  return values.map((value) => `\`${JSON.stringify(value)}\``).join(", ");
}

function collectNestedRequirements(schema, rootSchema, prefix = "", seen = new Set()) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema) || seen.has(schema)) return [];
  seen.add(schema);
  const resolved = resolveSchemaForDisplay(schema, rootSchema);
  if (resolved !== schema) return collectNestedRequirements(resolved, rootSchema, prefix, seen);
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
  const resolved = resolveSchemaForDisplay(schema, rootSchema);
  if (resolved !== schema) return describeConstraints(resolved, rootSchema);
  const constraints = [];
  if (schema.format) constraints.push(`format: \`${schema.format}\``);
  if (Object.hasOwn(schema, "const")) constraints.push(`must equal \`${JSON.stringify(schema.const)}\``);
  if (schema.enum) constraints.push(`allowed values: ${codeList(schema.enum)}`);
  if (schema.minLength !== undefined) constraints.push(`minimum length: ${schema.minLength}`);
  if (schema.maxLength !== undefined) constraints.push(`maximum length: ${schema.maxLength}`);
  if (schema.pattern) constraints.push(`pattern: \`${schema.pattern}\``);
  if (schema.minimum !== undefined) constraints.push(`minimum: ${schema.minimum}`);
  if (schema.maximum !== undefined) constraints.push(`maximum: ${schema.maximum}`);
  if (schema.exclusiveMinimum !== undefined) constraints.push(`exclusive minimum: ${schema.exclusiveMinimum}`);
  if (schema.exclusiveMaximum !== undefined) constraints.push(`exclusive maximum: ${schema.exclusiveMaximum}`);
  if (schema.minItems !== undefined) constraints.push(`minimum items: ${schema.minItems}`);
  if (schema.maxItems !== undefined) constraints.push(`maximum items: ${schema.maxItems}`);
  if (schema.uniqueItems) constraints.push("items must be unique");
  if (schema.minProperties !== undefined) constraints.push(`minimum properties: ${schema.minProperties}`);
  const properties = Object.keys(schema.properties ?? {});
  if (properties.length > 0) constraints.push(`allowed properties: ${properties.map((name) => `\`${name}\``).join(", ")}`);
  const nestedRequirements = collectNestedRequirements(schema, rootSchema);
  if (nestedRequirements.length > 0) {
    constraints.push(`nested required fields: ${nestedRequirements.map((name) => `\`${name}\``).join(", ")}`);
  }
  if (schema.additionalProperties === false) constraints.push("additional properties are not allowed");
  if (schema.items) constraints.push(`item type: \`${describeType(schema.items, rootSchema)}\``);
  return constraints.join("; ") || "—";
}

function escapeTableCell(value) {
  return String(value).replaceAll("\n", " ").replaceAll("|", "\\|");
}

function renderInputTable(tool) {
  const rows = ["| Field | Type | Required | Description | Constraints |", "| --- | --- | --- | --- | --- |"];
  const properties = Object.entries(tool.inputSchema.properties ?? {});
  if (properties.length === 0) {
    rows.push("| _No input fields_ | — | — | Pass an empty JSON object. | additional properties are not allowed |");
    return rows.join("\n");
  }
  const required = new Set(tool.inputSchema.required ?? []);
  for (const [name, schema] of properties) {
    rows.push(`${[
      `| \`${name}\``,
      `\`${escapeTableCell(describeType(schema, tool.inputSchema))}\``,
      required.has(name) ? "Yes" : "No",
      escapeTableCell(schema.description ?? "No runtime description supplied."),
      escapeTableCell(describeConstraints(schema, tool.inputSchema))
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
    tool.description,
    `- **Category:** ${CATEGORY_TITLES.get(tool.category)}`,
    `- **Spend classification:** ${spendClassification(tool.spend.kind)}`,
    `- **Credit behavior:** ${tool.spend.summary}`,
    `- **Execution:** ${execution}`,
    "- **Authentication:** Uses the credentials configured on the MCP connection; never include an API key in tool arguments.",
    `<Note>\nCredit behavior: ${tool.spend.summary}.\n</Note>`
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

function transactionPathsFor(targetPath, token) {
  return {
    temporaryPath: `${targetPath}.${token}.tmp`,
    backupPath: `${targetPath}.${token}.bak`
  };
}

function quietly(callback) {
  try {
    callback();
  } catch {}
}

function writePairAtomic(outputs, { io, transactionToken }) {
  const entries = outputs.map(({ targetPath, contents }) => ({
    targetPath,
    contents,
    ...transactionPathsFor(targetPath, transactionToken),
    descriptor: undefined,
    hadTarget: false,
    backedUp: false,
    installed: false
  }));

  try {
    for (const entry of entries) {
      io.writeFileSync(entry.temporaryPath, entry.contents, { encoding: "utf8", flag: "wx" });
      entry.descriptor = io.openSync(entry.temporaryPath, "r+");
      io.fsyncSync(entry.descriptor);
      io.closeSync(entry.descriptor);
      entry.descriptor = undefined;
    }
    for (const entry of entries) {
      if (!io.existsSync(entry.targetPath)) continue;
      entry.hadTarget = true;
      io.renameSync(entry.targetPath, entry.backupPath);
      entry.backedUp = true;
    }
    for (const entry of entries) {
      io.renameSync(entry.temporaryPath, entry.targetPath);
      entry.installed = true;
    }
  } catch (error) {
    const recoveryErrors = [];
    for (const entry of [...entries].reverse()) {
      if (entry.descriptor !== undefined) {
        try {
          io.closeSync(entry.descriptor);
        } catch (recoveryError) {
          recoveryErrors.push(recoveryError);
        }
      }
      entry.descriptor = undefined;
    }
    for (const entry of entries) {
      if (entry.backedUp) {
        try {
          // Replacing an installed target directly avoids deleting the new file
          // before the original backup has been restored successfully.
          io.renameSync(entry.backupPath, entry.targetPath);
          entry.backedUp = false;
          entry.installed = false;
        } catch (recoveryError) {
          recoveryErrors.push(recoveryError);
        }
      } else if (entry.installed && !entry.hadTarget) {
        try {
          io.unlinkSync(entry.targetPath);
          entry.installed = false;
        } catch (recoveryError) {
          recoveryErrors.push(recoveryError);
        }
      }
    }
    if (recoveryErrors.length > 0) {
      throw new AggregateError(
        [error, ...recoveryErrors],
        `${error.message}; rollback was incomplete and recovery backups were preserved`
      );
    }
    throw error;
  } finally {
    for (const entry of entries) {
      if (entry.descriptor !== undefined) quietly(() => io.closeSync(entry.descriptor));
      entry.descriptor = undefined;
      quietly(() => io.unlinkSync(entry.temporaryPath));
    }
  }

  // Both new outputs are installed at this commit point. Backup cleanup must
  // never enter rollback after an earlier original has already been deleted.
  const cleanupErrors = [];
  for (const entry of entries) {
    if (!entry.backedUp) continue;
    try {
      io.unlinkSync(entry.backupPath);
      entry.backedUp = false;
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(
      cleanupErrors,
      `backup cleanup failed after MCP outputs were committed: ${cleanupErrors[0].message}`
    );
  }
}

export async function run(argv, dependencies = {}) {
  const parsed = parseArguments(argv);
  const io = { ...defaultFileIO, ...(dependencies.fsImpl ?? {}) };
  const paths = validateTargetPaths({
    contractPath: parsed.contract ?? DEFAULT_CONTRACT_PATH,
    catalogPath: parsed.catalog ?? DEFAULT_CATALOG_PATH,
    publicPath: parsed.public ?? DEFAULT_PUBLIC_PATH
  }, io);
  const contract = JSON.parse(io.readFileSync(paths.contractPath, "utf8"));
  const catalog = (dependencies.renderCatalogImpl ?? renderCatalog)(contract);
  const publicManifest = (dependencies.renderPublicManifestImpl ?? renderPublicManifest)(contract);
  validateRenderedPair(contract, catalog, publicManifest);

  if (parsed.mode === "--check") {
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

  if (
    io.existsSync(paths.catalogPath)
    && io.existsSync(paths.publicPath)
    && bytesMatch(catalog, io.readFileSync(paths.catalogPath))
    && bytesMatch(publicManifest, io.readFileSync(paths.publicPath))
  ) return;

  io.mkdirSync(dirname(paths.catalogPath), { recursive: true });
  io.mkdirSync(dirname(paths.publicPath), { recursive: true });
  const transactionToken = `${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}`;
  writePairAtomic([
    { targetPath: paths.catalogPath, contents: catalog },
    { targetPath: paths.publicPath, contents: publicManifest }
  ], { io, transactionToken });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  run(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
