import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const EXPECTED_SOURCE_SHA = "8606866a5fb1f9405a94d49cfa9fbddaf4aaf431";
const EXPECTED_PAGES = [
  "api-overview",
  "authentication",
  "rate-limits",
  "credit-count",
  "email-finder",
  "email-finder-(bulk)",
  "mobile-finder",
  "personal-email",
  "people-url-finder",
  "extract-people-profile",
  "extract-company-profile",
  "reverse-email",
  "reverse-phone",
  "find-people",
  "find-companies",
  "airsearch"
];

test("contract evidence covers every approved page at the locked source SHA", () => {
  const manifest = JSON.parse(readFileSync("contracts/public-api-contracts.json", "utf8"));
  assert.equal(manifest.sourceRepository, "ViceScale/airscale-code");
  assert.equal(manifest.sourceSha, EXPECTED_SOURCE_SHA);
  assert.deepEqual(Object.keys(manifest.pages).sort(), EXPECTED_PAGES.sort());

  for (const [page, evidence] of Object.entries(manifest.pages)) {
    assert.ok(evidence.sourceFiles.length > 0, `${page} must name authoritative source files`);
    assert.ok(evidence.sourceFiles.every((path) => !path.includes("..")), `${page} source paths must stay repository-relative`);
    assert.ok(Array.isArray(evidence.endpoints), `${page} endpoints must be an array`);
    for (const endpoint of evidence.endpoints) {
      assert.match(endpoint.method, /^(GET|POST)$/);
      assert.match(endpoint.path, /^\/v1\//);
    }
  }
});
