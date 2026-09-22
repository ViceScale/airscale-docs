import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import SwaggerParser from "@apidevtools/swagger-parser";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { buildSpec } from "../scripts/build-openapi.mjs";
const spec = await SwaggerParser.dereference(buildSpec());
const ajv = new Ajv2020({ strict: false });
addFormats(ajv);
const operation = (path) => spec.paths[path].post;
const requestSchema = (path) => operation(path).requestBody.content["application/json"].schema;

test("DNC and both Leads Finder routes have deployed source fingerprints", () => {
  const evidence = JSON.parse(readFileSync("contracts/deployed-public-api-evidence.json"));
  for (const name of ["dnc-checker", "leads-finder"]) {
    const worker = evidence.workers[name];
    assert.match(worker.scriptSha256, /^[a-f0-9]{64}$/);
    assert.equal(worker.rateLimitPerSecond, 5);
    for (const path of worker.routes) assert.ok(operation(path));
  }
  assert.equal(evidence.workers["dnc-checker"].creditCost, 1);
  assert.deepEqual(evidence.workers["leads-finder"].routes, ["/v1/leads-finder", "/v1/leads-finder/preview"]);
});

test("Leads Finder alias preserves the paid request and response contract", () => {
  const primary = operation("/v1/leads-finder");
  const alias = operation("/v1/leads-finder/preview");
  assert.deepEqual(primary.requestBody, alias.requestBody);
  assert.deepEqual(primary.responses, alias.responses);
  assert.match(alias["x-airscale-credit-cost"], /0\.1 credits/);
  const validate = ajv.compile(requestSchema("/v1/leads-finder"));
  assert.equal(validate({ filters: { job: ["Founder"], company: "example.com" }, page: 0, size: 25 }), true);
  assert.equal(validate({ filters: { job: ["Founder"], duration: { currentCompany: { min: { year: 1, month: 6 } } } } }), true);
  assert.equal(validate({ query: { jobTitle: { include: ["Founder"] } } }), false);
  assert.equal(validate({ filters: { job: ["Founder"] }, size: 101 }), false);
  assert.equal(validate({ filters: { duration: { currentCompany: { min: { month: 12 } } } } }), false);
  const response = primary.responses[200].content["application/json"].schema;
  assert.equal(ajv.validate(response, { rows: [], total: null, page: 0, size: 25 }), true);
});

test("DNC contract exposes the observed five-per-second limit and validation errors", () => {
  const dnc = operation("/v1/dnc-check");
  assert.match(dnc["x-airscale-rate-limit"], /^5 requests per second/);
  assert.ok(dnc.responses[422]);
  assert.equal(ajv.validate(requestSchema("/v1/dnc-check"), { phone: "+12025550147" }), true);
  assert.equal(ajv.validate(requestSchema("/v1/dnc-check"), {}), false);
  assert.equal(ajv.validate(requestSchema("/v1/dnc-check"), { email: "person@example.org" }), false);
});

test("restored search guidance preserves semantics in prose and machine-readable descriptions", () => {
  const people = readFileSync("api-reference/find-people.mdx", "utf8");
  const count = readFileSync("api-reference/find-people/count.mdx", "utf8");
  assert.match(people, /same prior role/);
  assert.match(count, /same prior role/);
  const query = requestSchema("/v1/find-people").properties.query;
  assert.match(query.properties.pastJobTitle.description, /same prior role/);
  assert.match(query.properties.pastCompanyName.description, /same prior role/);
  for (const field of ["jobStartDate", "companySize", "companyAddress"]) assert.ok(people.includes(field));
  const companies = readFileSync("api-reference/find-companies.mdx", "utf8");
  assert.match(companies, /removed recursively/);
  assert.match(companies, /Do not depend on those fields/);
});
