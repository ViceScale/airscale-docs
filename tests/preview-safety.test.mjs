import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const policy = JSON.parse(readFileSync("contracts/publication-policy.json", "utf8"));
const config = JSON.parse(readFileSync("docs.json", "utf8"));

test("publication policy is preview-only and forbids live-domain mutations", () => {
  assert.deepEqual(policy, {
    previewOrigin: "https://airscale.mintlify.app",
    liveDocumentationOrigin: "https://docs.airscale.io",
    previewRobots: "noindex, follow",
    dnsChangesAllowed: false,
    liveRedirectsAllowed: false,
    liveSiteWritesAllowed: false
  });
});

test("docs configuration identifies the complete knowledge base and keeps the preview noindex", () => {
  assert.equal(
    config.description,
    "Airscale product guides, integration workflows, MCP documentation, and public API reference."
  );
  assert.equal(config.seo.indexing, "navigable");
  assert.equal(config.seo.metatags.robots, policy.previewRobots);
  assert.equal(config.search.prompt, "Search Airscale documentation...");
});

test("foundation config does not declare live-domain redirects", () => {
  assert.equal(Object.hasOwn(config, "redirects"), false);
  assert.equal(policy.dnsChangesAllowed, false);
  assert.equal(policy.liveRedirectsAllowed, false);
  assert.equal(policy.liveSiteWritesAllowed, false);
});
