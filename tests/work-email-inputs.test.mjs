import assert from 'node:assert/strict';
import test from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { baseSpec } from '../openapi/base.mjs';
import { contactDataOperations } from '../openapi/operations/contact-data.mjs';

test('work email exposes one combinable field set with conditional minimum inputs', () => {
  const schema = contactDataOperations.find(x => x.path === '/v1/email').operation.requestBody.content['application/json'].schema;
  assert.equal(schema.anyOf, undefined, 'top-level alternatives render as misleading Option tabs');
  assert.equal(schema.oneOf, undefined);
  const ajv = new Ajv2020({strict:false}); addFormats(ajv);
  const validate = ajv.compile({...schema, components:baseSpec.components});
  const profile = {linkedin_profile_url:'https://www.linkedin.com/in/example-person-000000'};
  const name = {first_name:'Example',last_name:'Person'};
  for(const input of [profile, {...name,domain:'example.org'}, {...name,company_name:'Example Company'}, {...profile,...name,domain:'example.org',company_name:'Example Company'}]) assert.equal(validate(input),true,JSON.stringify(validate.errors));
  for(const input of [{},name,{company_name:'Example Company'},{domain:'example.org'},{full_name:'Example Person',domain:'example.org'}]) assert.equal(validate(input),false,JSON.stringify(input));
});
