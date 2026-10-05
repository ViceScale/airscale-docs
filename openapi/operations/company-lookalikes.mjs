const locations = (description) => ({ type: "array", maxItems: 100, items: { type: "string", minLength: 1, maxLength: 120 }, description });
const sizes = { type: "array", maxItems: 8, items: { type: "string", enum: ["1-10", "11-50", "51-200", "201-500", "501-1000", "1001-5000", "5001-10000", "10001+"] }, description: "Employee size bands." };
const domain = { type: "string", minLength: 1, maxLength: 2048 };
const filters = {
  country: locations("Country names or ISO alpha-2 codes. Codes are normalized before searching."),
  city: locations("City names. A location filter that cannot be resolved can return HTTP 422."),
  size: sizes
};
const errors = {
  400: "Invalid JSON, unsupported content type, unknown fields, or invalid filters or limits.",
  401: "Missing, invalid, or revoked current-app workspace API key.",
  402: "Not enough available credits to reserve limit × 0.5 credits.",
  404: "None of the reference companies could be found (reference_company_not_found).",
  409: "The operation state changed before the search could proceed.",
  413: "The JSON request body exceeds 128 KiB.",
  422: "A location filter could not be resolved.",
  429: "The workspace has reached five starts per rolling minute, already has an active search, or search capacity is temporarily unavailable. Inspect Retry-After when present.",
  499: "The caller cancelled the request.",
  502: "A search service failed or returned an invalid response. A response exceeding 32 MiB fails with a full refund; request fewer results.",
  503: "Authentication, storage, billing, or search service temporarily unavailable. Credit settlement may still be pending.",
  504: "The search deadline was exceeded (company_lookalikes_timeout)."
};
export const companyLookalikesOperation = {
  method: "POST",
  path: "/v1/company-lookalikes",
  operation: {
    operationId: "findCompanyLookalikes",
    tags: ["Search and discovery"],
    summary: "Find company lookalikes",
    description: "Finds companies similar to 1–10 reference domains and returns a synchronous JSON response. Authenticate with a current-app workspace API key. The JSON body is limited to 128 KiB. Every POST is an independent, potentially billable search; do not automatically retry after a lost response. There is no pagination, polling, or result-retrieval endpoint. Allow at least 100 seconds for the client timeout; the server has a 90-second overall budget.",
    "x-airscale-rate-limit": "5 requests per rolling minute per workspace. Maximum 1 active search per workspace.",
    "x-airscale-credit-cost": "0.5 credits per unique returned company. Reserves limit × 0.5 credits before searching and refunds the unused amount. Empty results cost zero credits.",
    "x-codeSamples": [
      {
        "label": "cURL",
        "lang": "bash",
        "source": "curl --request POST \\\n  --url https://api.airscale.io/v1/company-lookalikes \\\n  --max-time 100 \\\n  --header \"Authorization: Bearer $AIRSCALE_API_KEY\" \\\n  --header \"Content-Type: application/json\" \\\n  --data '{\"domains\":[\"example.com\"],\"limit\":10}'"
      }
    ],
    requestBody: {
      required: true,
      content: { "application/json": {
        schema: {
          type: "object", required: ["domains"], additionalProperties: false,
          properties: {
            domains: { type: "array", minItems: 1, maxItems: 10, items: domain, description: "Reference company websites, normalized to domains and deduplicated. Accepts domains or website URLs, not LinkedIn URLs or IP addresses. Reference companies are excluded from results." },
            limit: { type: "integer", minimum: 1, maximum: 5000, default: 2000, description: "Total unique results across all references, not per domain. Maximum min(5000, 2000 × distinct normalized reference domains): 2000 for one, 4000 for two, 5000 for three through ten. Searches may return fewer results." },
            include: { type: "object", additionalProperties: false, properties: filters, description: "Optional company filters to include." },
            exclude: { type: "object", additionalProperties: false, properties: { ...filters, domains: { type: "array", maxItems: 900, items: domain, description: "Company websites to omit, normalized to domains." } }, description: "Optional company filters and domains to exclude." },
            founded: { type: "object", additionalProperties: false, properties: { min: { type: "integer", minimum: 1000, maximum: 9999 }, max: { type: "integer", minimum: 1000, maximum: 9999 } }, description: "Optional founding-year bounds. min cannot exceed max." }
          }
        },
        examples: {
          simple: { summary: "Find up to ten similar companies", value: { domains: ["example.com"], limit: 10 } },
          filtered: { summary: "Filter a combined search", value: { domains: ["example.com", "example.org"], limit: 100, include: { country: ["France"], size: ["51-200"] }, exclude: { domains: ["excluded.example.com"] }, founded: { min: 2000, max: 2026 } } }
        }
      } }
    },
    responses: {
      200: {
        description: "Completed search. Companies are unique by domain. Partial reference failures can return remaining results with warnings. Empty results cost zero credits.",
        content: { "application/json": {
          schema: {
            type: "object", additionalProperties: false, required: ["status", "total_results", "credits_used", "data", "warnings"],
            properties: {
              status: { type: "string", const: "success" },
              total_results: { type: "integer", minimum: 0, maximum: 5000, description: "Number of companies in data." },
              credits_used: { type: "number", minimum: 0, maximum: 2500, description: "Actual charge: total_results × 0.5 credits." },
              data: { type: "array", maxItems: 5000, items: {
                type: "object", additionalProperties: false,
                required: ["domain", "name", "description", "employee_count", "country", "city", "founded_year", "linkedin_url", "relevance_score", "matched_domains"],
                properties: {
                  domain: { type: "string", description: "Normalized company domain." },
                  name: { type: "string", description: "Company name; falls back to the domain when missing." },
                  description: { type: "string", description: "Company description, or an empty string." },
                  employee_count: { type: "string", description: "Available employee size, commonly a range; not an exact headcount. Empty string when missing." },
                  country: { type: "string", description: "Country, or an empty string." },
                  city: { type: "string", description: "City, or an empty string." },
                  founded_year: { type: ["integer", "null"], description: "Founding year, or null when missing." },
                  linkedin_url: { type: "string", description: "LinkedIn company URL, or an empty string." },
                  relevance_score: { type: ["number", "null"], description: "Available relevance score, or null. Not a confidence percentage and not guaranteed to be between 0 and 1." },
                  matched_domains: { type: "array", minItems: 1, maxItems: 10, items: { type: "string" }, description: "Normalized reference domains that matched this company." }
                }
              } },
              warnings: { type: "array", items: { type: "string" }, description: "Partial reference failures or omitted invalid websites. Empty when no warnings occurred." }
            }
          },
          examples: {
            success: { summary: "Synthetic company match", value: { status: "success", total_results: 1, credits_used: 0.5, data: [{ domain: "match.example.com", name: "Example Company", description: "Software for sales teams.", employee_count: "51-200", country: "France", city: "Paris", founded_year: 2018, linkedin_url: "https://www.linkedin.com/company/example", relevance_score: 0.87, matched_domains: ["example.com"] }], warnings: [] } },
            empty: { summary: "No matching companies", value: { status: "success", total_results: 0, credits_used: 0, data: [], warnings: [] } }
          }
        } }
      },
      ...Object.fromEntries(Object.entries(errors).map(([status, description]) => [status, {
        description,
        ...(status === "429" ? { headers: { "Retry-After": { description: "Seconds to wait when present. A later POST starts a new search.", schema: { type: "integer", minimum: 1 } } } } : {}),
        content: { "application/json": { schema: { type: "object", required: ["error", "code"], additionalProperties: false, properties: { error: { type: "string", description: "Safe error message." }, code: { type: "string", description: "Stable error code." } } } } }
      }]))
    }
  }
};
