const TAG = "Profiles and reverse lookup";
const PERSON_URL = "https://www.linkedin.com/in/example-person-000000";

const errorDescriptions = {
  400: "The JSON body is invalid or a required input is missing or invalid.",
  403: "The workspace cannot complete this request because access or available credits are insufficient.",
  404: "No profile could be extracted for the submitted LinkedIn URL.",
  413: "The JSON request body exceeds the 256 KiB limit.",
  429: "The workspace rate limit has been exceeded. Try again after the current window resets.",
  500: "The request could not be completed because of an unexpected server error.",
  502: "The request could not be completed because a required service returned an unsuccessful response.",
  503: "The request is temporarily unavailable. Try again later."
};

function jsonError(description) {
  return {
    description,
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/Error" }
      }
    }
  };
}

function errorResponses(statuses) {
  return Object.fromEntries(statuses.map((status) => [
    status,
    status === 401
      ? { $ref: "#/components/responses/Unauthorized" }
      : jsonError(errorDescriptions[status])
  ]));
}

function requestBody(schema, examples, description) {
  return {
    required: true,
    description,
    content: {
      "application/json": {
        schema,
        examples
      }
    }
  };
}

const profileRequestSchema = {
  type: "object",
  required: ["linkedin_profile_url"],
  additionalProperties: false,
  properties: {
    linkedin_profile_url: { type: "string", minLength: 1 }
  }
};

const profileRequestDescription = "The LinkedIn URL is trimmed and a missing scheme is normalized. The hostname must be linkedin.com or a subdomain, and the first path segment must be /in/, /company/, or /school/. Query and extra path segments are canonicalized away. The submitted URL type chooses the person or company response and successful credit cost, regardless of which of these two routes receives it. Response fields and their types can vary; check for missing or null values before using them.";

const profileResponseSchema = {
  anyOf: [
    { $ref: "#/components/schemas/VariablePersonProfile" },
    { $ref: "#/components/schemas/VariableCompanyProfile" }
  ]
};

const personExample = {
  url: PERSON_URL,
  identifier: "example-person-000000",
  firstname: "Example",
  lastname: "Person",
  headline: "Example role at Example Company",
  industry: "Software Development",
  location: {
    country: "United States",
    city: "Example City",
    state: "Example State"
  }
};

const companyExample = {
  url: "https://www.linkedin.com/company/example-company-000000",
  name: "Example Company",
  universalName: "example-company-000000",
  website: "https://www.example.org",
  description: "Synthetic company profile for API documentation.",
  staff: { total: 120, range: "51-200" },
  locations: {
    headquarter: { country: "United States", city: "Example City" },
    other: []
  },
  industries: ["Software Development"],
  specialities: ["Synthetic data"]
};

const profileRateLimit = "3,000 requests per minute per workspace.";
const profileCreditCost = "URL-selected: /in/ successes cost 1 credit by default (workspace-specific pricing may differ); /company/ or /school/ successes cost 0.5 credits; unsuccessful requests are not charged.";

function profileOperation({ operationId, summary, description, requestExample, responseExample }) {
  return {
    operationId,
    tags: [TAG],
    summary,
    description,
    "x-airscale-rate-limit": profileRateLimit,
    "x-airscale-credit-cost": profileCreditCost,
    requestBody: requestBody(
      profileRequestSchema,
      {
        profile: {
          summary: "Extract a LinkedIn profile",
          value: requestExample
        }
      },
      profileRequestDescription
    ),
    responses: {
      200: {
        description: "The submitted URL selects a person or company profile response.",
        content: {
          "application/json": {
            schema: profileResponseSchema,
            examples: {
              success: {
                summary: "Example profile",
                value: responseExample
              }
            }
          }
        }
      },
      ...errorResponses([400, 401, 403, 404, 413, 429, 500, 502, 503])
    }
  };
}

