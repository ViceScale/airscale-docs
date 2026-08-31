import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { baseSpec } from "../openapi/base.mjs";
import { buildSpec } from "../scripts/build-openapi.mjs";

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

test("base spec identifies the Airscale public API", () => {
  assert.equal(baseSpec.openapi, "3.1.0");
  assert.equal(baseSpec.info.title, "Airscale Public API");
  assert.equal(baseSpec.info.version, "2026-08-30");
  assert.equal(baseSpec.info["x-airscale-source-repository"], "ViceScale/airscale-code");
  assert.equal(baseSpec.info["x-airscale-source-sha"], SOURCE_SHA);
  assert.deepEqual(baseSpec.servers, [
    { url: "https://api.airscale.io", description: "Production" }
  ]);
  assert.deepEqual(baseSpec.security, [{ bearerAuth: [] }]);
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

test("unsupported OpenAPI CLI arguments fail without writing output", () => {
  const result = spawnSync(process.execPath, ["scripts/build-openapi.mjs", "--unsupported"], {
    cwd: process.cwd(),
    encoding: "utf8"
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unsupported argument: --unsupported/);
  assert.equal(result.stdout, "");
  assert.equal(spawnSync("test", ["-e", "openapi.json"], { cwd: process.cwd() }).status, 1);
});

test("OpenAPI check fails closed when the generated specification is absent", () => {
  const result = spawnSync(process.execPath, ["scripts/build-openapi.mjs", "--check"], {
    cwd: process.cwd(),
    encoding: "utf8"
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Missing OpenAPI operation module entry: POST \/v1\/credits/);
  assert.equal(spawnSync("test", ["-e", "openapi.json"], { cwd: process.cwd() }).status, 1);
});
