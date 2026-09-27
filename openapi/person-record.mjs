// Nested person record returned by Leads Finder (snake_case keys) and by the
// reverse email/phone lookups (camelCase keys). Both carry the same data
// model; only key casing differs. Shapes were verified against production
// responses on 2026-09-27 (see contracts/response-samples/*.live.json).
// Fields vary per record: every field is optional and may be null, and
// records can carry fields not listed here.

const str = { type: ["string", "null"] };
const int = { type: ["integer", "null"] };
const num = { type: ["number", "null"] };
const bool = { type: ["boolean", "null"] };
const any = {};
const strings = { type: ["array", "null"], items: { type: "string" } };

function obj(properties, description) {
  return {
    type: ["object", "null"],
    additionalProperties: true,
    ...(description ? { description } : {}),
    properties
  };
}

function list(item, description) {
  return { type: ["array", "null"], ...(description ? { description } : {}), items: item };
}

const dateRange = obj({ start: str, end: { ...str, description: "Null while the role or credential is current." } });
const image = obj({ source: str });
const entity = obj({ id: str, name: str, logo: str, url: str });
const range = obj({ start: int, end: int });
const address = obj({
  continent: str,
  country: str,
  state: str,
  city: str,
  postal_code: str,
  raw_address: str,
  position: obj({ lng: num, lat: num })
});

// Authored in snake_case. Keys listed in KEEP_CASE are returned verbatim by
// both surfaces and are never re-cased.
const KEEP_CASE = new Set(["profilePictureUrl"]);

const snakeProperties = {
  id: { ...str, description: "Record identifier, when available." },
  identifier: { ...str, description: "Public profile identifier, when available." },
  url: { ...str, description: "Public profile URL, when available." },
  profile: obj({
    first_name: str,
    middle_name: str,
    last_name: str,
    full_name: str,
    headline: str,
    title: str,
    summary: str,
    birth_date: any,
    picture: image,
    background: image,
    profilePictureUrl: { ...str, description: "Profile picture URL, when available." }
  }, "Name, headline, and profile media."),
  link: obj({ linkedin: str, twitter: str, github: str, facebook: str }, "Public profile links."),
  location: obj({
    default: str,
    short: str,
    country: str,
    state: str,
    city: str,
    position: any
  }, "Person location."),
  languages: obj({
    primary_locale: obj({ country: str, language: str }),
    supported_locales: list(obj({ country: str, language: str })),
    profile_languages: list(obj({ name: str, proficiency: str }))
  }),
  industry: str,
  educations: list(obj({
    school: entity,
    degree_name: str,
    field_of_study: str,
    grade: any,
    date: dateRange
  })),
  certifications: list(obj({
    name: str,
    authority: str,
    url: str,
    license_number: str,
    display_source: str,
    company: entity,
    date: dateRange
  })),
  position_groups: list(obj({
    company: obj({ id: str, name: str, logo: str, url: str, employees: range }),
    date: dateRange,
    profile_positions: list(obj({
      company: str,
      description: str,
      title: str,
      employment_type: str,
      location: str,
      date: dateRange
    }))
  }), "Work history grouped by company, most recent first."),
  skills: strings,
  member_badges: obj({
    premium: bool,
    creator: bool,
    open_to_work: bool,
    hiring: bool,
    verified: bool,
    influencer: bool
  }),
  statistics: obj({
    network: obj({ influencer: bool, followable: any, followers_count: int, connections_count: int }),
    experience: obj({ prev_job_titles: any, tenure: obj({ company: str, start: str, title: str }) })
  }),
  company: obj({
    id: str,
    summary: obj({
      name: str,
      legal_name: str,
      description: str,
      founded_year: int,
      type: str,
      industry: str,
      staff: obj({ total: int, range }),
      logo: image
    }),
    link: obj({ website: str, domain: str, linkedin: str, crunchbase: str }),
    financial: obj({ revenue: obj({ annual: obj({ start: int, end: int, amount: str }) }) }),
    location: obj({ headquarter: address, locations: list(address) }),
    technologies: list(obj({ name: str, category: str })),
    industries: strings,
    languages: strings,
    last_updated: str
  }, "Current company."),
  department: obj({
    departments: strings,
    sub_departments: strings,
    functions: strings,
    seniority: str
  }),
  last_updated: str
};

const camel = (key) => (KEEP_CASE.has(key) ? key : key.replace(/_([a-z])/g, (_, c) => c.toUpperCase()));

function recase(schema) {
  if (Array.isArray(schema)) return schema.map(recase);
  if (!schema || typeof schema !== "object") return schema;
  const out = {};
  for (const [key, value] of Object.entries(schema)) {
    out[key] = key === "properties"
      ? Object.fromEntries(Object.entries(value).map(([name, child]) => [camel(name), recase(child)]))
      : recase(value);
  }
  return out;
}

export const snakePersonRecord = {
  type: "object",
  additionalProperties: true,
  properties: snakeProperties
};

export const camelPersonRecord = recase(snakePersonRecord);

const PERSON_URL = "https://www.linkedin.com/in/example-person-000000";
const COMPANY_URL = "https://www.linkedin.com/company/example-company-000000";
const IMAGE = "https://www.example.org/images/example-person.png";

