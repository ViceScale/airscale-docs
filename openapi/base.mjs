import { camelPersonRecord, snakePersonRecord } from "./person-record.mjs";

const dateRange = { properties: { start: {}, end: {} } };

function pagedSection(item, description) {
  return {
    description: description ?? "Paginated list section, when available.",
    properties: {
      totalElements: {},
      page: {},
      size: {},
      contents: { type: "array", items: item }
    }
  };
}

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
      LeadsFinderPerson: {
        ...snakePersonRecord,
        description: "A Leads Finder person record with nested snake_case keys. Fields vary per record and may be null; records can include fields not listed here."
      },
      ReverseLookupPerson: {
        ...camelPersonRecord,
        description: "A reverse-lookup person record with nested camelCase keys. Names are under profile (profile.firstName), not at the top level. Fields vary per record and may be null; records can include fields not listed here."
      },
      PeopleLead: {
        type: "object",
        additionalProperties: true,
        description: "A public person record. Other public profile fields may be included; check for missing or null values before using them.",
        properties: {
          firstname: { type: ["string", "null"] },
          lastname: { type: ["string", "null"] },
          profileUrl: { type: ["string", "null"] },
          headline: { type: ["string", "null"] },
          description: { type: ["string", "null"], description: "Profile summary." },
          address: { type: ["string", "null"], description: "Person location." },
          jobTitle: { type: ["string", "null"] },
          jobDescription: { type: ["string", "null"] },
          jobStartDate: { type: ["string", "null"] },
          companyName: { type: ["string", "null"] },
          companyUrn: { type: ["string", "null"] },
          companyUrl: { type: ["string", "null"], description: "LinkedIn company URL." },
          companyWebsite: { type: ["string", "null"] },
          companyDescription: { type: ["string", "null"] },
          companySize: { type: ["integer", "string", "null"] },
          companyIndustry: { type: ["string", "null"] },
          companyAddress: { type: ["string", "null"] }
        }
      },
      CompanyRow: {
        type: "object",
        additionalProperties: true,
        description: "A public company record. Other public company fields may be included; check for missing or null values before using them.",
        properties: {
          name: { type: ["string", "null"] },
          domain: { type: ["string", "null"] },
          website: { type: ["string", "null"] },
          logo: { type: ["string", "null"] },
          countryName: { type: ["string", "null"] },
          cityName: { type: ["string", "null"] },
          linkedinProfile: { type: ["string", "null"] },
          employeeRange: { type: ["string", "null"] },
          revenueRange: { type: ["string", "null"] },
          description: { type: ["string", "null"] },
          naicsDescription: { type: ["string", "null"] },
          sicCode: { type: ["string", "number", "null"] },
          sicDescription: { type: ["string", "null"] },
          location: { type: ["string", "null"], description: "Location text." },
          region: { type: ["string", "null"] },
          industry: { type: ["string", "null"] },
          naics: { type: ["string", "number", "null"] },
          events: { description: "Company events, when requested and available." },
          businessIntentTopics: { description: "Business-intent topics, when requested and available." }
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
        description: "A flat person profile. Field types can vary by data source; check for missing or null values before using them. List sections are paginated objects with totalElements, page, size, and contents.",
        properties: {
          url: { type: ["string", "null"] },
          identifier: { type: ["string", "null"] },
          entityUrn: { description: "Profile URN, when available." },
          objectUrn: { description: "Numeric profile identifier, when available." },
          firstname: { description: "First name, when available." },
          lastname: { description: "Last name, when available." },
          middleName: { description: "Middle name, when available." },
          birthDate: { description: "Birth date, when public." },
          headline: { description: "Profile headline, when available." },
          summary: { description: "Profile summary, when available." },
          picture: { description: "Profile picture URL, when available." },
          background: { description: "Background image URL, when available." },
          industry: { description: "Industry, when available." },
          openToWork: { description: "Open-to-work badge, when available." },
          influencer: { description: "Influencer badge, when available." },
          premium: { description: "Premium badge, when available." },
          creator: { description: "Creator badge, when available." },
          hiring: { description: "Hiring badge, when available." },
          verified: { description: "Verified badge, when available." },
          location: {
            description: "Location information, when available.",
            properties: {
              country: { type: ["string", "null"] },
              city: { type: ["string", "null"] },
              state: { type: ["string", "null"] },
              defaultValue: { type: ["string", "null"], description: "Full location text." },
              shortValue: { type: ["string", "null"], description: "Short location text." }
            }
          },
          positionGroups: pagedSection({
            properties: {
              company: { properties: { id: {}, name: {}, logo: {}, url: {}, domain: {}, profileType: {} } },
              date: dateRange,
              profilePositions: {
                type: "array",
                items: { properties: { company: {}, description: {}, title: {}, employmentType: {}, location: {}, date: dateRange } }
              }
            }
          }, "Work history grouped by company, most recent first."),
          educations: pagedSection({
            properties: {
              school: { properties: { id: {}, name: {}, logo: {}, url: {}, profileType: {} } },
              degreeName: {},
              fieldOfStudy: {},
              grade: {},
              date: dateRange
            }
          }),
          certifications: pagedSection({
            properties: {
              name: {},
              authority: {},
              url: {},
              licenseNumber: {},
              displaySource: {},
              company: { properties: { id: {}, name: {}, logo: {}, url: {}, profileType: {} } },
              date: dateRange
            }
          }),
          languages: pagedSection({ properties: { name: {}, proficiency: {} } }),
          skills: pagedSection({ type: "string" }),
          organizations: pagedSection({}),
          patents: pagedSection({}),
          awards: pagedSection({}),
          projects: pagedSection({}),
          publications: pagedSection({}),
          courses: pagedSection({}),
          testScores: pagedSection({}),
          volunteerExperiences: pagedSection({}),
          profile: { description: "Additional profile data, when available." },
          link: { description: "Profile links, when available." }
        }
      },
      VariableCompanyProfile: {
        type: "object",
        additionalProperties: true,
        description: "A company profile. Field types can vary by data source; check for missing or null values before using them.",
        properties: {
          url: { type: ["string", "null"] },
          name: { type: ["string", "null"] },
          universalName: { type: ["string", "null"] },
          website: { type: ["string", "null"] },
          description: { type: ["string", "null"] },
          type: { description: "Company type, for example Public Company." },
          objectUrn: { description: "Numeric company identifier, when available." },
          phone: { description: "Company phone, when public." },
          followers: { description: "Follower count, when available." },
          logo: { description: "Logo URL, when available." },
          cover: { description: "Cover image URL, when available." },
          tagline: { description: "Tagline, when available." },
          foundedYear: { description: "Founding year, when available." },
          staff: {
            type: ["object", "null"],
            additionalProperties: true,
            properties: {
              total: { description: "Employee count on the profile." },
              range: { description: "Headcount band.", properties: { start: {}, end: {} } }
            }
          },
          locations: {
            type: ["object", "null"],
            additionalProperties: true,
            properties: {
              headquarter: { $ref: "#/components/schemas/CompanyAddress" },
              other: { type: ["array", "null"], items: { $ref: "#/components/schemas/CompanyAddress" } }
            }
          },
          fundingData: { description: "Funding details, when available." },
          industries: { type: ["array", "null"], items: {} },
          specialities: { type: ["array", "null"], items: {} },
          hashtags: { description: "Company hashtags, when available." }
        }
      },
      CompanyAddress: {
        type: ["object", "null"],
        additionalProperties: true,
        properties: {
          country: { type: ["string", "null"] },
          geographicArea: { type: ["string", "null"] },
          city: { type: ["string", "null"] },
          postalCode: { type: ["string", "null"] },
          line1: { type: ["string", "null"] },
          line2: { type: ["string", "null"] },
          isPrimary: { type: ["boolean", "null"] }
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
