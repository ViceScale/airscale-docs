// Restored public operations verified from deployed Workers on 2026-09-22.
// Provenance: contracts/deployed-public-api-evidence.json.
const json = (schema, value) => ({ content: { "application/json": { schema, examples: { example: { value } } } } });
const errors = (codes) => Object.fromEntries(codes.map((code) => [code, code === 401
  ? { $ref: "#/components/responses/Unauthorized" }
  : { description: ({400:"Invalid request.",403:"Insufficient credits or access.",404:"Unknown path or method.",413:"Request body exceeds 256 KiB.",422:"Invalid or unsupported US phone number.",429:"Workspace rate limit exceeded.",500:"Service configuration error.",502:"Upstream service failed.",503:"Authentication or credit service temporarily unavailable."})[code], content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } }]));
const stringList = { oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }] };
const textFilters = {
  seniority: "Seniority values, separated by newlines.", seniorityExclude: "Seniority values to exclude.",
  yearsCurrentRole: "Current-role tenure, for example 1 to 2 years.", yearsCurrentCompany: "Current-company tenure, for example 3 to 5 years.", yearsWorkExperience: "Total experience, for example More than 10 years.",
  skills: "Skills to include.", skillsExclude: "Skills to exclude.", language: "Languages to include.", languageExclude: "Languages to exclude.",
  certification: "Certifications to include.", certificationExclude: "Certifications to exclude.", profileKeywords: "Profile keywords to include.", profileKeywordsExclude: "Profile keywords to exclude.", profileBadge: "Profile badge values.",
  industry: "Company industries to include.", industryExclude: "Company industries to exclude.", size: "Company headcount range, for example 11-50.",
  hq: "Company headquarters locations to include.", hqExclude: "Headquarters locations to exclude.", type: "Company types, for example PRIVATELY_HELD.", typeExclude: "Company types to exclude.",
  revenue: "Company revenue range, for example 1000000-10000000.", companyKeywords: "Company keywords to include.", companyKeywordsExclude: "Company keywords to exclude.",
  founded: "Founding-year range, for example 2015-2022.", funding: "Funding rounds, for example SEED or SERIES_A.", fundingAmount: "Last funding amount range, for example 1000000-5000000.", fundingDateMonths: "Funding lookback in months, for example 12.",
  department: "Department and headcount range on separate lines, for example sales followed by 10-100.", growth: "Department, growth range, and period on separate lines, for example sales, 20-80, and 3 months."
};
const durationEndpoint = { type: "object", minProperties: 1, additionalProperties: false, properties: { year: { type: "integer", minimum: 0 }, month: { type: "integer", minimum: 0, maximum: 11 } } };
const durationRange = { type: "object", minProperties: 1, additionalProperties: false, description: "When both bounds are present, min must not exceed max in total months.", properties: { min: durationEndpoint, max: durationEndpoint } };
const filters = {
  type: "object", minProperties: 1, additionalProperties: false,
  description: "At least one non-empty filter other than searchMode is required. Use only the documented fields; some malformed legacy values are ignored by the runtime rather than rejected.",
  properties: {
    ...Object.fromEntries(["job","jobExclude","company","companyUrl","peopleLocation","peopleLocationExclude","jobFunction","jobFunctionExclude"].map((key) => [key, { ...stringList, description: key.startsWith("jobFunction") ? "Job functions; at most 300 non-empty values after splitting." : key.startsWith("company") ? "Company names, domains, or LinkedIn organization URLs. Invalid LinkedIn company URLs are rejected." : "One value or multiple values." }])),
    ...Object.fromEntries(Object.entries(textFilters).map(([key, description]) => [key, { type: "string", description }])),
    duration: { type: "object", additionalProperties: false, description: "Structured tenure bounds override the matching textual tenure field. Use non-negative integer years and months from 0 through 11.", properties: Object.fromEntries(["latestCompany","currentCompany","previousCompany","latestJob","currentJob","previousJob","total"].map((key) => [key, durationRange])) },
    searchMode: { type: "string", enum: ["SMART","WORD","STRICT"], default: "SMART", description: "Matching mode. Runtime falls back to SMART for an unrecognized value; use an explicit supported mode." }
  }
};
const leadsBody = {
  type: "object", required: ["filters"], additionalProperties: false,
  properties: { filters, page: { oneOf: [{ type: "integer", minimum: 0 },{ type: "string", pattern: "^(?:0|[1-9][0-9]*)$" }], default: 0 }, size: { oneOf: [{ type: "integer", minimum: 1, maximum: 100 }, { type: "string", pattern: "^(?:[1-9]|[1-9][0-9]|100)$" }], default: 50 } }
};
const leadsResponse = { type: "object", required: ["rows","total","page","size"], properties: { rows: { type: "array", items: { $ref: "#/components/schemas/FlexibleResult" } }, total: { type: ["number","null"], description: "May be null when a reliable total is unavailable or company/title correlation removes rows." }, page: { type: "integer" }, size: { type: "integer" } } };
function leadsOperation(operationId, summary) {
  return {
    operationId, tags: ["Search and discovery"], summary,
    description: "Search with Leads Finder filters and zero-based page pagination. The preview alias has the same contract and is charged; it is not a free count operation. This filter model is different from Find people's query model.",
    "x-airscale-rate-limit": "5 requests per second per workspace, shared by both Leads Finder routes.",
    "x-airscale-credit-cost": "0.1 credits per returned lead. The preview alias has the same cost. At least 0.1 credits are required to start.",
    requestBody: { required: true, ...json(leadsBody, { filters: { job: ["Founder"], company: "example.com", peopleLocation: ["United States"], searchMode: "SMART" }, page: 0, size: 25 }) },
    responses: { 200: { description: "A page of public lead records. No cursor is returned.", ...json(leadsResponse, { rows: [{ firstname: "Example", lastname: "Person", profileUrl: "https://www.linkedin.com/in/example-person-000000" }], total: 1, page: 0, size: 25 }) }, ...errors([400,401,403,404,413,429,500,502,503]) }
  };
}
export const restoredOperations = [
  { method: "POST", path: "/v1/leads-finder", operation: leadsOperation("searchLeadsFinder", "Search Leads Finder") },
  { method: "POST", path: "/v1/leads-finder/preview", operation: leadsOperation("previewLeadsFinder", "Search Leads Finder using the preview alias") },
  { method: "POST", path: "/v1/dnc-check", operation: {
    operationId: "checkDnc", tags: ["Miscellaneous"], summary: "Check a US phone number against DNC",
    description: "Checks a US phone number. A successful check costs one credit whether the number is listed or not. Non-US and malformed numbers are rejected before the provider request.",
    "x-airscale-rate-limit": "5 requests per second per workspace.", "x-airscale-credit-cost": "1 credit per successful check; validation and provider failures are not charged.",
    requestBody: { required: true, ...json({ type: "object", properties: { phone: { type: "string", minLength: 1, description: "Recommended phone field. A US phone number, normalized to +1 format." }, phone_number: { type: "string", description: "Alias used only if phone is null or absent." }, mobile_phone: { type: "string", description: "Alias used only if phone and phone_number are null or absent." } }, anyOf: [{required:["phone"]},{required:["phone_number"]},{required:["mobile_phone"]}] }, { phone: "+12025550147" }) },
    responses: { 200: { description: "The result of a completed DNC check.", ...json({ type: "object", required: ["status","phone","listed","result","credits_used","credits_remaining"], properties: { status: { type: "string", const: "success" }, phone: { type: "string" }, listed: { type: "boolean" }, result: { type: "string", enum: ["Listed on DNC","Not listed on DNC"] }, credits_used: { type: "number" }, credits_remaining: { type: ["number","null"] } } }, { status: "success", phone: "+12025550147", listed: false, result: "Not listed on DNC", credits_used: 1, credits_remaining: 99 }) }, ...errors([400,401,403,404,413,422,429,500,502,503]) }
  } }
];
