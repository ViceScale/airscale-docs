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

function deepFreeze(value) {
  Object.freeze(value);
  for (const child of Object.values(value)) {
    if (child && typeof child === "object" && !Object.isFrozen(child)) {
      deepFreeze(child);
    }
  }
  return value;
}

const EXPECTED_CONTRACTS = deepFreeze({
  "api-overview": {
    endpoints: [{ method: "POST", path: "/v1/credits" }],
    sourceFiles: ["workers/public-api/credits.js", "workers/public-api/credits.test.mjs"]
  },
  authentication: {
    endpoints: [],
    sourceFiles: ["workers/public-api/worker-auth-shape.js", "workers/public-api/public-worker-auth-order.test.mjs"]
  },
  "rate-limits": {
    endpoints: [],
    sourceFiles: ["workers/public-api/worker-rate-limit.js", "workers/public-api/airscale-public-api-worker-cutover.sh"]
  },
  "credit-count": {
    endpoints: [{ method: "POST", path: "/v1/credits" }],
    sourceFiles: ["workers/public-api/credits.js", "workers/public-api/credits.test.mjs"]
  },
  "email-finder": {
    endpoints: [{ method: "POST", path: "/v1/email" }],
    sourceFiles: ["workers/public-api/v2-waterfall-email.js", "workers/public-api/v2-waterfall-email.test.mjs"]
  },
  "email-finder-(bulk)": {
    endpoints: [{ method: "POST", path: "/v1/email-bulk" }],
    sourceFiles: ["workers/public-api/v2-waterfall-email-bulk.js", "workers/public-api/v2-waterfall-email-bulk.test.mjs"]
  },
  "mobile-finder": {
    endpoints: [{ method: "POST", path: "/v1/phone" }],
    sourceFiles: ["workers/public-api/v2-waterfall-mobile.js", "workers/public-api/v2-waterfall-mobile.test.mjs"]
  },
  "personal-email": {
    endpoints: [{ method: "POST", path: "/v1/personal-email" }],
    sourceFiles: ["workers/public-api/v2-waterfall-personal-email.js", "workers/public-api/v2-waterfall-personal-email.test.mjs"]
  },
  "people-url-finder": {
    endpoints: [{ method: "POST", path: "/v1/url-search-people" }],
    sourceFiles: ["workers/public-api/url-search-people.js", "workers/public-api/url-search-people.test.mjs"]
  },
  "extract-people-profile": {
    endpoints: [{ method: "POST", path: "/v1/profile" }],
    sourceFiles: ["workers/public-api/v2-profile.js", "workers/public-api/v2-profile.url-normalization.test.mjs"]
  },
  "extract-company-profile": {
    endpoints: [{ method: "POST", path: "/v1/company" }],
    sourceFiles: ["workers/public-api/v2-profile.js", "workers/public-api/v2-profile.url-normalization.test.mjs"]
  },
  "reverse-email": {
    endpoints: [{ method: "POST", path: "/v1/reverse-email" }],
    sourceFiles: ["workers/public-api/reverse-email.js", "workers/public-api/reverse-email.test.mjs"]
  },
  "reverse-phone": {
    endpoints: [{ method: "POST", path: "/v1/reverse-phone" }],
    sourceFiles: ["workers/public-api/v2-waterfall-phone.js", "workers/public-api/v2-waterfall-phone.test.mjs"]
  },
  "find-people": {
    endpoints: [
      { method: "POST", path: "/v1/find-people" },
      { method: "POST", path: "/v1/find-people/count" }
    ],
    sourceFiles: ["workers/public-api/icypeas-find-people.js", "workers/public-api/icypeas-find-people.test.mjs"]
  },
  "find-companies": {
    endpoints: [
      { method: "POST", path: "/v1/find-companies" },
      { method: "GET", path: "/v1/find-companies/filter-values" }
    ],
    sourceFiles: ["workers/public-api/find-companies-worker.js", "workers/public-api/find-companies-worker.test.mjs"]
  },
  airsearch: {
    endpoints: [{ method: "POST", path: "/v1/airsearch" }],
    sourceFiles: ["workers/public-api/airsearch-worker.js", "workers/public-api/airsearch-worker.test.mjs"]
  }
});

function isRepositoryRelativePath(path) {
  return (
    typeof path === "string" &&
    path.length > 0 &&
    !path.startsWith("/") &&
    !path.startsWith("\\") &&
    !/^[A-Za-z]:/.test(path) &&
    !/^[A-Za-z][A-Za-z\d+.-]*:/.test(path) &&
    !path.split(/[\\/]/).includes("..")
  );
}

test("repository-relative source paths reject absolute, URI, and parent paths", () => {
  assert.equal(isRepositoryRelativePath("workers/public-api/credits.js"), true);

  for (const path of ["", "/etc/file", "C:\\file", "\\\\server\\file", "https://example.com/file", "../file"]) {
    assert.equal(isRepositoryRelativePath(path), false, `${path || "empty path"} must be rejected`);
  }
});

test("expected contract mapping rejects changed endpoints and source files", () => {
  const manifest = JSON.parse(readFileSync("contracts/public-api-contracts.json", "utf8"));
  const wrongEndpoint = structuredClone(manifest.pages);
  wrongEndpoint["email-finder"].endpoints[0].path = "/v1/wrong";
  assert.throws(() => assert.deepEqual(wrongEndpoint, EXPECTED_CONTRACTS));

  const wrongSource = structuredClone(manifest.pages);
  wrongSource["email-finder"].sourceFiles[0] = "workers/public-api/wrong.js";
  assert.throws(() => assert.deepEqual(wrongSource, EXPECTED_CONTRACTS));
});

test("contract evidence covers every approved page at the locked source SHA", () => {
  const manifest = JSON.parse(readFileSync("contracts/public-api-contracts.json", "utf8"));
  assert.equal(manifest.sourceRepository, "ViceScale/airscale-code");
  assert.equal(manifest.sourceSha, EXPECTED_SOURCE_SHA);
  assert.deepEqual(Object.keys(manifest.pages).sort(), EXPECTED_PAGES.sort());
  assert.deepEqual(manifest.pages, EXPECTED_CONTRACTS);

  for (const [page, evidence] of Object.entries(manifest.pages)) {
    assert.ok(evidence.sourceFiles.length > 0, `${page} must name authoritative source files`);
    assert.ok(evidence.sourceFiles.every(isRepositoryRelativePath), `${page} source paths must stay repository-relative`);
    assert.ok(Array.isArray(evidence.endpoints), `${page} endpoints must be an array`);
    for (const endpoint of evidence.endpoints) {
      assert.match(endpoint.method, /^(GET|POST)$/);
      assert.match(endpoint.path, /^\/v1\//);
    }
  }
});