const snakeExampleRecord = {
  profile: {
    first_name: "Example",
    middle_name: null,
    last_name: "Person",
    full_name: "Example Person",
    headline: "Founder at Example Company",
    title: "Founder",
    summary: "Synthetic profile summary for API documentation.",
    birth_date: null,
    background: { source: "https://www.example.org/images/example-background.png" },
    profilePictureUrl: IMAGE
  },
  link: { linkedin: PERSON_URL, twitter: null, github: null, facebook: null },
  location: {
    default: "Example City, Example State, United States",
    short: "Example City, United States",
    country: "United States",
    state: "Example State",
    city: "Example City",
    position: null
  },
  languages: {
    primary_locale: { country: "US", language: "en" },
    supported_locales: [{ country: "US", language: "en" }],
    profile_languages: [{ name: "English", proficiency: "NATIVE_OR_BILINGUAL" }]
  },
  industry: "Software Development",
  educations: [{
    school: { name: "Example University", url: "https://www.linkedin.com/school/example-university/" },
    degree_name: "Master of Science",
    field_of_study: "Computer Science",
    grade: null,
    date: { start: "2014", end: "2016" }
  }],
  certifications: [{
    name: "Example Certification",
    authority: "Example Institute",
    url: "https://www.example.org/certificates/example",
    license_number: "EX-000001",
    display_source: "example.org",
    company: { name: "Example Institute", url: "https://www.linkedin.com/company/example-institute/" },
    date: { start: "2022-01", end: null }
  }],
  position_groups: [{
    company: { name: "Example Company", url: COMPANY_URL, employees: { start: 11, end: 50 } },
    date: { start: "2021-03", end: null },
    profile_positions: [{
      company: "Example Company",
      description: null,
      title: "Founder",
      employment_type: "Full-time",
      location: "Example City, United States",
      date: { start: "2021-03", end: null }
    }]
  }],
  skills: ["Sales prospecting", "Data enrichment"],
  member_badges: { premium: true, creator: false, open_to_work: false, hiring: false, verified: true, influencer: false },
  company: {
    summary: {
      name: "Example Company",
      legal_name: "Example Company Inc.",
      description: "Synthetic company description for API documentation.",
      founded_year: 2021,
      type: "PRIVATELY_HELD",
      industry: "Software Development",
      staff: { total: 24, range: { start: 11, end: 50 } },
      logo: { source: "https://www.example.org/images/example-company.png" }
    },
    link: { website: "https://www.example.org", domain: "example.org", linkedin: COMPANY_URL, crunchbase: null },
    financial: { revenue: { annual: { start: 1000000, end: 5000000 } } },
    location: {
      headquarter: {
        continent: "North America",
        country: "United States",
        state: "Example State",
        city: "Example City",
        postal_code: "00000",
        raw_address: "1 Example Street, Example City, Example State 00000",
        position: { lng: -74, lat: 40 }
      },
      locations: [{
        continent: "North America",
        country: "United States",
        state: "Example State",
        city: "Example City",
        postal_code: "00000",
        raw_address: "1 Example Street, Example City, Example State 00000",
        position: { lng: -74, lat: 40 }
      }]
    },
    technologies: [{ name: "Example CRM", category: "CRM" }],
    industries: ["Software Development"],
    languages: ["English"]
  },
  department: { departments: ["founder"], sub_departments: ["founder"], functions: ["executive"], seniority: "founder" }
};

function recaseValue(value) {
  if (Array.isArray(value)) return value.map(recaseValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [camel(key), recaseValue(child)]));
}

export const leadsFinderRowExample = {
  ...snakeExampleRecord,
  company: {
    ...snakeExampleRecord.company,
    financial: { revenue: { annual: { start: 1000000, end: 5000000, amount: "1M-5M" } } },
    last_updated: "2026-01-01T00:00:00Z"
  },
  statistics: {
    network: { influencer: false, followable: null, followers_count: 1200, connections_count: 500 },
    experience: { prev_job_titles: null, tenure: { company: "Example Company", start: "2021-03", title: "Founder" } }
  },
  last_updated: "2026-01-01T00:00:00Z"
};

const { profilePictureUrl, ...reverseProfile } = snakeExampleRecord.profile;

// Reverse lookups also carry an id and logo on each school and company.
const withIdentity = (entity, id) => ({ id, ...entity, logo: "https://www.example.org/images/example-logo.png" });
const reverseRecord = {
  ...snakeExampleRecord,
  profile: { ...reverseProfile, picture: { source: IMAGE } },
  educations: snakeExampleRecord.educations.map((education) => ({ ...education, school: withIdentity(education.school, "100001") })),
  certifications: snakeExampleRecord.certifications.map((certification) => ({ ...certification, company: withIdentity(certification.company, "100003") })),
  position_groups: snakeExampleRecord.position_groups.map((group) => ({ ...group, company: withIdentity(group.company, "100002") })),
  company: { id: "100002", ...snakeExampleRecord.company }
};

export const reversePersonExample = {
  id: "00000000-0000-0000-0000-000000000000",
  identifier: "example-person-000000",
  ...recaseValue(reverseRecord),
  url: PERSON_URL
};
