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
    linkedin_profile_url: { type: "string", minLength: 1 },
    mode: { type: "string", enum: ["p1", "p2", "p3"] }
  }
};

const profileRequestDescription = "The LinkedIn URL is trimmed and a missing scheme is normalized. The hostname must be linkedin.com or a subdomain, and the first path segment must be /in/, /company/, or /school/. Query and extra path segments are canonicalized away. The submitted URL type chooses the person or company response and successful credit cost, regardless of which of these two routes receives it. When mode is omitted, the response can use a variable source shape; modes p2 and p3 request normalized shapes.";

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
  website: "https://www.example.test",
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
          summary: "Normalized profile extraction",
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
                summary: "Normalized profile",
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
    url: { type: ["string", "null"] },
    identifier: { type: ["string", "null"] },
    link: { type: "object", additionalProperties: true },
    firstname: { type: ["string", "null"] },
    lastname: { type: ["string", "null"] }
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
        linkedin_profile_url: "linkedin.com/in/example-person-000000?source=synthetic",
        mode: "p3"
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
        linkedin_profile_url: "https://www.linkedin.com/company/example-company-000000/about/",
        mode: "p3"
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
            value: { email: " Example.Person@Example.Test " }
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
              pattern: "^(?=.*\\S)[\\s\\S]+$"
            }
          }
        },
        {
          phone: {
            summary: "Synthetic phone number",
            value: { mobile_phone: "+12025550147" }
          }
        },
        "The mobile_phone value is trimmed before lookup and must contain at least one non-whitespace character."
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
