import assert from "node:assert/strict";
import test from "node:test";
import { baseSpec } from "../openapi/base.mjs";
import { buildSpec } from "../scripts/build-openapi.mjs";
import { outputMatchesSerialized } from "../scripts/build-openapi.mjs";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runCli, writeOpenApiAtomic } from "../scripts/build-openapi.mjs";

const SOURCE_SHA = "8606866a5fb1f9405a94d49cfa9fbddaf4aaf431";

function operation(method, path, operationId) {
  return {
    method,
    path,
    operation: { operationId, responses: { 200: { description: "OK" } } }
  };
}

function catalog(...operations) {
  return { operations };
}

function inTemporaryDirectory(run) {
  const directory = mkdtempSync(join(tmpdir(), "openapi-builder-"));
  try {
    run(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function fixtureSpec() {
  return {
    openapi: "3.1.0",
    info: { title: "Fixture", version: "1" },
    paths: {}
  };
}

function serializedFixtureSpec() {
  return JSON.stringify(fixtureSpec(), null, 2) + "\n";
}

function assertNoTemporaryFiles(directory) {
  assert.deepEqual(readdirSync(directory).filter((name) => name.endsWith(".tmp")), []);
}

function snapshotFile(filePath) {
  return existsSync(filePath) ? { exists: true, contents: readFileSync(filePath) } : { exists: false };
}

function assertAtomicFailure({ failure, initialContents }) {
  inTemporaryDirectory((directory) => {
    const targetPath = join(directory, "openapi.json");
    if (initialContents !== undefined) writeFileSync(targetPath, initialContents);
    const beforeExists = initialContents !== undefined;
    const before = beforeExists ? readFileSync(targetPath) : undefined;
    const temporaryPath = join(directory, "openapi.json.atomic.tmp");
    const fsImpl = failure === "write"
      ? { writeFileSync() { throw new Error("write failed"); } }
      : { renameSync() { throw new Error("rename failed"); } };

    assert.throws(
      () => writeOpenApiAtomic("new artifact\n", { outputPath: targetPath, temporaryPath, fsImpl }),
      new RegExp(`${failure} failed`)
    );
    assert.equal(Boolean(beforeExists), Boolean(readdirSync(directory).includes("openapi.json")));
    if (beforeExists) assert.deepEqual(readFileSync(targetPath), before);
    assertNoTemporaryFiles(directory);
  });
}

test("base spec identifies the Airscale public API", () => {
  assert.equal(baseSpec.openapi, "3.1.0");
  assert.equal(baseSpec.info.title, "Airscale Public API");
  assert.equal(baseSpec.info.version, "2026-08-30");
  assert.equal(baseSpec.info.description, "Search, enrich, and resolve public business data with Airscale.");
  assert.equal(baseSpec.info["x-airscale-source-repository"], "ViceScale/airscale-code");
  assert.equal(baseSpec.info["x-airscale-source-sha"], SOURCE_SHA);
  assert.deepEqual(baseSpec.servers, [
    { url: "https://api.airscale.io", description: "Production" }
  ]);
  assert.deepEqual(baseSpec.security, [{ bearerAuth: [] }]);
  assert.deepEqual(baseSpec.tags, [
    { name: "Search and discovery", description: "Search people, companies, and the web." },
    { name: "Contact data", description: "Find professional and personal contact data." },
    { name: "Profiles and reverse lookup", description: "Extract profiles or resolve a person from known contact data." },
    { name: "Account", description: "Inspect workspace account state." }
  ]);
  assert.deepEqual(baseSpec.components.securitySchemes.bearerAuth, {
    type: "http",
    scheme: "bearer",
    bearerFormat: "API key",
    description: "Use an Airscale workspace API key. Never expose the key in client-side code."
  });
});

test("buildSpec inserts fixture operations in catalog order", () => {
  const first = operation("GET", "/first", "firstOperation");
  const second = operation("POST", "/second", "secondOperation");
  const spec = buildSpec({
    base: { paths: {} },
    catalog: catalog(
      { method: "POST", path: "/second", operationId: "secondOperation" },
      { method: "GET", path: "/first", operationId: "firstOperation" }
    ),
    operationModules: [[first], [second]]
  });

  assert.deepEqual(Object.keys(spec.paths), ["/second", "/first"]);
  assert.equal(spec.paths["/second"].post.operationId, "secondOperation");
  assert.equal(spec.paths["/first"].get.operationId, "firstOperation");
});

test("buildSpec clones operations before insertion", () => {
  const fixtureOperation = operation("GET", "/isolated", "isolatedOperation");
  fixtureOperation.operation.summary = "Original";
  const options = {
    base: { paths: {} },
    catalog: catalog({ method: "GET", path: "/isolated", operationId: "isolatedOperation" }),
    operationModules: [[fixtureOperation]]
  };

  const firstSpec = buildSpec(options);
  firstSpec.paths["/isolated"].get.summary = "Mutated";

  assert.equal(fixtureOperation.operation.summary, "Original");
  assert.equal(buildSpec(options).paths["/isolated"].get.summary, "Original");
});

test("buildSpec rejects duplicate method and path entries", () => {
  const expected = { method: "POST", path: "/duplicate", operationId: "duplicateOperation" };
  assert.throws(
    () => buildSpec({
      base: { paths: {} },
      catalog: catalog(expected),
      operationModules: [[
        operation("POST", "/duplicate", "duplicateOperation"),
        operation("POST", "/duplicate", "duplicateOperationTwo")
      ]]
    }),
    /Duplicate OpenAPI method\/path: POST \/duplicate/
  );
});

test("buildSpec rejects case-insensitive duplicate method and path entries", () => {
  assert.throws(
    () => buildSpec({
      base: { paths: {} },
      catalog: catalog({ method: "GET", path: "/same", operationId: "firstOperation" }),
      operationModules: [[
        operation("GET", "/same", "firstOperation"),
        operation("get", "/same", "secondOperation")
      ]]
    }),
    /Duplicate OpenAPI method\/path: GET \/same/
  );
});

test("buildSpec rejects duplicate operation IDs", () => {
  assert.throws(
    () => buildSpec({
      base: { paths: {} },
      catalog: catalog(
        { method: "GET", path: "/one", operationId: "firstOperation" },
        { method: "POST", path: "/two", operationId: "secondOperation" }
      ),
      operationModules: [[
        operation("GET", "/one", "sameOperation"),
        operation("POST", "/two", "sameOperation")
      ]]
    }),
    /Duplicate OpenAPI operationId: sameOperation/
  );
});

test("buildSpec rejects catalog operations missing from modules", () => {
  assert.throws(
    () => buildSpec({
      base: { paths: {} },
      catalog: catalog({ method: "GET", path: "/missing", operationId: "missingOperation" }),
      operationModules: [[]]
    }),
    /Missing OpenAPI operation module entry: GET \/missing/
  );
});

test("buildSpec rejects module operations missing from the catalog", () => {
  assert.throws(
    () => buildSpec({
      base: { paths: {} },
      catalog: catalog({ method: "GET", path: "/expected", operationId: "expectedOperation" }),
      operationModules: [[
        operation("GET", "/expected", "expectedOperation"),
        operation("POST", "/extra", "extraOperation")
      ]]
    }),
    /Extra OpenAPI operation module entry: POST \/extra/
  );
});

test("buildSpec rejects operation ID drift from the catalog", () => {
  assert.throws(
    () => buildSpec({
      base: { paths: {} },
      catalog: catalog({ method: "GET", path: "/drift", operationId: "catalogOperation" }),
      operationModules: [[operation("GET", "/drift", "moduleOperation")]]
    }),
    /Operation ID drift: GET \/drift/
  );
});

test("atomic output preserves an existing target when writing fails", () => {
  assertAtomicFailure({ failure: "write", initialContents: Buffer.from([0xff, 0x00, 0x01]) });
});

test("atomic output leaves an absent target absent when writing fails", () => {
  assertAtomicFailure({ failure: "write" });
});

test("atomic output preserves an existing target when renaming fails", () => {
  assertAtomicFailure({ failure: "rename", initialContents: Buffer.from([0xff, 0x00, 0x01]) });
});

test("atomic output leaves an absent target absent when renaming fails", () => {
  assertAtomicFailure({ failure: "rename" });
});

test("OpenAPI CLI check rejects an absent isolated artifact", () => {
  inTemporaryDirectory((directory) => {
    const targetPath = join(directory, "openapi.json");
    assert.throws(
      () => runCli(["--check"], { buildSpecImpl: fixtureSpec, outputPath: targetPath }),
      /OpenAPI output is missing: openapi.json/
    );
    assert.equal(readdirSync(directory).includes("openapi.json"), false);
  });
});

test("OpenAPI CLI check rejects a stale isolated artifact", () => {
  inTemporaryDirectory((directory) => {
    const targetPath = join(directory, "openapi.json");
    const stale = Buffer.from("stale\n");
    writeFileSync(targetPath, stale);

    assert.throws(
      () => runCli(["--check"], { buildSpecImpl: fixtureSpec, outputPath: targetPath }),
      /OpenAPI output is stale: openapi.json/
    );
    assert.deepEqual(readFileSync(targetPath), stale);
  });
});

test("OpenAPI CLI check accepts an exact isolated artifact", () => {
  inTemporaryDirectory((directory) => {
    const targetPath = join(directory, "openapi.json");
    writeFileSync(targetPath, serializedFixtureSpec());

    assert.doesNotThrow(() => runCli(["--check"], { buildSpecImpl: fixtureSpec, outputPath: targetPath }));
  });
});

test("OpenAPI CLI write atomically creates an isolated artifact", () => {
  inTemporaryDirectory((directory) => {
    const targetPath = join(directory, "openapi.json");
    runCli(["--write"], { buildSpecImpl: fixtureSpec, outputPath: targetPath });

    assert.deepEqual(readFileSync(targetPath), Buffer.from(serializedFixtureSpec(), "utf8"));
    assertNoTemporaryFiles(directory);
  });
});

test("malformed OpenAPI CLI arguments leave an isolated artifact unchanged", () => {
  inTemporaryDirectory((directory) => {
    const targetPath = join(directory, "openapi.json");
    const original = Buffer.from([0xff, 0x00, 0x01]);
    writeFileSync(targetPath, original);

    for (const [args, message] of [
      [["--unsupported"], /Unsupported argument: --unsupported/],
      [[], /Expected exactly one argument: --write or --check/],
      [["--write", "--check"], /Expected exactly one argument: --write or --check/]
    ]) {
      const before = snapshotFile(targetPath);
      assert.throws(() => runCli(args, { buildSpecImpl: fixtureSpec, outputPath: targetPath }), message);
      assert.deepEqual(snapshotFile(targetPath), before);
    }
  });
});

test("OpenAPI output freshness compares bytes instead of lossy UTF-8 text", () => {
  const serialized = "\uFFFD";
  const differentlyEncodedReplacementCharacter = Buffer.from([0xff]);

  assert.equal(differentlyEncodedReplacementCharacter.toString("utf8"), serialized);
  assert.equal(outputMatchesSerialized(serialized, differentlyEncodedReplacementCharacter), false);
});
