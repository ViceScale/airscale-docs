import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import { companyLookalikesOperation } from "../openapi/operations/company-lookalikes.mjs";
const operation = companyLookalikesOperation.operation;
const ajv = new Ajv2020({ strict: false });

test("company lookalikes documents strict bounded inputs and total-result semantics", () => {
  const schema = operation.requestBody.content["application/json"].schema;
  const validate = ajv.compile(schema);
  assert.equal(validate({ domains: ["example.com"], limit: 10 }), true);
  for (const body of [{ domains: [] }, { domains: Array(11).fill("example.com") }, { domains: ["example.com"], limit: 5001 }, { domains: ["example.com"], limitPerCompany: 10 }, { domains: ["example.com"], include: { domains: [] } }, { domains: ["example.com"], exclude: { size: ["unknown"] } }]) assert.equal(validate(body), false);
  assert.equal(schema.properties.limit.default, 2000);
  assert.match(schema.properties.limit.description, /distinct normalized reference domains/);
  assert.match(schema.properties.limit.description, /2000 for one, 4000 for two, 5000/);
  assert.equal(schema.properties.exclude.properties.domains.maxItems, 900);
});

test("company lookalikes response preserves all fields and nullable values without inventing score bounds", () => {
  const content = operation.responses["200"].content["application/json"];
  const validate = ajv.compile(content.schema);
  const response = structuredClone(content.examples.success.value);
  response.data[0].founded_year = null;
  response.data[0].relevance_score = null;
  response.data[0].employee_count = "";
  assert.equal(validate(response), true);
  response.data[0].relevance_score = 12;
  assert.equal(validate(response), true);
  delete response.data[0].matched_domains;
  assert.equal(validate(response), false);
  assert.equal(validate(content.examples.empty.value), true);
});

test("company lookalikes navigation, rate limits, credits and retry guidance agree", () => {
  const config = JSON.parse(readFileSync("docs.json", "utf8"));
  const group = config.navigation.tabs.find(({ tab }) => tab === "API Reference").groups.find(({ group }) => group === "Search and discovery");
  assert.ok(group.pages.includes("api-reference/company-lookalikes"));
  const page = readFileSync("api-reference/company-lookalikes.mdx", "utf8");
  const limits = readFileSync("api-reference/rate-limits.mdx", "utf8");
  for (const source of [page, limits]) assert.ok(source.includes(operation["x-airscale-rate-limit"]));
  for (const pattern of [/Do not automatically retry/, /error or no response/, /another charge/, /2,500/, /100 seconds/]) assert.match(page, pattern);
  assert.equal(operation.parameters, undefined);
  assert.equal(operation.responses["202"], undefined);
  assert.ok(operation.responses["402"]);
  assert.ok(operation.responses["429"].headers["Retry-After"]);
});

test("copyable curl keeps the explicit ten-result limit and sufficient timeout", () => {
  const sample = operation["x-codeSamples"].find(({ label }) => label === "cURL");
  assert.match(sample.source, /"limit":10/);
  assert.match(sample.source, /--max-time 100/);
  assert.match(sample.source, /\$AIRSCALE_API_KEY/);
  assert.doesNotMatch(sample.source, /--retry/);
});

test("public lookalikes documentation omits providers and internal implementation details", () => {
  const page = readFileSync("api-reference/company-lookalikes.mdx", "utf8");
  const publicContent = page + JSON.stringify(operation);
  assert.doesNotMatch(publicContent, /extruct|company[ _-]?enrich|prospeo|icypeas|rapidapi|leadmagic|salesql|limadata|contactout|wiza|forager|bounceban|findymail|trykitt|explorium|upcell|adyntel|ai[ _-]?ark|harvest|unipile|b2b[ _-]?enrichment|serper|jina|bubble|supabase|cloudflare/i);
  assert.doesNotMatch(publicContent, /idempotenc|limitPerCompany|KiB|MiB|request.body.limit|body.{0,20}limited|settlement|90-second|80 seconds/i);
});