const reversePhoneSuccessSchema = {
  type: "object",
  required: ["body"],
  additionalProperties: true,
  properties: {
    body: { type: "object", additionalProperties: true },
    url: { description: "Profile URL, when available." },
    identifier: { description: "Profile identifier, when available." },
    link: { description: "Profile links, when available. Check the value type before using it." },
    firstname: { description: "First name, when available. Check the value type before using it." },
    lastname: { description: "Last name, when available. Check the value type before using it." }
  }
};

const reversePhonePerson = {
  url: PERSON_URL,
  identifier: "example-person-000000",
  firstname: "Example",
  lastname: "Person",
  link: { linkedin: PERSON_URL }
};

export const profileLookupOperations = [
  {
    method: "POST",
    path: "/v1/profile",
    operation: profileOperation({
      operationId: "extractPersonProfile",
      summary: "Extract a person profile",
      description: "Extracts public profile data. The submitted URL determines whether the successful response is a person or company object.",
      requestExample: {
        linkedin_profile_url: "linkedin.com/in/example-person-000000?source=synthetic"
      },
      responseExample: personExample
    })
  },
  {
    method: "POST",
    path: "/v1/company",
    operation: profileOperation({
      operationId: "extractCompanyProfile",
      summary: "Extract a company profile",
      description: "Extracts public profile data. The submitted URL determines whether the successful response is a person or company object.",
      requestExample: {
        linkedin_profile_url: "https://www.linkedin.com/company/example-company-000000/about/"
      },
      responseExample: companyExample
    })
  },
  {
    method: "POST",
    path: "/v1/reverse-email",
    operation: {
      operationId: "reverseEmailLookup",
      tags: [TAG],
      summary: "Find a profile from an email",
      description: "Resolves a public person profile from an email address, or returns the JSON string \"not found\" when no profile is available.",
      "x-airscale-rate-limit": "25 requests per second per workspace.",
      "x-airscale-credit-cost": "2 credits only when a profile is returned; \"not found\" and errors are not charged.",
      requestBody: requestBody(
        {
          type: "object",
          required: ["email"],
          additionalProperties: false,
          properties: {
            email: {
              type: "string",
              pattern: "^\\s*[^\\s@]+@[^\\s@]+\\.[^\\s@]+\\s*$"
            }
          }
        },
        {
          email: {
            summary: "Synthetic email",
            value: { email: " Example.Person@Example.Org " }
          }
        },
        "The email is trimmed and lowercased before lookup. It must have a non-empty local part, an @ sign, and a domain containing a dot."
      ),
      responses: {
        200: {
          description: "A public person profile or the exact JSON string \"not found\".",
          content: {
            "application/json": {
              schema: {
                oneOf: [
                  { $ref: "#/components/schemas/VariablePersonProfile" },
                  { type: "string", enum: ["not found"] }
                ]
              },
              examples: {
                success: {
                  summary: "Profile found",
                  value: {
                    url: PERSON_URL,
                    identifier: "example-person-000000",
                    firstname: "Example",
                    lastname: "Person",
                    headline: "Example role at Example Company"
                  }
                },
                notFound: {
                  summary: "No profile found",
                  value: "not found"
                }
              }
            }
          }
        },
        ...errorResponses([400, 401, 403, 413, 429, 500, 502, 503])
      }
    }
  },
  {
    method: "POST",
    path: "/v1/reverse-phone",
    operation: {
      operationId: "reversePhoneLookup",
      tags: [TAG],
      summary: "Find a profile from a phone number",
      description: "Resolves a public person profile from a phone-number string, or returns a not_found status when no profile is available.",
      "x-airscale-rate-limit": "2,000 requests per minute per workspace.",
      "x-airscale-credit-cost": "10 credits only when a profile is returned; not_found and errors are not charged.",
      requestBody: requestBody(
        {
          type: "object",
          required: ["mobile_phone"],
          additionalProperties: false,
          properties: {
            mobile_phone: {
              type: "string",
              minLength: 1,
              pattern: "^(?!\\s*(?:null|undefined)\\s*$)(?=.*\\S)[\\s\\S]+$"
            }
          }
        },
        {
          phone: {
            summary: "Synthetic phone number",
            value: { mobile_phone: "+12025550147" }
          }
        },
        "The mobile_phone value is trimmed before lookup and must contain at least one non-whitespace character. The exact trimmed lowercase strings \"null\" and \"undefined\" are treated as missing input."
      ),
      responses: {
        200: {
          description: "A public person profile in a body envelope, or an exact not_found status.",
          content: {
            "application/json": {
              schema: {
                oneOf: [
                  reversePhoneSuccessSchema,
                  { $ref: "#/components/schemas/NotFoundStatus" }
                ]
              },
              examples: {
                success: {
                  summary: "Profile found",
                  value: {
                    ...reversePhonePerson,
                    body: reversePhonePerson
                  }
                },
                notFound: {
                  summary: "No profile found",
                  value: { status: "not_found" }
                }
              }
            }
          }
        },
        ...errorResponses([400, 401, 403, 413, 429, 500, 502, 503])
      }
    }
  }
];

