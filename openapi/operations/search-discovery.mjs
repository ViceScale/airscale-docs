const TAG = "Search and discovery";
const SEARCH_RATE_LIMIT = "6 requests per second per workspace.";

const errorDescriptions = {
  400: "The request is invalid or contains an unsupported field or value.",
  403: "The workspace cannot complete this request because access or available credits are insufficient.",
  404: "The HTTP method or path does not match this public endpoint.",
  413: "The JSON request body exceeds the 256 KiB limit.",
  429: "The workspace rate limit has been exceeded. Try again after the current window resets.",
  500: "The request could not be completed because of an unexpected server error.",
  502: "The request could not be completed because a required service returned an unsuccessful response.",
  503: "The request is temporarily unavailable. Try again later.",
  504: "The initial research stage exceeded its time limit. Narrow the prompt before retrying."
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

const includeExcludeFilters = [
  "firstname",
  "lastname",
  "jobTitle",
  "school",
  "languages",
  "skills",
  "location",
  "keyword",
  "currentCompanyName",
  "companyDomain",
  "companyLinkedinUrl",
  "currentCompany.type",
  "currentCompany.industry",
  "currentCompany.location",
  "currentCompany.keyword",
  "pastJobTitle",
  "pastCompanyName",
  "pastCompanyId",
  "pastCompanyWebsite",
  "pastCompanyUrn",
  "pastCompany.type",
  "pastCompany.industry",
  "pastCompany.location",
  "pastCompany.keyword"
];

const integerRangeFilters = [
  "totalYearsOfExperience",
  "timeInCurrentCompany",
  "currentCompany.headcount",
  "currentCompany.revenue",
  "pastCompany.headcount",
  "pastCompany.revenue"
];

const growthFilters = [
  "currentCompany.headcountGrowth",
  "pastCompany.headcountGrowth"
];

const findPeopleQuerySchema = {
  type: "object",
  minProperties: 1,
  additionalProperties: false,
  properties: {
    ...Object.fromEntries(includeExcludeFilters.map((name) => [
      name,
      { $ref: "#/components/schemas/IncludeExcludeFilter" }
    ])),
    ...Object.fromEntries(integerRangeFilters.map((name) => [
      name,
      { $ref: "#/components/schemas/IntegerRangeFilter" }
    ])),
    ...Object.fromEntries(growthFilters.map((name) => [
      name,
      { $ref: "#/components/schemas/GrowthFilter" }
    ]))
  }
};

const findPeopleRequestExample = {
  query: {
    jobTitle: { include: ["Revenue Operations Manager"] },
    location: { include: ["Example Country"] }
  },
  size: 50
};

const findPeoplePageExample = {
  total: 124,
  leads: [
    {
      firstname: "Example",
      lastname: "Person",
      profileUrl: "https://www.linkedin.com/in/example-person-000000",
      jobTitle: "Revenue Operations Manager",
      companyName: "Example Company"
    }
  ],
  next_cursor: "fp_synthetic_cursor"
};

const findPeopleResponseSchema = {
  type: "object",
  required: ["total", "leads", "next_cursor"],
  additionalProperties: false,
  properties: {
    total: { type: "number" },
    leads: { type: "array", items: { $ref: "#/components/schemas/FlexibleResult" } },
    next_cursor: { type: ["string", "null"] }
  }
};

function stringOrArrayEnum(values) {
  return {
    oneOf: [
      { type: "string", enum: values },
      {
        type: "array",
        minItems: 1,
        items: { type: "string", enum: values }
      }
    ]
  };
}

const companySizeValues = [
  "1-10", "11-50", "51-200", "201-500", "501-1000", "1001-5000", "5001-10000", "10001+"
];
const companyRevenueValues = [
  "0-500K", "500K-1M", "1M-5M", "5M-10M", "10M-25M", "25M-75M", "75M-200M",
  "200M-500M", "500M-1B", "1B-10B", "10B-100B", "100B-1T", "1T-10T", "10T+"
];
const companyAgeValues = ["0-3", "3-6", "6-10", "10-20", "20+"];
const companyLocationValues = ["0-1", "2-5", "6-20", "21-50", "51-100", "101-1000", "1001+"];
const companyEventValues = [
  "increase_in_customer_service_department",
  "hiring_in_finance_department",
  "hiring_in_support_department",
  "increase_in_engineering_department",
  "decrease_in_customer_service_department",
  "hiring_in_operations_department",
  "hiring_in_creative_department",
  "decrease_in_engineering_department",
  "hiring_in_sales_department",
  "increase_in_operations_department",
  "hiring_in_trade_department",
  "decrease_in_marketing_department",
  "increase_in_marketing_department",
  "hiring_in_marketing_department",
  "hiring_in_health_department",
  "hiring_in_education_department",
  "increase_in_all_departments",
  "decrease_in_all_departments",
  "decrease_in_sales_department",
  "decrease_in_operations_department",
  "hiring_in_professional_service_department",
  "hiring_in_human_resources_department",
  "increase_in_sales_department",
  "hiring_in_legal_department",
  "hiring_in_unknown_department",
  "hiring_in_engineering_department",
  "company_award",
  "new_product",
  "employee_joined_company",
  "merger_and_acquisitions",
  "lawsuits_and_legal_issues",
  "outages_and_security_breaches",
  "closing_office",
  "new_investment",
  "new_office",
  "new_partnership",
  "cost_cutting",
  "new_funding_round",
  "award",
  "ipo_announcement"
];

const companyListFilterNames = [
  "country", "region", "city", "industry", "techStack", "keywords", "topics", "companyName"
];
const stringOrStringArrayRef = { $ref: "#/components/schemas/StringOrStringArray" };
const companyRealFilterNames = [
  ...companyListFilterNames,
  "size", "revenue", "age", "events", "locations", "hasWebsite", "isPublicCompany"
];

const findCompaniesFiltersSchema = {
  type: "object",
  minProperties: 1,
  additionalProperties: false,
  properties: {
    country: stringOrStringArrayRef,
    region: stringOrStringArrayRef,
    city: stringOrStringArrayRef,
    industry: stringOrStringArrayRef,
    size: stringOrArrayEnum(companySizeValues),
    revenue: stringOrArrayEnum(companyRevenueValues),
    age: stringOrArrayEnum(companyAgeValues),
    techStack: stringOrStringArrayRef,
    keywords: stringOrStringArrayRef,
    topics: stringOrStringArrayRef,
    events: stringOrArrayEnum(companyEventValues),
    locations: stringOrArrayEnum(companyLocationValues),
    companyName: stringOrStringArrayRef,
    eventWindow: {
      type: "string",
      enum: ["30 days", "60 days", "90 days"],
      default: "30 days"
    },
    locationMatch: {
      type: "string",
      enum: ["hqOnly", "hqOperating"],
      default: "hqOnly"
    },
    hasWebsite: { type: ["boolean", "null"] },
    isPublicCompany: { type: ["boolean", "null"] }
  },
  anyOf: companyRealFilterNames.map((name) => (
    name === "hasWebsite" || name === "isPublicCompany"
      ? { required: [name], properties: { [name]: { type: "boolean" } } }
      : { required: [name] }
  ))
};

const filterValuesFilterSchema = {
  type: "string",
  enum: ["city", "region", "industry", "topics", "techStack"]
};

const filterValueOptionSchema = {
  type: "object",
  required: ["label", "value"],
  additionalProperties: false,
  properties: {
    label: { type: "string" },
    value: { type: "string" },
    query: { type: "string" },
    city: { type: "string" },
    region: { type: "string" },
    countryCode: { type: "string" },
    regionCode: { type: "string" }
  }
};

const filterValuesResponseSchema = {
  type: "object",
  required: ["filter", "query", "values"],
  additionalProperties: false,
  properties: {
    filter: filterValuesFilterSchema,
    query: { type: "string" },
    values: {
      type: "array",
      items: filterValueOptionSchema
    }
  }
};

const queryAliasDescription = "At least one of q or query is required. This alias supplies the search text.";
const repeatedContextSchema = {
  oneOf: [
    { type: "string" },
    { type: "array", items: { type: "string" } }
  ]
};

const airsearchRequestSchema = {
  type: "object",
  required: ["prompt"],
  additionalProperties: false,
  properties: {
    prompt: {
      type: "string",
      minLength: 1,
      pattern: "\\S",
      description: "A research question or instruction that remains non-empty after surrounding whitespace is trimmed."
    },
    schema: {
      type: "object",
      propertyNames: { minLength: 1, pattern: "\\S" },
      additionalProperties: {
        type: "string",
        minLength: 1,
        pattern: "\\S"
      },
      description: "Maps arbitrary requested output names to non-empty type keywords or plain-language descriptions."
    }
  }
};

const airsearchResponseSchema = {
  type: "object",
  required: ["status", "response", "reasoning", "sources", "confidence_score", "certainty_tag", "duration_ms"],
  properties: {
    status: { $ref: "#/components/schemas/Status" },
    response: {
      oneOf: [
        { type: "string" },
        { type: "object", additionalProperties: true }
      ]
    },
    reasoning: { type: ["string", "null"] },
    sources: { type: "array", items: { type: "string", format: "uri" } },
    confidence_score: { type: "number", minimum: 0, maximum: 1 },
    certainty_tag: { type: "string", enum: ["low", "medium", "high"] },
    duration_ms: { type: "number", minimum: 0 }
  },
  additionalProperties: { type: ["string", "null"] }
};

export const searchDiscoveryOperations = [
  {
    method: "POST",
    path: "/v1/find-people",
    operation: {
      operationId: "findPeople",
      tags: [TAG],
      summary: "Find people",
      description: "Searches for people who match structured person, role, and company filters. The JSON request body is limited to 256 KiB.",
      "x-airscale-rate-limit": SEARCH_RATE_LIMIT,
      "x-airscale-credit-cost": "0.1 credits per returned lead; no charge when no leads are returned.",
      requestBody: requestBody(
        {
          type: "object",
          required: ["query"],
          additionalProperties: false,
          properties: {
            query: findPeopleQuerySchema,
            size: { type: "integer", minimum: 1, maximum: 100, default: 100 },
            cursor: {
              type: "string",
              minLength: 1,
              description: "An opaque value returned as next_cursor by the preceding page. Send it unchanged."
            }
          }
        },
        {
          audience: {
            summary: "Synthetic audience",
            value: findPeopleRequestExample
          }
        },
        "Provide at least one supported query filter. Search pagination accepts a page size from 1 to 100 and an optional opaque cursor."
      ),
      responses: {
        200: {
          description: "A page of matching public lead records.",
          content: {
            "application/json": {
              schema: findPeopleResponseSchema,
              examples: {
                page: {
                  summary: "Synthetic lead page",
                  value: findPeoplePageExample
                }
              }
            }
          }
        },
        ...errorResponses([400, 401, 403, 404, 413, 429, 502, 503])
      }
    }
  },
  {
    method: "POST",
    path: "/v1/find-people/count",
    operation: {
      operationId: "countPeople",
      tags: [TAG],
      summary: "Count people",
      description: "Counts people using the exact same structured query contract as Find People, without retrieving or paginating lead records.",
      "x-airscale-rate-limit": SEARCH_RATE_LIMIT,
      "x-airscale-credit-cost": "No charge; Count does not debit Airscale credits.",
      requestBody: requestBody(
        {
          type: "object",
          required: ["query"],
          additionalProperties: false,
          properties: { query: findPeopleQuerySchema }
        },
        {
          audience: {
            summary: "Synthetic audience count",
            value: { query: findPeopleRequestExample.query }
          }
        },
        "Provide at least one supported query filter. Count has no size or cursor fields."
      ),
      responses: {
        200: {
          description: "The number of people matching the query.",
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["total"],
                additionalProperties: false,
                properties: { total: { type: "number" } }
              },
              examples: {
                count: {
                  summary: "Synthetic audience count",
                  value: { total: 124 }
                }
              }
            }
          }
        },
        ...errorResponses([400, 401, 403, 404, 413, 429, 502, 503])
      }
    }
  },
  {
    method: "POST",
    path: "/v1/find-companies",
    operation: {
      operationId: "findCompanies",
      tags: [TAG],
      summary: "Find companies",
      description: "Searches for companies using firmographic, geographic, event, intent, technology, and website filters. The JSON request body is limited to 256 KiB.",
      "x-airscale-rate-limit": SEARCH_RATE_LIMIT,
      "x-airscale-credit-cost": "0.1 credits per returned company; no charge when no companies are returned.",
      requestBody: requestBody(
        {
          type: "object",
          required: ["filters"],
          additionalProperties: false,
          properties: {
            filters: findCompaniesFiltersSchema,
            page: { type: "integer", minimum: 0, default: 0 },
            size: { type: "integer", minimum: 1, maximum: 100, default: 50 },
            cursor: {
              type: "string",
              pattern: "^fc_",
              description: "An opaque fc_ cursor returned by the preceding page. When supplied, its saved page size takes precedence over new page or size values."
            }
          }
        },
        {
          audience: {
            summary: "Synthetic company audience",
            value: {
              filters: {
                country: ["FR"],
                size: ["11-50"],
                keywords: ["workflow automation"]
              },
              size: 25
            }
          }
        },
        "Provide at least one real company filter. Defaults such as eventWindow and locationMatch do not count as filters."
      ),
      responses: {
        200: {
          description: "A page of matching sanitized public company records.",
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["rows", "total", "page", "size", "next_cursor"],
                additionalProperties: false,
                properties: {
                  rows: { type: "array", items: { $ref: "#/components/schemas/FlexibleResult" } },
                  total: { type: "number" },
                  page: { type: "number" },
                  size: { type: "number" },
                  next_cursor: { type: ["string", "null"] }
                }
              },
              examples: {
                reservedData: {
                  summary: "Synthetic company page using reserved example data",
                  value: {
                    rows: [
                      {
                        name: "Example Company",
                        domain: "example.test",
                        website: "https://www.example.test",
                        countryName: "Example Country",
                        cityName: "Example City"
                      }
                    ],
                    total: 240,
                    page: 0,
                    size: 25,
                    next_cursor: "fc_eyJ2IjoxLCJtb2RlIjoicGFnZSIsInBhZ2UiOjEsInBhZ2VTaXplIjoyNSwicHJvdmlkZXJTaXplIjoxMDAwMH0"
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
    method: "GET",
    path: "/v1/find-companies/filter-values",
    operation: {
      operationId: "listFindCompanyFilterValues",
      tags: [TAG],
      summary: "List Find Companies filter values",
      description: "Discovers normalized values accepted by location, industry, intent-topic, and technology filters.",
      "x-airscale-rate-limit": SEARCH_RATE_LIMIT,
      "x-airscale-credit-cost": "No charge; Filter-values does not debit Airscale credits.",
      parameters: [
        {
          name: "filter",
          in: "query",
          required: true,
          description: "The Find Companies filter whose accepted values should be discovered.",
          schema: filterValuesFilterSchema
        },
        {
          name: "q",
          in: "query",
          required: false,
          description: queryAliasDescription,
          schema: { type: "string", minLength: 2, maxLength: 120 }
        },
        {
          name: "query",
          in: "query",
          required: false,
          description: queryAliasDescription,
          schema: { type: "string", minLength: 2, maxLength: 120 }
        },
        {
          name: "limit",
          in: "query",
          required: false,
          description: "Omitted, non-numeric, or non-integer values default to 20; an explicit empty value becomes 0 then clamps to 1; integers below 1 clamp to 1; integers above 100 clamp to 100.",
          schema: {
            oneOf: [{ type: "integer" }, { type: "string" }],
            default: 20,
            example: 20
          }
        },
        {
          name: "country",
          in: "query",
          required: false,
          description: "Optional country context supplied as repeat or comma-separated values.",
          style: "form",
          explode: true,
          schema: repeatedContextSchema
        },
        {
          name: "region",
          in: "query",
          required: false,
          description: "Optional region context supplied as repeat or comma-separated values; a bare region name needs country context.",
          style: "form",
          explode: true,
          schema: repeatedContextSchema
        }
      ],
      responses: {
        200: {
          description: "Normalized filter values matching the query and optional location context.",
          content: {
            "application/json": {
              schema: filterValuesResponseSchema,
              examples: {
                industry: {
                  summary: "Synthetic industry values",
                  value: {
                    filter: "industry",
                    query: "example",
                    values: [
                      { label: "Example industry", value: "example industry" }
                    ]
                  }
                },
                city: {
                  summary: "Synthetic city values",
                  value: {
                    filter: "city",
                    query: "exa",
                    values: [
                      {
                        query: "exa",
                        label: "Example City",
                        value: "Example City, EX, XX",
                        city: "Example City",
                        region: "EX",
                        countryCode: "xx",
                        regionCode: "xx-ex"
                      }
                    ]
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
    path: "/v1/airsearch",
    operation: {
      operationId: "airsearch",
      tags: [TAG],
      summary: "Research the web with Airsearch",
      description: "Researches a public question and returns a sourced answer with optional requested output fields. The JSON request body is limited to 256 KiB.",
      "x-airscale-rate-limit": "300 requests per minute per workspace.",
      "x-airscale-credit-cost": "1 credit only for status success; not_found and timeout are not charged.",
      requestBody: requestBody(
        airsearchRequestSchema,
        {
          structuredResearch: {
            summary: "Research a reserved example domain",
            value: {
              prompt: "Summarize the public product description on https://example.com.",
              schema: {
                company_name: "string",
                website: "url",
                summary: "Short product summary"
              }
            }
          }
        },
        "Provide a non-empty prompt and, optionally, a map of requested output names to type keywords or descriptions."
      ),
      responses: {
        200: {
          description: "A completed research result, including successful, not-found, and soft-timeout outcomes.",
          content: {
            "application/json": {
              schema: airsearchResponseSchema,
              examples: {
                success: {
                  summary: "Synthetic successful research",
                  value: {
                    status: "success",
                    response: "Example Company publishes a synthetic product description.",
                    company_name: "Example Company",
                    website: "https://example.com",
                    summary: "A synthetic product summary.",
                    reasoning: "The reserved example page directly supports the summary.",
                    sources: ["https://example.com"],
                    confidence_score: 0.94,
                    certainty_tag: "high",
                    duration_ms: 8420
                  }
                },
                notFound: {
                  summary: "No usable result",
                  value: {
                    status: "not_found",
                    response: "No relevant information found.",
                    company_name: null,
                    website: null,
                    summary: null,
                    reasoning: null,
                    sources: [],
                    confidence_score: 0.1,
                    certainty_tag: "low",
                    duration_ms: 6900
                  }
                },
                timeout: {
                  summary: "Soft timeout",
                  value: {
                    status: "timeout",
                    response: "No relevant information found.",
                    company_name: null,
                    website: null,
                    summary: null,
                    reasoning: null,
                    sources: [],
                    confidence_score: 0,
                    certainty_tag: "low",
                    duration_ms: 150000
                  }
                }
              }
            }
          }
        },
        ...errorResponses([400, 401, 403, 413, 429, 500, 502, 503, 504])
      }
    }
  }
];
