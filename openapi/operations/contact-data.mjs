const PROFILE_EXAMPLE = "https://www.linkedin.com/in/example-person-000000";

const errorDescriptions = {
  400: "The JSON body is invalid or required identification fields are missing.",
  403: "The workspace cannot complete this request because access or available credits are insufficient.",
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

function emailIdentificationSchema({ includeCustomId = false } = {}) {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      ...(includeCustomId ? {
        custom_id: {
          not: { type: "null" },
          description: "Any non-null JSON value is echoed unchanged."
        }
      } : {}),
      linkedin_profile_url: { $ref: "#/components/schemas/LinkedInPersonUrl" },
      first_name: { type: "string", minLength: 1 },
      last_name: { type: "string", minLength: 1 },
      domain: { type: "string", minLength: 1 },
      company_name: { type: "string", minLength: 1 }
    },
    anyOf: [
      { required: ["linkedin_profile_url"] },
      {
        required: ["first_name", "last_name"],
        anyOf: [{ required: ["domain"] }, { required: ["company_name"] }]
      }
    ]
  };
}

const emailResultContent = {
  "application/json": {
    schema: {
      oneOf: [
        { $ref: "#/components/schemas/SuccessEmail" },
        { $ref: "#/components/schemas/NotFoundEmail" }
      ]
    },
    examples: {
      success: {
        summary: "Email found",
        value: { status: "success", email: "example.person@example.test" }
      },
      notFound: {
        summary: "No email found",
        value: { status: "not_found", email: null }
      }
    }
  }
};

const profileRequestSchema = {
  type: "object",
  required: ["linkedin_profile_url"],
  additionalProperties: false,
  properties: {
    linkedin_profile_url: { $ref: "#/components/schemas/LinkedInPersonUrl" }
  }
};

const profileRequestExamples = {
  profile: {
    summary: "Person profile",
    value: { linkedin_profile_url: PROFILE_EXAMPLE }
  }
};

