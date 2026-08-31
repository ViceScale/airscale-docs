export const baseSpec = {
  openapi: "3.1.0",
  info: {
    title: "Airscale Public API",
    version: "2026-08-30",
    description: "Search, enrich, and resolve public business data with Airscale.",
    "x-airscale-source-repository": "ViceScale/airscale-code",
    "x-airscale-source-sha": "8606866a5fb1f9405a94d49cfa9fbddaf4aaf431"
  },
  servers: [{ url: "https://api.airscale.io", description: "Production" }],
  tags: [
    { name: "Search and discovery", description: "Search people, companies, and the web." },
    { name: "Contact data", description: "Find professional and personal contact data." },
    { name: "Profiles and reverse lookup", description: "Extract profiles or resolve a person from known contact data." },
    { name: "Account", description: "Inspect workspace account state." }
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
          profile: { description: "A pass-through profile value whose type and shape vary by response source." },
          link: { description: "A pass-through link value whose type and shape vary by response source." },
          firstname: { description: "A pass-through public first-name value whose type varies by response source." },
          lastname: { description: "A pass-through public last-name value whose type varies by response source." },
          headline: { description: "A pass-through public headline value whose type varies by response source." },
          industry: { description: "A pass-through public industry value whose type varies by response source." },
          location: { description: "A pass-through public location value whose type and shape vary by response source." }
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
