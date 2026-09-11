const TAG = "Post engagement";
const POST_URL = "https://www.linkedin.com/posts/example_activity-7376356221991178240";
const CODE_SAMPLE_POST_URL = "https://example.com/linkedin-post-example";

const errorDescriptions = {
  400: "The JSON body, LinkedIn post URL, or cursor is invalid.",
  402: "The workspace does not have enough credits to reserve profile enrichment for this page.",
  413: "The JSON request body exceeds the 128 KiB limit.",
  429: "The workspace has exceeded the 60 requests per minute post-engagement limit.",
  500: "The request could not be completed because of an unexpected server error.",
  502: "The post-engagement bridge could not be reached or returned an invalid response.",
  503: "A provider, profile-enrichment, pagination, or credit-settlement dependency is temporarily unavailable."
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
      "application/json": { schema, examples }
    }
  };
}

const postEngagementRequestSchema = {
  type: "object",
  required: ["post_url"],
  additionalProperties: false,
  properties: {
    post_url: {
      type: "string",
      format: "uri",
      minLength: 1,
      maxLength: 2048,
      description: "An HTTP(S) LinkedIn post URL containing an activity identifier."
    },
    limit: {
      type: "integer",
      minimum: 1,
      maximum: 25,
      default: 25,
      description: "Number of engagements to request on this page."
    },
    cursor: {
      type: ["string", "null"],
      minLength: 1,
      maxLength: 8192,
      description: "An opaque cursor returned by the preceding page. Send it unchanged."
    }
  }
};

const postEngagementItemSchema = {
  type: "object",
  required: [
    "profile_status",
    "linkedin_url",
    "first_name",
    "last_name",
    "full_name",
    "company_name",
    "job_title",
    "location",
    "domain",
    "linkedin_company_url",
    "headline",
    "reaction_type",
    "comment",
    "post_url"
  ],
  additionalProperties: false,
  properties: {
    profile_status: {
      type: "string",
      enum: ["success", "not_found", "error"],
      description: "Profile enrichment outcome for this engagement."
    },
    linkedin_url: { type: ["string", "null"] },
    first_name: { type: ["string", "null"] },
    last_name: { type: ["string", "null"] },
    full_name: { type: ["string", "null"] },
    company_name: { type: ["string", "null"] },
    job_title: { type: ["string", "null"] },
    location: { type: ["string", "null"] },
    domain: { type: ["string", "null"] },
    linkedin_company_url: { type: ["string", "null"] },
    headline: { type: ["string", "null"] },
    reaction_type: { type: ["string", "null"] },
    comment: { type: ["string", "null"] },
    post_url: { type: ["string", "null"] }
  }
};

const postEngagementResponseSchema = {
  type: "object",
  required: ["items", "pagination", "billing"],
  additionalProperties: false,
  properties: {
    items: {
      type: "array",
      items: postEngagementItemSchema,
      description: "The requested engagements with public profile fields and enrichment status."
    },
    pagination: {
      type: "object",
      required: ["next_cursor", "has_more"],
      additionalProperties: false,
      properties: {
        next_cursor: {
          type: ["string", "null"],
          description: "Opaque cursor for the next page, or null when the result is complete."
        },
        has_more: { type: "boolean" }
      }
    },
    provider: {
      type: "string",
      enum: ["b2benrichment", "rapidapi", "unipile"],
      description: "The provider selected for this page. Treat this value as informational."
    },
    billing: {
      type: "object",
      required: ["credits_consumed", "credits_refunded", "outcomes"],
      additionalProperties: false,
      properties: {
        credits_consumed: { type: "integer", minimum: 0, maximum: 25 },
        credits_refunded: { type: "integer", minimum: 0, maximum: 25 },
        outcomes: {
          type: "object",
          required: ["success", "not_found", "error"],
          additionalProperties: false,
          properties: {
            success: { type: "integer", minimum: 0, maximum: 25 },
            not_found: { type: "integer", minimum: 0, maximum: 25 },
            error: { type: "integer", minimum: 0, maximum: 25 }
          }
        }
      }
    }
  }
};

function requestExamples() {
  return {
    firstPage: {
      summary: "First page",
      value: { post_url: POST_URL, limit: 25 }
    },
    nextPage: {
      summary: "Next page",
      value: { post_url: POST_URL, limit: 25, cursor: "pje1.synthetic_cursor" }
    }
  };
}