profileLookupOperations.push({
  method: "POST",
  path: "/v1/domain-to-linkedin",
  operation: {
    operationId: "findCompanyLinkedinUrl",
    tags: [TAG],
    summary: "Find a LinkedIn company URL from a domain",
    description: "Accepts only a company domain and returns only its LinkedIn company URL. Use a current workspace API key from Airscale Settings; keys from the previous dashboard are not supported. The lookup deadline is 120 seconds; allow 130 seconds in the client. The charge may appear after the result, including after a top-up if your balance is insufficient.",
    "x-airscale-rate-limit": "180 requests per minute per workspace.",
    "x-airscale-credit-cost": "0.5 credits on success; the charge may appear later, including after a top-up. No-result and failed lookups cost zero.",
    parameters: [{
      name: "Idempotency-Key",
      in: "header",
      required: false,
      description: "Use the same key for transport retries of the same domain. Stored responses replay for seven days without another lookup or charge. In-flight duplicates return 409 with Retry-After: 2. Reusing a key with a different domain or after expiry returns 409. A new key starts a new operation. Without a key every request is a new operation.",
      schema: { type: "string", minLength: 1, maxLength: 200, pattern: "^[!-~]+$" },
      example: "company-lookup-001"
    }],
    requestBody: requestBody(
      {
        type: "object",
        required: ["domain"],
        additionalProperties: false,
        properties: { domain: { type: "string", minLength: 1, description: "A company hostname without scheme, path, port, or credentials. Case and a leading www. are normalized." } }
      },
      { domain: { summary: "Company domain", value: { domain: "example.org" } } },
      "Exactly one domain field. Maximum JSON body size: 4 KiB."
    ),
    responses: {
      200: {
        description: "A canonical LinkedIn company URL. Costs 0.5 credits; the charge may appear later.",
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["linkedin_company_url"],
              additionalProperties: false,
              properties: { linkedin_company_url: { type: "string", format: "uri", pattern: "^https://www\\.linkedin\\.com/company/[^/?#]+$" } }
            },
            examples: { success: { summary: "Illustrative company match", value: { linkedin_company_url: "https://www.linkedin.com/company/example-company-000000" } } }
          }
        }
      },
      400: jsonError("Invalid JSON, domain, extra body fields, or Idempotency-Key."),
      401: { $ref: "#/components/responses/Unauthorized" },
      404: jsonError("No matching LinkedIn company URL found. Not charged."),
      409: {
        ...jsonError("Operation in progress, key reused for a different domain, or expired key. Retry in-flight operations with the same key; use a new key for conflicts or expiry."),
        headers: { "Retry-After": { description: "Present for an in-flight duplicate: retry after 2 seconds.", schema: { type: "string" }, example: "2" } }
      },
      413: jsonError("JSON request body exceeds 4 KiB."),
      429: jsonError("180 requests per minute per workspace exceeded. Retry with bounded backoff."),
      503: jsonError("The lookup is temporarily unavailable. Retry according to the idempotency guidance."),
      504: jsonError("Lookup deadline exhausted. Not charged.")
    }
  }
});
