import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { postEngagementOperations } from "../openapi/operations/post-engagement.mjs";
import { linkedinContentOperations } from "../openapi/operations/linkedin-content.mjs";

const contract = JSON.parse(readFileSync(new URL("../contracts/mcp-tools.json", import.meta.url), "utf8"));
const leadsPage = readFileSync(new URL("../api-reference/leads-finder.mdx", import.meta.url), "utf8");
const tools = new Map(contract.tools.map(tool => [tool.name, tool]));

test("Leads Finder preset guidance includes every documented identifier", () => {
  const properties = tools.get("airscale_leads_finder").inputSchema.properties.filters.properties;
  for (const [heading, fields] of [
    ["Seniority", ["seniority", "seniorityExclude"]],
    ["Funding round", ["funding"]],
    ["Company type", ["type", "typeExclude"]],
    ["Profile badge", ["profileBadge"]],
    ["Department headcount and growth", ["department", "growth"]],
  ]) {
    const section = leadsPage.split(`### ${heading}\n`)[1]?.split(/\n### /)[0];
    const list = section?.match(/```text\n([\s\S]*?)\n```/)?.[1].trim().split("\n");
    assert.ok(list?.length, `missing documented ${heading} values`);
    for (const field of fields) {
      const tokens = new Set((properties[field].description ?? "").match(/[A-Za-z_][A-Za-z0-9_-]*/g));
      for (const value of list) assert.ok(tokens.has(value), `${field} MCP guidance omits documented ${value}`);
    }
  }
  assert.match(properties.jobFunction.description, /https:\/\/airscale\.mintlify\.app\/api-reference\/leads-finder/);
  assert.match(properties.jobFunction.description, /300/);
});

test("catalog includes extraction mode and 120-day event windows", () => {
  for (const name of ["airscale_post_likers", "airscale_post_commenters"]) {
    assert.equal(tools.get(name).inputSchema.properties.enrich_profiles?.type, "boolean");
    assert.match(tools.get(name).description, /1 credit per fresh provider page/);
  }
  for (const name of ["airscale_find_companies", "airscale_start_companies_export"]) {
    assert.ok(tools.get(name).inputSchema.properties.filters.properties.eventWindow.enum.includes("120 days"));
  }
});

test("API reference models raw extraction, fractional credits and empty content pages", () => {
  const ajv = new Ajv2020({ strict: false });
  addFormats(ajv);
  for (const { operation } of postEngagementOperations) {
    const request = operation.requestBody.content["application/json"].schema;
    assert.equal(request.properties.enrich_profiles?.type, "boolean");
    const body = operation.responses[200].content["application/json"];
    const validate = ajv.compile(body.schema);
    const example = structuredClone(body.examples.page.value);
    example.items[0].profile_status = "not_enriched";
    example.billing = { credits_consumed: 1, credits_refunded: 0, outcomes: { success: 0, not_found: 0, error: 0, not_enriched: 1 } };
    example.retrieval.status = "partial";
    example.retrieval.stop_reason = "insufficient_credits";
    assert.equal(validate(example), true, ajv.errorsText(validate.errors));
    example.items[0].profile_status = "success";
    example.billing = { credits_consumed: 0.2, credits_refunded: 4.8, outcomes: { success: 1, not_found: 0, error: 0 } };
    assert.equal(validate(example), true, ajv.errorsText(validate.errors));
    assert.match(operation["x-airscale-credit-cost"], /0\.2.*1 credit.*fresh/);
  }
  for (const { operation } of linkedinContentOperations) {
    assert.match(operation["x-airscale-credit-cost"], /empty pages.*not charged/);
    const response = operation.responses[200].content["application/json"];
    const validate = ajv.compile(response.schema);
    const emptyPage = structuredClone(response.examples.page.value);
    emptyPage.items = [];
    emptyPage.pagination = { has_more: false, next_cursor: null, total: 0 };
    emptyPage.billing.credits_consumed = 0;
    assert.equal(validate(emptyPage), true, ajv.errorsText(validate.errors));
    emptyPage.billing.credits_consumed = 2;
    assert.equal(validate(emptyPage), false, "content pages never cost two credits");
  }
});