function postEngagementCodeSamples(path) {
  const endpoint = `https://api.airscale.io${path}`;
  const pages = [
    ["firstPage", { post_url: CODE_SAMPLE_POST_URL, limit: 25 }],
    ["nextPage", { post_url: CODE_SAMPLE_POST_URL, limit: 25, cursor: "pje1.synthetic_cursor" }]
  ];
  const samples = [];

  for (const lang of ["bash", "node", "python"]) {
    for (const [label, body] of pages) {
      const bodyLiteral = JSON.stringify(body, null, 2);
      if (lang === "bash") {
        samples.push({
          label,
          lang,
          source: [
            "curl --request POST \\",
            `  --url '${endpoint}' \\`,
            '  --header "Authorization: Bearer $AIRSCALE_API_KEY" \\',
            '  --header "Content-Type: application/json" \\',
            `  --data '${bodyLiteral}'`
          ].join("\n")
        });
        continue;
      }

      if (lang === "node") {
        samples.push({
          label,
          lang,
          source: [
            `const response = await fetch("${endpoint}", {`,
            "  method: \"POST\",",
            "  headers: {",
            "    Authorization: `Bearer ${process.env.AIRSCALE_API_KEY}`,",
            "    \"Content-Type\": \"application/json\"",
            "  },",
            `  body: JSON.stringify(${bodyLiteral})`,
            "});",
            "",
            "const data = await response.json();",
            "console.log(data);"
          ].join("\n")
        });
        continue;
      }

      samples.push({
        label,
        lang,
        source: [
          "import os",
          "import requests",
          "",
          `response = requests.post("${endpoint}",`,
          "  headers={",
          '    "Authorization": f\'Bearer {os.environ["AIRSCALE_API_KEY"]}\',',
          '    "Content-Type": "application/json"',
          "  },",
          `  json=${bodyLiteral}`,
          ")",
          "response.raise_for_status()",
          "print(response.json())"
        ].join("\n")
      });
    }
  }

  return samples;
}

function responseExample(engagementType) {
  const isLiker = engagementType === "LIKE";
  return {
    items: [{
      profile_status: "success",
      linkedin_url: "https://www.linkedin.com/in/example-person-000000",
      first_name: "Example",
      last_name: "Person",
      full_name: "Example Person",
      company_name: "Example Company",
      job_title: "Example role",
      location: "Example City",
      domain: "example.org",
      linkedin_company_url: "https://www.linkedin.com/company/example-company",
      headline: "Example role at Example Company",
      reaction_type: isLiker ? "LIKE" : "COMMENT",
      comment: isLiker ? null : "Example comment",
      post_url: POST_URL
    }],
    pagination: { next_cursor: "pje1.synthetic_cursor", has_more: true },
    billing: {
      credits_consumed: 1,
      credits_refunded: 0,
      outcomes: { success: 1, not_found: 0, error: 0 }
    }
  };
}

function operation({ path, operationId, engagementType, summary, description }) {
  return {
    method: "POST",
    path,
    operation: {
      operationId,
      tags: [TAG],
      summary,
      description,
      "x-airscale-rate-limit": "60 requests per minute per workspace.",
      "x-airscale-credit-cost": "1 credit reserved per returned engagement for profile enrichment; only successful enrichments are consumed; not_found and error outcomes are refunded.",
      "x-codeSamples": postEngagementCodeSamples(path),
      parameters: [],
      requestBody: requestBody(
        postEngagementRequestSchema,
        requestExamples(),
        "Provide a LinkedIn post URL, an optional page size from 1 to 25, and the opaque cursor when continuing pagination. The JSON body must not exceed 128 KiB."
      ),
      responses: {
        200: {
          description: "A page of enriched LinkedIn post engagements.",
          content: {
            "application/json": {
              schema: postEngagementResponseSchema,
              examples: {
                page: {
                  summary: "Synthetic enriched engagement page",
                  value: responseExample(engagementType)
                }
              }
            }
          }
        },
        ...errorResponses([400, 401, 402, 413, 429, 500, 502, 503])
      }
    }
  };
}

export const postEngagementOperations = [
  operation({
    path: "/v1/post-likers",
    operationId: "listPostLikers",
    engagementType: "LIKE",
    summary: "List LinkedIn post likers",
    description: "Retrieves one synchronous, cursor-paginated page of people who liked a LinkedIn post and enriches each returned profile."
  }),
  operation({
    path: "/v1/post-commenters",
    operationId: "listPostCommenters",
    engagementType: "COMMENT",
    summary: "List LinkedIn post commenters",
    description: "Retrieves one synchronous, cursor-paginated page of people who commented on a LinkedIn post and enriches each returned profile."
  })
];
