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

test("Airschool branding keeps Airscale as the API and workspace product", () => {
  const config = JSON.parse(readFileSync("docs.json", "utf8"));
  assert.equal(config.name, "Airschool");
  assert.equal(spec.info.title, "Airscale Public API");
  assert.match(spec.components.securitySchemes.bearerAuth.description, /Airscale workspace API key/);
  const catalog = JSON.parse(readFileSync("contracts/public-api-operations.json", "utf8"));
  for (const { page } of catalog.operations) {
    assert.doesNotMatch(readFileSync(`${page}.mdx`, "utf8"), /Airschool (?:API|workspace|credits|dashboard|Settings|rate limits)/i, page);
  }
});

test("profile reference exposes URL-only extraction in schema, examples, and copy", () => {
  const generated = JSON.parse(readFileSync("openapi.json", "utf8"));
  for (const [path, page] of [["/v1/profile", "extract-people-profile"], ["/v1/company", "extract-company-profile"]]) {
    const operation = generated.paths[path].post;
    const request = operation.requestBody.content["application/json"];
    assert.deepEqual(Object.keys(request.schema.properties), ["linkedin_profile_url"]);
    for (const example of Object.values(request.examples)) {
      assert.deepEqual(Object.keys(example.value), ["linkedin_profile_url"]);
    }
    const source = readFileSync(`api-reference/${page}.mdx`, "utf8");
    assert.doesNotMatch(JSON.stringify(operation) + source, /\bp[123]\b|pass-through/i);
    assert.match(source, /missing or `null`/);
    assert.match(source, /types can vary/);
    assert.match(source, /client timeout does not confirm/);
  }
});

test("simplified engagement and verification copy retains billing and retry limits", () => {
  for (const page of ["post-likers", "post-commenters"]) {
    const source = readFileSync(`api-reference/${page}.mdx`, "utf8");
    assert.doesNotMatch(source, /pinned provider|continuation account|bridge|settlement|discovery attempt/i);
    for (const required of [/results have already been saved.*cursor expiry/, /Idempotency-Key/, /24 hours/, /10 minutes/, /Retry-After/, /new billable request/, /does not automatically become a refund/, /account_restart_required/]) assert.match(source, required);
  }
  const verifier = readFileSync("api-reference/miscale-news/email-verifier.mdx", "utf8");
  for (const required of [/135 seconds/, /`body`/, /non-JSON/, /another charge/, /`503`/, /does not support caller idempotency keys/]) assert.match(verifier, required);
});
