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
  description: `${description} Error bodies may vary. A failed verification is eligible for a refund; a 503 can mean the charge or refund could not be confirmed.`,
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
const keys = (names) => Object.fromEntries(names.map((name) => [name, {}]));
const metaAdCard = { type: 'object', properties: keys(['body', 'cta_type', 'caption', 'link_description', 'link_url', 'title', 'cta_text', 'video_hd_url', 'video_preview_image_url', 'video_sd_url', 'watermarked_video_hd_url', 'watermarked_video_sd_url', 'image_crops', 'original_image_url', 'resized_image_url', 'watermarked_resized_image_url']) };
const metaAdSnapshot = {
  type: 'object',
  properties: {
    ...keys(['page_id', 'page_profile_uri', 'page_name', 'page_profile_picture_url', 'caption', 'cta_text', 'cta_type', 'display_format', 'link_description', 'link_url', 'images', 'page_categories', 'page_like_count', 'title', 'videos', 'extra_links', 'extra_texts', 'extra_images', 'extra_videos', 'current_page_name', 'page_entity_type', 'page_is_profile_page']),
    body: { description: 'Ad text, as { text }.', properties: { text: {} } },
    cards: { type: 'array', description: 'Carousel cards, when the ad has several.', items: metaAdCard }
  }
};
const metaAd = {
  type: 'object',
  properties: {
    ...keys(['ad_archive_id', 'collation_id', 'page_id', 'is_active', 'page_name', 'categories', 'publisher_platform', 'total_active_time', 'entity_type', 'url']),
    start_date: { description: 'Start time as a Unix timestamp in seconds.' },
    end_date: { description: 'End time as a Unix timestamp in seconds.' },
    start_date_string: { description: 'Start time as text.' },
    end_date_string: { description: 'End time as text.' },
    snapshot: metaAdSnapshot
  }
};
const metaAdsBody = object({
  page_id: { description: 'Meta page identifier, when present.' },
  number_of_ads: { description: 'Ad count, when present. Only a positive finite number is billable.' },
  credits_consumed: { type: 'integer', enum: [0, 1] },
  ...keys(['country_code', 'continuation_token', 'platform', 'media_types', 'sort_data', 'active_status', 'is_result_complete', 'count_landing_pages', 'unique_landing_pages', 'start_min_date', 'start_max_date']),
  results: { type: 'array', description: 'Ads found for the page, when there are any. Ad fields vary; check for missing or null values before using them.', items: metaAd }
}, ['credits_consumed'], true);
const metaAdsExample = {
  page_id: '100000000000001',
  country_code: null,
  continuation_token: 'example-continuation-token',
  platform: ['FACEBOOK', 'INSTAGRAM'],
  media_types: 'all',
  sort_data: 'SORT_BY_TOTAL_IMPRESSIONS',
  active_status: 'active',
  is_result_complete: false,
  number_of_ads: 4,
  count_landing_pages: 1,
  unique_landing_pages: ['https://www.example.com/'],
  start_min_date: '2026-01-01',
  start_max_date: '2026-03-01',
  results: [{
    ad_archive_id: '200000000000001',
    collation_id: null,
    page_id: '100000000000001',
    is_active: true,
    page_name: 'Example Company',
    categories: ['UNKNOWN'],
    start_date: 1767225600,
    end_date: 1772323200,
    start_date_string: '2026-01-01',
    end_date_string: '2026-03-01',
    publisher_platform: ['FACEBOOK', 'INSTAGRAM'],
    total_active_time: null,
    entity_type: null,
    url: 'https://www.example.com/ads/200000000000001',
    snapshot: {
      page_id: '100000000000001',
      page_profile_uri: 'https://www.example.com/example-company',
      page_name: 'Example Company',
      page_profile_picture_url: 'https://www.example.com/images/example-company.png',
      caption: 'example.com',
      title: 'Example ad title',
      body: { text: 'Synthetic ad text for API documentation.' },
      cta_text: 'Learn more',
      cta_type: 'LEARN_MORE',
      display_format: 'DCO',
      link_description: null,
      link_url: 'https://www.example.com/',
      page_categories: ['Software'],
      page_like_count: 1200,
      images: [],
      videos: [],
      extra_links: [],
      extra_texts: [],
      extra_images: [],
      extra_videos: [],
      current_page_name: null,
      page_entity_type: null,
      page_is_profile_page: null,
      cards: [{
        body: 'Synthetic card text.',
        caption: 'example.com',
        title: 'Example card title',
        cta_text: 'Learn more',
        cta_type: 'LEARN_MORE',
        link_description: null,
        link_url: 'https://www.example.com/',
        original_image_url: 'https://www.example.com/images/example-ad.png',
        resized_image_url: 'https://www.example.com/images/example-ad-small.png',
        watermarked_resized_image_url: null,
        video_hd_url: null,
        video_sd_url: null,
        video_preview_image_url: null,
        watermarked_video_hd_url: null,
        watermarked_video_sd_url: null,
        image_crops: []
      }]
    }
  }],
  credits_consumed: 1
};
const verificationBody = object({
  email: { description: 'Email address, when present. Validate the value type before using it.' },
  status: { description: 'Verification status, when present.' },
  result: { description: 'Deliverability result, when present; risky means verification remained inconclusive.' },
  credits_consumed: { type: 'number', const: 0.5 },
  score: { description: 'Deliverability score from 0 to 100, when present.' },
  is_accept_all: { description: 'Whether the domain accepts all addresses (catch-all), when present.' },
  is_disposable: { description: 'Whether the address is disposable, when present.' },
  is_free: { description: 'Whether the address uses a free email provider, when present.' },
  is_role: { description: 'Whether the address is a role address such as sales@, when present.' },
  mx_records: { description: 'Mail servers for the domain, when present.' },
  smtp_provider: { description: 'Mail hosting service for the domain, when present.' },
  mode: { description: 'Verification mode, when present.' },
  id: { description: 'Verification identifier, when present.' },
  verify_at: { description: 'Verification time, when present.' },
  credits_remaining: { description: 'Balance reported by the verification service, when present. This is not your Airscale credit balance; use POST /v1/credits for that.' }
}, ['credits_consumed'], true);
const verificationSuccess = verifierJson('A verification result, either at the top level or inside body. JSON object results include credits_consumed; other fields are optional and their types can vary. Successful responses can also contain non-object JSON or non-JSON content without a credits_consumed field.', { anyOf: [{ not: { type: 'object' } }, verificationBody, object({ body: verificationBody, returned_an_error: { type: 'boolean', const: false } }, ['body', 'returned_an_error'], true)] }, {
          direct: { email: 'person@example.com', status: 'success', result: 'deliverable', score: 100, is_accept_all: false, is_disposable: false, is_free: false, is_role: false, mx_records: ['mx1.example.com'], smtp_provider: 'Example Mail', mode: 'regular', id: 'example-verification-000001', verify_at: '2026-01-01T00:00:00Z', credits_remaining: 1000, credits_consumed: 0.5 },
          wrapped: { body: { email: 'person@example.com', status: 'success', result: 'risky', credits_consumed: 0.5 }, returned_an_error: false }
        });
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
      description: 'Look up ads for one company domain. Only a finite numeric number_of_ads greater than zero costs one credit; zero, missing, nonnumeric, or nonpositive counts cost zero. A balance of at least one credit is required before lookup. No caller idempotency key is supported; retrying a successful lookup can incur another charge.',
      'x-airscale-rate-limit': '60 requests per minute per workspace.',
      'x-airscale-credit-cost': '1 credit for a positive finite numeric ad count; otherwise 0.',
      requestBody: request(object({ domain: { type: 'string', minLength: 1, description: 'Bare company hostname or HTTP(S) URL. Whitespace is trimmed; hostname is lowercased and leading www. and trailing dot are removed. Paths and queries are ignored. IP literals, credentials, non-default ports, and invalid domain labels are rejected. Maximum JSON body size: 16 KiB (oversize returns 400).' } }), { domain: 'example.com' }),
      responses: {
        200: json('Ad lookup result and credit cost. Ad fields are optional and their types can vary.', metaAdsBody, {
          ads: metaAdsExample,
          noAds: { number_of_ads: 0, credits_consumed: 0 }
        }),
        400: error('Invalid JSON, domain, extra fields, or body larger than 16 KiB.'),
        401: { $ref: '#/components/responses/Unauthorized' },
        403: error('Insufficient credits.'),
        429: error('Workspace rate limit exceeded.'),
        502: error('The ad lookup failed. Retry with increasing delays and a fixed retry limit.'),
        503: error('The request is temporarily unavailable. Retry with increasing delays and a fixed retry limit; contact support if errors persist.'),
        504: error('The lookup exceeded its 90-second timeout. No debit is made for this timeout.')
      }
    }
  },
  {
    method: 'POST', path: '/v1/email-verifier', operation: {
      ...common, operationId: 'verifyEmail', summary: 'Verify an email address',
      description: 'Verify one email address for 0.5 credits. Allow at least 135 seconds plus a network margin for the response. Inconclusive verification returns risky without another charge. Read the result from body when present, otherwise from the top level. The legacy /email-verifier route is also available. No caller idempotency key is supported.',
      'x-airscale-rate-limit': 'No endpoint-specific throttle.',
      'x-airscale-credit-cost': '0.5 credits reserved per request. Failed verification requests are eligible for a refund; 503 can mean the charge or refund could not be confirmed.',
      requestBody: request(object({ email: { type: 'string', pattern: '^\\s*[^\\s@]+@[^\\s@]+\\.[^\\s@]+\\s*$', description: 'One email address. Surrounding whitespace is trimmed; the trimmed value must be at most 320 characters. Maximum JSON body size: 16 KiB.' } }), { email: 'person@example.com' }),
      responses: {
        200: verificationSuccess,
        201: { ...verificationSuccess, description: 'The same result as 200. The success status code and Content-Type are passed through from the verification service, so a successful verification can also arrive as 201.' },
        400: verifierError('Invalid JSON or body does not contain exactly one valid email field.'),
        401: verifierError('Missing or invalid bearer API key.'),
        403: verifierError('Insufficient credits.'),
        413: verifierError('JSON body exceeds 16 KiB.'),
        500: verifierError('An unexpected server error occurred.'),
        502: verifierError('The verification request could not be completed.'),
        503: verifierError('The charge or refund could not be confirmed. Do not assume credits have been returned.'),
        default: { description: 'Other errors, such as 422, can have varying bodies. Failed verification requests are eligible for a refund. Successful responses can also contain non-object JSON or non-JSON content without a credits_consumed field.', content: { 'application/json': { schema: {} }, '*/*': { schema: {} } } }
      }
    }
  }
];