export const contactDataOperations = [
  {
    method: "POST",
    path: "/v1/email",
    operation: {
      operationId: "findProfessionalEmail",
      tags: ["Contact data"],
      summary: "Find a professional email",
      description: "Finds a professional email from a recognized person profile or from a complete name and company identifier. The JSON request body is limited to 256 KiB.",
      "x-airscale-rate-limit": "3,000 requests per minute per workspace.",
      "x-airscale-credit-cost": "2 credits only when the response has status success; not_found is not charged.",
      requestBody: requestBody(
        emailIdentificationSchema(),
        {
          byProfile: {
            summary: "Identify by profile",
            value: { linkedin_profile_url: PROFILE_EXAMPLE }
          },
          byName: {
            summary: "Identify by name and domain",
            value: { first_name: "Example", last_name: "Person", domain: "example.test" }
          }
        },
        "Provide either a recognized non-empty person profile, or first and last name with a domain or company name. Both complete forms may be supplied together. The JSON body must not exceed 256 KiB."
      ),
      responses: {
        200: {
          description: "A professional email result or a not-found result.",
          content: emailResultContent
        },
        ...errorResponses([400, 401, 403, 413, 429, 500, 502, 503])
      }
    }
  },
  {
    method: "POST",
    path: "/v1/email-bulk",
    operation: {
      operationId: "findProfessionalEmailsBulk",
      tags: ["Contact data"],
      summary: "Submit a professional email batch",
      description: "Accepts up to 100 professional-email inputs and sends results to the supplied HTTP webhook URL after processing.",
      "x-airscale-rate-limit": "3,000 input items per minute per workspace.",
      "x-airscale-credit-cost": "2 credits per item with status success; misses and timeouts are not charged.",
      requestBody: requestBody(
        {
          type: "object",
          required: ["webhook_url", "inputs"],
          additionalProperties: false,
          properties: {
            webhook_url: { type: "string", minLength: 1, pattern: "^http" },
            inputs: {
              type: "array",
              minItems: 1,
              maxItems: 100,
              items: emailIdentificationSchema({ includeCustomId: true })
            }
          }
        },
        {
          batch: {
            summary: "Two synthetic contacts",
            value: {
              webhook_url: "https://webhook.example.test/email-results",
              inputs: [
                { custom_id: "contact-001", linkedin_profile_url: PROFILE_EXAMPLE },
                { custom_id: 2002, first_name: "Sample", last_name: "Contact", company_name: "Example Company" }
              ]
            }
          }
        },
        "Provide a webhook URL and between 1 and 100 inputs. Each input may include an optional custom_id and must identify a person by profile or by complete name and company information."
      ),
      responses: {
        202: {
          description: "The batch was accepted for asynchronous processing.",
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["status", "count"],
                additionalProperties: false,
                properties: {
                  status: { type: "string", const: "accepted" },
                  count: { type: "integer", minimum: 1, maximum: 100 }
                }
              },
              examples: {
                accepted: {
                  summary: "Batch accepted",
                  value: { status: "accepted", count: 2 }
                }
              }
            }
          }
        },
        ...errorResponses([400, 401, 403, 413, 429, 500, 502])
      }
    }
  },
  {
    method: "POST",
    path: "/v1/phone",
    operation: {
      operationId: "findMobilePhone",
      tags: ["Contact data"],
      summary: "Find a mobile phone number",
      description: "Finds a mobile phone number for a recognized person profile.",
      "x-airscale-rate-limit": "3,000 requests per minute per workspace.",
      "x-airscale-credit-cost": "40 credits only when the response has status success; not_found is not charged.",
      requestBody: requestBody(
        profileRequestSchema,
        profileRequestExamples,
        "Provide the recognized person profile to search."
      ),
      responses: {
        200: {
          description: "A mobile phone result or a not-found result.",
          content: {
            "application/json": {
              schema: {
                oneOf: [
                  {
                    type: "object",
                    required: ["status", "linkedin_profile_url", "phone_numbers", "provider"],
                    additionalProperties: true,
                    properties: {
                      status: { type: "string", const: "success" },
                      linkedin_profile_url: { $ref: "#/components/schemas/LinkedInPersonUrl" },
                      phone_numbers: { type: "string" },
                      provider: {
                        type: ["string", "null"],
                        description: "A public source label when one is available."
                      }
                    }
                  },
                  {
                    type: "object",
                    required: ["status", "linkedin_profile_url", "phone_numbers", "provider"],
                    additionalProperties: true,
                    properties: {
                      status: { type: "string", const: "not_found" },
                      linkedin_profile_url: { $ref: "#/components/schemas/LinkedInPersonUrl" },
                      phone_numbers: { type: "null" },
                      provider: { type: ["string", "null"] }
                    }
                  }
                ]
              },
              examples: {
                success: {
                  summary: "Mobile phone found",
                  value: {
                    status: "success",
                    linkedin_profile_url: PROFILE_EXAMPLE,
                    phone_numbers: "+12025550123"
                  }
                },
                notFound: {
                  summary: "No mobile phone found",
                  value: {
                    status: "not_found",
                    linkedin_profile_url: PROFILE_EXAMPLE,
                    phone_numbers: null,
                    provider: null
                  }
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
    path: "/v1/personal-email",
    operation: {
      operationId: "findPersonalEmail",
      tags: ["Contact data"],
      summary: "Find a personal email",
      description: "Finds a personal email for a recognized person profile, with optional verification behavior.",
      "x-airscale-rate-limit": "2,000 requests per minute per workspace.",
      "x-airscale-credit-cost": "3–12 credits for a successful result; not_found is not charged.",
      requestBody: requestBody(
        {
          type: "object",
          required: ["linkedin_profile_url"],
          additionalProperties: false,
          properties: {
            linkedin_profile_url: { $ref: "#/components/schemas/LinkedInPersonUrl" },
            verification: {
              oneOf: [{ type: "boolean" }, { type: "string" }]
            }
          }
        },
        {
          profile: {
            summary: "Person profile with verification enabled",
            value: { linkedin_profile_url: PROFILE_EXAMPLE, verification: true }
          }
        },
        "Provide the recognized person profile. verification may be a boolean or string."
      ),
      responses: {
        200: {
          description: "A personal email result or a not-found result.",
          content: {
            "application/json": {
              schema: {
                oneOf: [
                  { $ref: "#/components/schemas/SuccessEmail" },
                  { $ref: "#/components/schemas/NotFoundEmail" }
                ]
              },
              examples: {
                success: {
                  summary: "Personal email found",
                  value: { status: "success", email: "personal.example@example.test" }
                },
                notFound: {
                  summary: "No personal email found",
                  value: { status: "not_found", email: null }
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
    path: "/v1/url-search-people",
    operation: {
      operationId: "findPeopleProfileUrl",
      tags: ["Contact data"],
      summary: "Find a person's profile URL",
      description: "Finds a person's public profile URL from their name and company name.",
      "x-airscale-rate-limit": "6 requests per second per workspace.",
      "x-airscale-credit-cost": "0.5 credits only when the response has status success; not_found is not charged.",
      requestBody: requestBody(
        {
          type: "object",
          required: ["first_name", "last_name", "company_name"],
          additionalProperties: false,
          properties: {
            first_name: { type: "string", minLength: 1 },
            last_name: { type: "string", minLength: 1 },
            company_name: { type: "string", minLength: 1 }
          }
        },
        {
          person: {
            summary: "Synthetic person and company",
            value: { first_name: "Example", last_name: "Person", company_name: "Example Company" }
          }
        },
        "Provide the person's first name, last name, and company name."
      ),
      responses: {
        200: {
          description: "A profile URL result or a not-found result.",
          content: {
            "application/json": {
              schema: {
                oneOf: [
                  {
                    type: "object",
                    required: ["status", "url"],
                    additionalProperties: true,
                    properties: {
                      status: { type: "string", const: "success" },
                      url: { type: "string" }
                    }
                  },
                  {
                    type: "object",
                    required: ["status"],
                    additionalProperties: true,
                    properties: {
                      status: { type: "string", const: "not_found" }
                    }
                  }
                ]
              },
              examples: {
                success: {
                  summary: "Profile URL found",
                  value: { status: "success", url: PROFILE_EXAMPLE }
                },
                notFound: {
                  summary: "No profile URL found",
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
