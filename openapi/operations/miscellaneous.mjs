const sourceSha = '282e64878898b4f7082e6ce00b740d76aca787f1';
const id = '00000000-0000-4000-8000-000000000001';
const uuid = { type: 'string', format: 'uuid', description: 'Operation UUID.' };
const phone = { type: 'string', pattern: '^\\+[1-9]\\d{6,14}$', description: 'Strict E.164 number, with no spaces or punctuation other than the leading +.' };
const object = (properties, required = Object.keys(properties), additionalProperties = false) => ({ type: 'object', properties, required, additionalProperties });
const json = (description, schema, examples = {}) => ({ description, content: { 'application/json': { schema, examples: Object.fromEntries(Object.entries(examples).map(([key, value]) => [key, { value }])) } } });
const error = (description) => json(description, object({ error: { type: 'string' }, message: { type: 'string' }, operation_id: uuid }, ['error'], true));
const verifierJson = (...args) => {
  const response = json(...args);
  response.content['*/*'] = { schema: {} };
  return response;
};
const verifierError = (description) => ({
  description: `${description} Initial provider errors with this same status are passed through unchanged after an attempted refund; their body may differ.`,
  content: { 'application/json': { schema: {} }, '*/*': { schema: {} } }
});
const request = (schema, value) => ({ required: true, content: { 'application/json': { schema, examples: { request: { value } } } } });
const common = {
  tags: ['Miscellaneous'],
  'x-airscale-source-sha': sourceSha
};
const pending = json('The operation is pending or its outcome is uncertain. Look up this operation ID before retrying; do not infer a yes/no result or final charge.', object({ operation_id: uuid, status: { type: 'string', enum: ['pending', 'unknown'] } }), {
  pending: { operation_id: id, status: 'pending' },
  unknown: { operation_id: id, status: 'unknown' }
});
const whatsappErrors = {
  400: error('Invalid request or UUID. POST requires exactly one strict E.164 phone field and a JSON body of at most 16 KiB; oversized bodies also return 400.'),
  401: { $ref: '#/components/responses/Unauthorized' },
  500: error('Unexpected server error.'),
  503: error('Authentication or operation storage is unavailable.')
};
const verificationBody = object({
  email: { description: 'Email field preserved from the provider response, when present.' },
  status: { description: 'Provider status, when present. Pending verification is polled before returning.' },
  result: { description: 'Provider deliverability result, when present; risky is used when pending verification cannot be resolved.' },
  credits_consumed: { type: 'number', const: 0.5 }
}, ['credits_consumed'], true);
export const miscellaneousOperations = [
  {
    method: 'POST', path: '/v1/whatsapp-check', operation: {
      ...common, operationId: 'checkWhatsapp', summary: 'Check WhatsApp availability',
      description: 'Check one phone number. Definitive yes and no outcomes both cost one credit. An optional Idempotency-Key makes retries of the same phone reuse the operation; a different phone with the same key returns 409. When omitted, the server generates an operation ID. Save the returned ID for reconciliation.',
      'x-airscale-rate-limit': '60 requests per minute per workspace for POST, including replays.',
      'x-airscale-credit-cost': '1 credit for a definitive yes or no. Pending and unknown responses do not report a final charge.',
      parameters: [{ name: 'Idempotency-Key', in: 'header', required: false, description: 'Optional UUID (versions 1–5). Reuse the same key and phone for retries of one logical check. The server trims whitespace and normalizes UUID case.', schema: { type: 'string', pattern: '^\\s*[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}\\s*$' }, example: id }],
      requestBody: request(object({ phone }), { phone: '+12025550147' }),
      responses: {
        200: json('Definitive WhatsApp result.', object({ operation_id: uuid, phone, whatsapp: { type: 'string', enum: ['yes', 'no'] }, credits_consumed: { type: 'integer', const: 1 } }), {
          yes: { operation_id: id, phone: '+12025550147', whatsapp: 'yes', credits_consumed: 1 },
          no: { operation_id: id, phone: '+12025550147', whatsapp: 'no', credits_consumed: 1 }
        }),
        202: pending, ...whatsappErrors,
        403: error('Insufficient credits. A durably recorded rejection includes operation_id.'),
        409: error('The idempotency key belongs to a different request.'),
        429: error('Workspace POST rate limit exceeded.'),
        503: error('Authentication, rate limiting, operation storage, or WhatsApp checking is unavailable. A recorded unavailable operation includes operation_id. Reuse the same key when reconciling a request.')
      }
    }
  },
  {
    method: 'GET', path: '/v1/whatsapp-check/operations/{operation_id}', operation: {
      ...common, operationId: 'getWhatsappCheckOperation', summary: 'Get WhatsApp check status',
      description: 'Read a previously submitted operation in the authenticated workspace. This lookup does not start another check or charge credits. A completed result omits the phone; unavailable and rejected are terminal states returned with HTTP 200. Pending or unknown states return HTTP 202.',
      'x-airscale-rate-limit': 'No endpoint-specific GET throttle.',
      'x-airscale-credit-cost': 'No additional charge for this read-only lookup.',
      parameters: [{ name: 'operation_id', in: 'path', required: true, schema: { ...uuid, pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' }, example: id }],
      responses: {
        200: json('Completed check or terminal unavailable/rejected operation.', { oneOf: [
          object({ operation_id: uuid, status: { type: 'string', const: 'completed' }, whatsapp: { type: 'string', enum: ['yes', 'no'] }, credits_consumed: { type: 'integer', const: 1 } }),
          object({ operation_id: uuid, status: { type: 'string', enum: ['unavailable', 'rejected', 'completed'], description: 'A completed state without result fields means a definitive stored result could not be confirmed.' } })
        ] }, {
          completed: { operation_id: id, status: 'completed', whatsapp: 'yes', credits_consumed: 1 },
          unavailable: { operation_id: id, status: 'unavailable' },
          rejected: { operation_id: id, status: 'rejected' }
        }),
        202: pending, ...whatsappErrors,
        404: error('Operation not found in this workspace.')
      }
    }
  },
  {
    method: 'POST', path: '/v1/meta-ads', operation: {
      ...common, operationId: 'lookupMetaAds', summary: 'Look up Meta ads',
      description: 'Look up ads for one company domain. Provider fields are preserved. Only a finite numeric number_of_ads greater than zero costs one credit; zero, missing, nonnumeric, or nonpositive counts cost zero. A balance of at least one credit is required before lookup. No caller idempotency key is supported; retrying a successful lookup can incur another charge.',
      'x-airscale-rate-limit': '60 requests per minute per workspace.',
      'x-airscale-credit-cost': '1 credit for a positive finite numeric ad count; otherwise 0.',
      requestBody: request(object({ domain: { type: 'string', minLength: 1, description: 'Bare company hostname or HTTP(S) URL. Whitespace is trimmed; hostname is lowercased and leading www. and trailing dot are removed. Paths and queries are ignored. IP literals, credentials, non-default ports, and invalid domain labels are rejected. Maximum JSON body size: 16 KiB (oversize returns 400).' } }), { domain: 'example.com' }),
      responses: {
        200: json('Provider result with the settled credit cost. Provider fields are optional and are not coerced to fixed types.', object({ page_id: { description: 'Provider page identifier, when present.' }, number_of_ads: { description: 'Provider ad count, when present. Only a positive finite number is billable.' }, credits_consumed: { type: 'integer', enum: [0, 1] } }, ['credits_consumed'], true), {
          ads: { page_id: 'meta-123', number_of_ads: 4, credits_consumed: 1 },
          noAds: { number_of_ads: 0, credits_consumed: 0 }
        }),
        400: error('Invalid JSON, domain, extra fields, or body larger than 16 KiB.'),
        401: { $ref: '#/components/responses/Unauthorized' },
        403: error('Insufficient credits.'),
        429: error('Workspace rate limit exceeded.'),
        502: error('Provider request failed or returned an invalid response.'),
        503: error('Authentication, rate limiting, configuration, or credit settlement is unavailable.'),
        504: error('Provider lookup exceeded its 90-second timeout. No debit is made for this timeout.')
      }
    }
  },
  {
    method: 'POST', path: '/v1/email-verifier', operation: {
      ...common, operationId: 'verifyEmail', summary: 'Verify an email address',
      description: 'Verify one email address for 0.5 credits. Pending verification is polled for up to 45 seconds after the initial provider request without another debit; unresolved pending results become risky. Provider JSON object fields and any body wrapper are preserved. The legacy /email-verifier route is also available. No caller idempotency key is supported.',
      'x-airscale-rate-limit': 'No endpoint-specific throttle.',
      'x-airscale-credit-cost': '0.5 credits reserved per request. Provider request failures attempt a refund; refund failure returns 503.',
      requestBody: request(object({ email: { type: 'string', pattern: '^\\s*[^\\s@]+@[^\\s@]+\\.[^\\s@]+\\s*$', description: 'One email address. Surrounding whitespace is trimmed; the trimmed value must be at most 320 characters. Maximum JSON body size: 16 KiB.' } }), { email: 'person@example.com' }),
      responses: {
        200: verifierJson('Normalized provider JSON object, either direct or wrapped in body. credits_consumed is added to the effective result object; other provider fields remain optional. Non-object or non-JSON successful provider responses are passed through unchanged under this same status.', { anyOf: [{ not: { type: 'object' } }, verificationBody, object({ body: verificationBody, returned_an_error: { type: 'boolean', const: false } }, ['body', 'returned_an_error'], true)] }, {
          direct: { email: 'person@example.com', result: 'deliverable', credits_consumed: 0.5 },
          wrapped: { body: { email: 'person@example.com', status: 'success', result: 'risky', credits_consumed: 0.5 }, returned_an_error: false }
        }),
        400: verifierError('Invalid JSON or body does not contain exactly one valid email field.'),
        401: verifierError('Missing or invalid bearer API key.'),
        403: verifierError('Insufficient credits.'),
        413: verifierError('JSON body exceeds 16 KiB.'),
        500: verifierError('Server configuration or unexpected server error.'),
        502: verifierError('Authentication lookup or provider network request failed.'),
        503: verifierError('Credit reservation or refund service is unavailable.'),
        default: { description: 'Provider status and body are preserved for other responses, including initial non-2xx errors (for example 422). A refund is attempted for an initial non-2xx response. Non-object or non-JSON successful payloads also pass through unchanged, without an added credits_consumed field.', content: { 'application/json': { schema: {} }, '*/*': { schema: {} } } }
      }
    }
  }
];

