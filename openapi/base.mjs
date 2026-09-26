export const baseSpec = {
  openapi: "3.1.0",
  info: {
    title: "Airscale Public API",
    version: "2026-09-11",
    description: "Search, enrich, and resolve public business data with Airscale.",
    "x-airscale-source-repository": "ViceScale/airscale-code",
    "x-airscale-source-sha": "1de19e1b70a052a4b8d9c2075021a7e5e7a94d51"
  },
  servers: [{ url: "https://api.airscale.io", description: "Production" }],
  tags: [
    { name: "Search and discovery", description: "Search people, companies, and the web." },
    { name: "Contact data", description: "Find professional and personal contact data." },
    { name: "Profiles and reverse lookup", description: "Extract profiles or resolve a person from known contact data." },
    { name: "Post engagement", description: "Retrieve and enrich people who liked or commented on LinkedIn posts." },
    { name: "Account", description: "Inspect workspace account state." },
    { name: "Miscellaneous", description: "Check WhatsApp availability, Meta ads, and email deliverability." }
  ],
  security: [{ bearerAuth: [] }],
  paths: {},
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "API key",
        description: "Use an Airscale workspace API key. Never expose the key in client-side code."
      }
    },
    schemas: {
      Status: {
        type: "string",
        enum: ["success", "not_found", "timeout"]
      },
      IncludeExcludeFilter: {
        type: "object",
        description: "Use include, exclude, or both. Empty arrays and empty string values are accepted by the runtime, but meaningful non-empty values are recommended.",
        additionalProperties: false,
        properties: {
          include: {
            type: "array",
            maxItems: 200,
            items: { type: "string" }
          },
          exclude: {
            type: "array",
            maxItems: 200,
            items: { type: "string" }
          }
        },
        anyOf: [{ required: ["include"] }, { required: ["exclude"] }]
      },
      IntegerRangeFilter: {
        type: "object",
        minProperties: 1,
        additionalProperties: false,
        properties: {
          ">": { type: "integer" },
          ">=": { type: "integer" },
          "<": { type: "integer" },
          "<=": { type: "integer" }
        }
      },
      GrowthFilter: {
        type: "object",
        description: "Headcount growth bounds for one supported timespan. When both bounds are present, min must be less than or equal to max.",
        "x-airscale-runtime-constraint": "When both are present, min must be less than or equal to max.",
        additionalProperties: false,
        required: ["timespan"],
        properties: {
          min: { type: "number", minimum: -100, maximum: 10000 },
          max: { type: "number", minimum: -100, maximum: 10000 },
          timespan: { type: "string", enum: ["6months", "12months", "24months"] }
        },
        anyOf: [{ required: ["min"] }, { required: ["max"] }]
      },
      StringOrStringArray: {
        oneOf: [
          { type: "string", minLength: 1, pattern: "\\S" },
          {
            type: "array",
            minItems: 1,
            items: { type: "string", minLength: 1, pattern: "\\S" }
          }
        ]
      },
      FlexibleResult: {
        type: "object",
        additionalProperties: true,
        properties: {
          firstname: { type: ["string", "null"] },
          lastname: { type: ["string", "null"] },
          profileUrl: { type: ["string", "null"] },
          jobTitle: { type: ["string", "null"] },
          companyName: { type: ["string", "null"] },
          name: { type: ["string", "null"] },
          domain: { type: ["string", "null"] },
          website: { type: ["string", "null"] },
          countryName: { type: ["string", "null"] },
          cityName: { type: ["string", "null"] },
          linkedinProfile: { type: ["string", "null"] }
        }
      },
      LinkedInPersonUrl: {
        type: "string",
        minLength: 1,
        description: "A recognized LinkedIn person-profile URL or identifier. Airscale normalizes supported profile inputs.",
        example: "https://www.linkedin.com/in/example-person-000000"
      },
      SuccessEmail: {
        type: "object",
        required: ["status", "email"],
        additionalProperties: true,
        properties: {
          status: { type: "string", const: "success" },
          email: { type: "string", format: "email" },
          email_status: {
            type: "string",
            description: "The value is \"valid\" on a successful result."
          },
          provider: { type: "string" },
          verifier: { type: "string" },
          catch_all: { type: "string", enum: ["yes", "no"] },
          linkedin_profile_url: { $ref: "#/components/schemas/LinkedInPersonUrl" }
        }
      },
      NotFoundEmail: {
        type: "object",
        required: ["status", "email"],
        additionalProperties: true,
        properties: {
          status: { type: "string", const: "not_found" },
          email: { type: "null" }
        }
      },
      VariablePersonProfile: {
        type: "object",
        additionalProperties: true,
        properties: {
          url: { type: ["string", "null"] },
          identifier: { type: ["string", "null"] },
          profile: { description: "Additional profile data, when available." },
          link: { description: "Profile links, when available." },
          firstname: { description: "First name, when available." },
          lastname: { description: "Last name, when available." },
          headline: { description: "Profile headline, when available." },
          industry: { description: "Industry, when available." },
          location: { description: "Location information, when available." }
        }
      },
      VariableCompanyProfile: {
        type: "object",
        additionalProperties: true,
        properties: {
          url: { type: ["string", "null"] },
          name: { type: ["string", "null"] },
          universalName: { type: ["string", "null"] },
          website: { type: ["string", "null"] },
          description: { type: ["string", "null"] },
          staff: { type: ["object", "null"], additionalProperties: true },
          locations: { type: ["object", "null"], additionalProperties: true },
          industries: { type: ["array", "null"], items: {} },
          specialities: { type: ["array", "null"], items: {} }
        }
      },
      NotFoundStatus: {
        type: "object",
        required: ["status"],
        additionalProperties: false,
        properties: {
          status: { type: "string", const: "not_found" }
        }
      },
      Error: {
        type: "object",
        additionalProperties: true,
        properties: {
          error: { type: "string" },
          message: { type: "string" }
        }
      }
    },
    responses: {
      Unauthorized: {
        description: "The Bearer token is missing or invalid.",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } }
      }
    }
  }
};
