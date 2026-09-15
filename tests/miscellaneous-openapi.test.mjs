import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { buildSpec } from '../scripts/build-openapi.mjs';
const spec = buildSpec();
const ajv = new Ajv2020({ strict: false });
addFormats(ajv);
const operation = (path, method = 'post') => {
  assert.ok(spec.paths[path]?.[method], `${method} ${path} must exist`);
  return spec.paths[path][method];
};
const response = (op, code) => ajv.compile(op.responses[code].content['application/json'].schema);
const id = '00000000-0000-4000-8000-000000000001';

test('every authored API page binding resolves, including pages absent from the catalog', () => {
  for (const path of readdirSync('api-reference', { recursive: true }).filter(p => p.endsWith('.mdx'))) {
    const text = readFileSync(`api-reference/${path}`, 'utf8');
    const binding = text.match(/^openapi: ["']?\/openapi.json (\w+) ([^\s"']+)/m);
    if (binding) assert.ok(spec.paths[binding[2]]?.[binding[1].toLowerCase()], `${path}: unresolved ${binding[0]}`);
  }
});
test('WhatsApp schemas preserve strict input, definitive billing and pending states', () => {
  const op = operation('/v1/whatsapp-check');
  const request = ajv.compile(op.requestBody.content['application/json'].schema);
  assert.ok(request({ phone: '+15555550100' }));
  for (const phone of ['15555550100', '+05555550100', ' +15555550100', '+123', 15555550100]) assert.equal(request({ phone }), false);
  assert.equal(request({ phone: '+15555550100', extra: true }), false);
  assert.equal(op.parameters[0].required, false);
  const success = response(op, 200);
  for (const whatsapp of ['yes', 'no']) assert.ok(success({ operation_id: id, phone: '+15555550100', whatsapp, credits_consumed: 1 }));
  assert.equal(success({ operation_id: id, phone: '+15555550100', whatsapp: 'unknown', credits_consumed: 0 }), false);
  const pending = response(op, 202);
  assert.ok(pending({ operation_id: id, status: 'unknown' }));
  assert.equal(pending({ operation_id: id, status: 'unknown', credits_consumed: 1 }), false);
  const lookup = operation('/v1/whatsapp-check/operations/{operation_id}', 'get');
  assert.equal(lookup.requestBody, undefined);
  assert.ok(response(lookup, 200)({ operation_id: id, status: 'completed', whatsapp: 'yes', credits_consumed: 1 }));
  for (const status of ['unavailable', 'rejected']) assert.ok(response(lookup, 200)({ operation_id: id, status }));
  assert.ok(response(lookup, 202)({ operation_id: id, status: 'pending' }));
});
test('Meta Ads preserves provider fields and documents timeout and zero-cost results', () => {
  const op = operation('/v1/meta-ads');
  assert.ok(op.responses[504]);
  const validate = response(op, 200);
  for (const value of [{ number_of_ads: 4, page_id: 'meta-123', credits_consumed: 1 }, { number_of_ads: 'unknown', credits_consumed: 0 }, { credits_consumed: 0 }]) assert.ok(validate(value));
  assert.equal(validate({ number_of_ads: 4 }), false);
  assert.equal(validate({ credits_consumed: 2 }), false);
});
test('Email verifier models direct and wrapped results with passthrough responses', () => {
  const op = operation('/v1/email-verifier');
  const validate = response(op, 200);
  assert.ok(validate({ email: 'person@example.com', result: 'deliverable', credits_consumed: 0.5 }));
  assert.ok(validate({ body: { result: 'risky', credits_consumed: 0.5 }, returned_an_error: false }));
  assert.equal(validate({ result: 'deliverable' }), false);
  for (const value of [null, [], "unstructured result", 42]) assert.ok(validate(value));
  assert.ok(op.responses[200].content["*/*"]);
  for (const code of [400, 401, 403, 413, 500, 502, 503]) {
    assert.ok(response(op, code)({ provider_message: "Request rejected" }));
    assert.ok(op.responses[code].content["*/*"]);
  }
  assert.ok(op.responses.default);
  assert.ok(op.responses[413]);
});
