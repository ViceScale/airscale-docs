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

test("Email finder success example covers every documented success field", () => {
  const content = spec.paths["/v1/email"].post.responses["200"].content["application/json"];
  const successSchema = content.schema.oneOf.find((schema) => schema.properties.status.const === "success");
  const example = content.examples.success.value;
  assert.deepEqual(Object.keys(example).sort(), Object.keys(successSchema.properties).sort());
  assert.equal(ajv.validate(successSchema, example), true, ajv.errorsText());
  assert.equal(example.email_status, "valid");
});

test("API sidebar follows task priority and keeps count within Find people", () => {
  const config = JSON.parse(readFileSync("docs.json", "utf8"));
  const groups = config.navigation.tabs.find(({ tab }) => tab === "API Reference").groups;
  assert.deepEqual(groups.slice(0, 2).map(({ group }) => group), ["Start here", "Account"]);
  assert.equal(groups.at(-1).group, "Miscellaneous");
  const profilesIndex = groups.findIndex(({ group }) => group === "Profiles and reverse lookup");
  assert.equal(groups[profilesIndex + 1].group, "Post engagement");
  assert.equal(groups[profilesIndex + 1].expanded, false);
  assert.equal(groups.flatMap(({ pages }) => pages).includes("api-reference/find-people/count"), false);
});

test("Find people includes a count request and response validated against the count operation", () => {
  const page = readFileSync("api-reference/find-people.mdx", "utf8");
  assert.match(page, /^## Count matching people$/m);
  assert.match(page, /POST.*\/v1\/find-people\/count/);
  assert.match(page, /Count is free/);
  assert.match(page, /same `query`/);
  const request = page.match(/```json Count request\n([\s\S]*?)\n```/);
  const response = page.match(/```json Count response\n([\s\S]*?)\n```/);
  assert.ok(request, "count request must be documented inline");
  assert.ok(response, "count response must be documented inline");
  const count = spec.paths["/v1/find-people/count"].post;
  assert.equal(ajv.validate(count.requestBody.content["application/json"].schema, JSON.parse(request[1])), true, ajv.errorsText());
  assert.equal(ajv.validate(count.responses["200"].content["application/json"].schema, JSON.parse(response[1])), true, ajv.errorsText());
});

test("every endpoint exposes its documented rate limit in the page header and overview", () => {
  const catalog = JSON.parse(readFileSync("contracts/public-api-operations.json", "utf8"));
  const overview = readFileSync("api-reference/rate-limits.mdx", "utf8");
  for (const { page, method, path } of catalog.operations) {
    const limit = spec.paths[path][method.toLowerCase()]["x-airscale-rate-limit"];
    const source = readFileSync(`${page}.mdx`, "utf8");
    const description = source.match(/^description: (".*")$/m);
    assert.ok(description, `${page} must have a visible header description`);
    assert.ok(JSON.parse(description[1]).includes(`Rate limit: ${limit}`), `${page}: header must expose ${limit}`);
    assert.ok(overview.includes(`](/${page})`), `${page}: rate-limit overview must link to the operation`);
    assert.ok(overview.includes(limit), `${page}: rate-limit overview must preserve its scope and window`);
  }
});
