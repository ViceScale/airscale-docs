import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import SwaggerParser from '@apidevtools/swagger-parser';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { renderPublication } from '../scripts/prepare-publication.mjs';
import { buildSpec } from '../scripts/build-openapi.mjs';
import { baseSpec } from '../openapi/base.mjs';
import { jobChangeMonitorOperations } from '../archived/job-change-monitors/operations.mjs';

const archive = 'archived/job-change-monitors';
const catalog = JSON.parse(readFileSync(`${archive}/catalog.json`, 'utf8'));
const hiddenReference = /job-change-monitors|JobChange|Job.change monitoring/i;

test('hidden monitor API cannot leak through routes, navigation, schemas or discovery files', () => {
  const files = renderPublication();
  for (const [name, data] of files) {
    assert.doesNotMatch(name, /job-change-monitors|^archived\//);
    if (/\.(?:mdx|json|txt|xml|js)$/.test(name)) assert.doesNotMatch(data.toString(), hiddenReference, name);
  }
  assert.equal(catalog.operations.length, 9);
  for (const { page } of catalog.operations) {
    const archivedPage = `${archive}/pages/${page.replace('api-reference/job-change-monitors/', '')}.md`;
    const text = readFileSync(archivedPage, 'utf8');
    assert.match(text, /V2 workspace API key/);
    assert.match(text, /V1 \(Bubble\) API keys are not supported/);
    assert.equal(files.has(`${page}.mdx`), false);
  }
});

test('archived monitor contract remains restorable with profile limits and required read body', async () => {
  const base = structuredClone(baseSpec);
  Object.assign(base.components.schemas, JSON.parse(readFileSync(`${archive}/schemas.json`, 'utf8')));
  const spec = await SwaggerParser.dereference(buildSpec({ catalog, operationModules: [jobChangeMonitorOperations], base }));
  const ajv = new Ajv2020({ strict: false });
  addFormats(ajv);
  const profiles = Array.from({ length: 10_000 }, (_, index) => ({ linkedin_url: `https://www.linkedin.com/in/example-${index}` }));
  for (const [path, extra] of [['/v1/job-change-monitors', { name: 'CRM champions' }], ['/v1/job-change-monitors/{monitor_id}/profiles', {}]]) {
    const op = spec.paths[path].post;
    const validate = ajv.compile(op.requestBody.content['application/json'].schema);
    assert.equal(validate({ ...extra, profiles }), true);
    assert.equal(validate({ ...extra, profiles: [...profiles, profiles[0]] }), false);
    assert.equal(validate({ ...extra, profiles: [] }), false);
    assert.match(op.requestBody.description, /8 MiB/);
  }
  const read = spec.paths['/v1/job-change-monitors/{monitor_id}/events/{event_id}/read'].post;
  assert.equal(read.requestBody.required, true);
  assert.deepEqual(read.requestBody.content['application/json'].examples.acknowledgement.value, {});
});
