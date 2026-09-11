const TAG = "Job change monitoring";
const MONITOR_ID = {
  name: "monitor_id",
  in: "path",
  required: true,
  schema: { type: "string", format: "uuid" },
  example: "11111111-1111-4111-8111-111111111111"
};
const PROFILE_ID = {
  name: "profile_id",
  in: "path",
  required: true,
  schema: { type: "string", format: "uuid" },
  example: "22222222-2222-4222-8222-222222222222"
};
const EVENT_ID = {
  name: "event_id",
  in: "path",
  required: true,
  schema: { type: "string", format: "uuid" },
  example: "33333333-3333-4333-8333-333333333333"
};

const monitorExample = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "CRM champions",
  frequency: "every_30_days",
  status: "active",
  next_check_at: "2026-10-11T10:00:00.000Z",
  last_successful_check_at: null,
  created_at: "2026-09-11T10:00:00.000Z",
  updated_at: "2026-09-11T10:00:00.000Z",
  webhook_url: "https://hooks.example.com/airscale/job-changes",
  webhook_configured: true,
  active_profile_count: 1,
  unread_event_count: 0
};

const profileExample = {
  id: "22222222-2222-4222-8222-222222222222",
  linkedin_url: "https://www.linkedin.com/in/example-person",
  external_id: "crm-contact-123",
  status: "pending",
  removed_at: null
};

const eventExample = {
  id: "33333333-3333-4333-8333-333333333333",
  monitor_id: monitorExample.id,
  profile_id: profileExample.id,
  linkedin_url: profileExample.linkedin_url,
  external_id: profileExample.external_id,
  previous_employer: { identity: "example-old-company", name: "Example Old Company" },
  new_employer: { identity: "example-new-company", name: "Example New Company" },
  detected_at: "2026-10-11T10:00:00.000Z",
  read_at: null
};

const monitorProfileInput = {
  type: "object",
  additionalProperties: false,
  required: ["linkedin_url"],
  properties: {
    linkedin_url: {
      type: "string",
      format: "uri",
      minLength: 1,
      maxLength: 512,
      description: "A personal LinkedIn profile URL. Airscale canonicalizes it to https://www.linkedin.com/in/{slug}."
    },
    external_id: {
      type: "string",
      minLength: 1,
      maxLength: 200,
      description: "Your CRM or application identifier. It is echoed in monitor responses and job-change events."
    }
  }
};

const createRequestSchema = {
  type: "object",
  additionalProperties: false,
  required: ["name", "profiles"],
  properties: {
    name: { type: "string", minLength: 1, maxLength: 120 },
    frequency: { type: "string", enum: ["weekly", "every_30_days", "every_90_days"], default: "weekly" },
    webhook_url: { type: ["string", "null"], format: "uri", maxLength: 2048 },
    profiles: { type: "array", minItems: 1, maxItems: 500, items: monitorProfileInput }
  }
};

const addProfilesRequestSchema = {
  type: "object",
  additionalProperties: false,
  required: ["profiles"],
  properties: {
    profiles: { type: "array", minItems: 1, maxItems: 500, items: monitorProfileInput }
  }
};

const updateRequestSchema = {
  type: "object",
  additionalProperties: false,
  minProperties: 1,
  properties: {
    name: { type: "string", minLength: 1, maxLength: 120 },
    frequency: { type: "string", enum: ["weekly", "every_30_days", "every_90_days"] },
    action: { type: "string", enum: ["pause", "resume"] }
  }
};

const monitorResponse = { $ref: "#/components/schemas/JobChangeMonitor" };
const profileResponse = { $ref: "#/components/schemas/JobChangeProfile" };
const eventResponse = { $ref: "#/components/schemas/JobChangeEvent" };

function jsonError(description) {
  return {
    description,
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/JobChangeError" }
      }
    }
  };
}

function errorResponses(statuses) {
  const descriptions = {
    400: "The request body is not valid JSON.",
    402: "The workspace does not have enough credits for monitoring admission.",
    404: "The requested monitor, profile, or event does not exist in this workspace.",
    413: "The JSON request body exceeds the 512 KiB limit.",
    422: "A field is invalid, a cursor is malformed, or the monitor has no active profiles.",
    429: "The workspace has exceeded the 120 requests per minute monitor limit.",
    500: "The monitor request could not be completed because of an unexpected server error.",
    503: "Job change monitoring is temporarily unavailable or not enabled."
  };
  return Object.fromEntries(statuses.map((status) => [
    status,
    status === 401 ? { $ref: "#/components/responses/Unauthorized" } : jsonError(descriptions[status])
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

function response(schema, description, example) {
  return {
    description,
    content: {
      "application/json": {
        schema,
        examples: { success: { summary: "Successful response", value: example } }
      }
    }
  };
}

export const jobChangeMonitorOperations = [
  {
    method: "POST",
    path: "/v1/job-change-monitors",
    operation: {
      operationId: "createJobChangeMonitor",
      tags: [TAG],
      summary: "Create a job-change monitor",
      description: "Creates a new active monitor for 1–500 personal LinkedIn profiles. If webhook_url is set, the 202 response includes a signing_secret exactly once. Each request creates a new monitor; inspect existing monitors before retrying an unknown response.",
      "x-airscale-rate-limit": "120 requests per minute per workspace.",
      "x-airscale-credit-cost": "Monitoring admission checks the workspace balance; the per-profile check price is configured for the workspace.",
      requestBody: requestBody(createRequestSchema, {
        monitor: {
          summary: "Monitor with one synthetic profile",
          value: {
            name: "CRM champions",
            frequency: "every_30_days",
            webhook_url: "https://hooks.example.com/airscale/job-changes",
            profiles: [{ linkedin_url: "https://www.linkedin.com/in/example-person", external_id: "crm-contact-123" }]
          }
        }
      }, "Choose a check frequency and provide at least one personal LinkedIn profile."),
      responses: {
        202: response({
          type: "object",
          additionalProperties: false,
          required: ["monitor", "profiles", "signing_secret", "signing_secret_warning"],
          properties: {
            monitor: monitorResponse,
            profiles: { type: "array", items: profileResponse },
            signing_secret: { type: ["string", "null"] },
            signing_secret_warning: { type: ["string", "null"] }
          }
        }, "The monitor was accepted and scheduled.", {
          monitor: monitorExample,
          profiles: [profileExample],
          signing_secret: "example-signing-secret",
          signing_secret_warning: "Store this secret now. It is not returned again."
        }),
        ...errorResponses([400, 401, 402, 413, 422, 429, 503])
      }
    }
  },
  {
    method: "GET",
    path: "/v1/job-change-monitors",
    operation: {
      operationId: "listJobChangeMonitors",
      tags: [TAG],
      summary: "List job-change monitors",
      description: "Lists every job-change monitor in the authenticated workspace, including active-profile and unread-event counts.",
      "x-airscale-rate-limit": "120 requests per minute per workspace.",
      responses: {
        200: response({
          type: "object",
          additionalProperties: false,
          required: ["monitors"],
          properties: { monitors: { type: "array", items: monitorResponse } }
        }, "The workspace monitors.", { monitors: [monitorExample] }),
        ...errorResponses([401, 429, 503])
      }
    }
  },
  {
    method: "GET",
    path: "/v1/job-change-monitors/{monitor_id}",
    operation: {
      operationId: "getJobChangeMonitor",
      tags: [TAG],
      summary: "Get a monitor with profiles and recent events",
      description: "Returns one monitor, all of its profiles, and up to the latest 200 events ordered newest first.",
      "x-airscale-rate-limit": "120 requests per minute per workspace.",
      parameters: [MONITOR_ID],
      responses: {
        200: response({
          type: "object",
          additionalProperties: false,
          required: ["monitor", "profiles", "events"],
          properties: {
            monitor: monitorResponse,
            profiles: { type: "array", items: profileResponse },
            events: { type: "array", items: eventResponse }
          }
        }, "The monitor detail.", { monitor: monitorExample, profiles: [profileExample], events: [eventExample] }),
        ...errorResponses([401, 404, 429, 503])
      }
    }
  },
  {
    method: "PATCH",
    path: "/v1/job-change-monitors/{monitor_id}",
    operation: {
      operationId: "updateJobChangeMonitor",
      tags: [TAG],
      summary: "Update, pause, or resume a monitor",
      description: "Changes a monitor name or frequency, or pauses and resumes checks. Resuming requires at least one active profile and reruns monitoring admission.",
      "x-airscale-rate-limit": "120 requests per minute per workspace.",
      parameters: [MONITOR_ID],
      requestBody: requestBody(updateRequestSchema, {
        frequency: { summary: "Change the next check frequency", value: { frequency: "every_90_days" } },
        pause: { summary: "Pause checks", value: { action: "pause" } },
        resume: { summary: "Resume checks", value: { action: "resume" } }
      }, "Send at least one of name, frequency, or action."),
      responses: {
        200: response({
          type: "object",
          additionalProperties: false,
          required: ["monitor"],
          properties: { monitor: monitorResponse }
        }, "The updated monitor.", { monitor: monitorExample }),
        ...errorResponses([400, 401, 402, 404, 413, 422, 429, 503])
      }
    }
  },
  {
    method: "DELETE",
    path: "/v1/job-change-monitors/{monitor_id}",
    operation: {
      operationId: "deleteJobChangeMonitor",
      tags: [TAG],
      summary: "Delete a job-change monitor",
      description: "Permanently deletes a monitor, its profile baselines, and its events. This action cannot be undone.",
      "x-airscale-rate-limit": "120 requests per minute per workspace.",
      parameters: [MONITOR_ID],
      responses: {
        200: response({
          type: "object",
          additionalProperties: false,
          required: ["ok"],
          properties: { ok: { type: "boolean", const: true } }
        }, "The monitor was deleted.", { ok: true }),
        ...errorResponses([401, 404, 429, 503])
      }
    }
  },
  {
    method: "POST",
    path: "/v1/job-change-monitors/{monitor_id}/profiles",
    operation: {
      operationId: "addJobChangeMonitorProfiles",
      tags: [TAG],
      summary: "Add profiles to a monitor",
      description: "Adds personal LinkedIn profiles to an existing monitor. An already-active URL is ignored; adding it after removal creates a new baseline.",
      "x-airscale-rate-limit": "120 requests per minute per workspace.",
      parameters: [MONITOR_ID],
      requestBody: requestBody(addProfilesRequestSchema, {
        profiles: {
          summary: "Add one synthetic profile",
          value: { profiles: [{ linkedin_url: "https://www.linkedin.com/in/example-person", external_id: "crm-contact-456" }] }
        }
      }, "Provide one to 500 personal LinkedIn profiles."),
      responses: {
        201: response({
          type: "object",
          additionalProperties: false,
          required: ["profiles", "added_profile_count", "active_profile_count"],
          properties: {
            profiles: { type: "array", items: profileResponse },
            added_profile_count: { type: "integer", minimum: 0 },
            active_profile_count: { type: "integer", minimum: 0, maximum: 500 }
          }
        }, "The profiles accepted for the monitor.", {
          profiles: [profileExample],
          added_profile_count: 1,
          active_profile_count: 2
        }),
        ...errorResponses([400, 401, 402, 404, 413, 422, 429, 503])
      }
    }
  },
  {
    method: "DELETE",
    path: "/v1/job-change-monitors/{monitor_id}/profiles/{profile_id}",
    operation: {
      operationId: "removeJobChangeMonitorProfile",
      tags: [TAG],
      summary: "Remove a profile from a monitor",
      description: "Soft-removes one profile while preserving its historical events. Adding the same URL later creates a new profile and baseline.",
      "x-airscale-rate-limit": "120 requests per minute per workspace.",
      parameters: [MONITOR_ID, PROFILE_ID],
      responses: {
        200: response({
          type: "object",
          additionalProperties: false,
          required: ["profile"],
          properties: { profile: profileResponse }
        }, "The removed profile.", {
          profile: { ...profileExample, status: "removed", removed_at: "2026-09-11T11:00:00.000Z" }
        }),
        ...errorResponses([401, 404, 429, 503])
      }
    }
  },
  {
    method: "GET",
    path: "/v1/job-change-monitors/{monitor_id}/events",
    operation: {
      operationId: "listJobChangeMonitorEvents",
      tags: [TAG],
      summary: "List job-change events",
      description: "Returns cursor-paginated job-change events, newest first. Use next_cursor unchanged on the next request.",
      "x-airscale-rate-limit": "120 requests per minute per workspace.",
      parameters: [
        MONITOR_ID,
        {
          name: "limit",
          in: "query",
          required: false,
          description: "Number of events to return, from 1 to 100. Defaults to 50.",
          schema: { type: "integer", minimum: 1, maximum: 100, default: 50 },
          example: 50
        },
        {
          name: "cursor",
          in: "query",
          required: false,
          description: "Opaque cursor from the preceding response.",
          schema: { type: "string", minLength: 1 },
          example: "eyJkZXRlY3RlZEF0IjoiMjAyNi0xMC0xMVQxMDowMDowMC4wMDBaIiwiaWQiOiIzMzMzMzMzMy0zMzMzLTQzMzMtODMzMy0zMzMzMzMzMzMzMzMzIn0"
        }
      ],
      responses: {
        200: response({
          type: "object",
          additionalProperties: false,
          required: ["events", "next_cursor"],
          properties: {
            events: { type: "array", items: eventResponse },
            next_cursor: { type: ["string", "null"] }
          }
        }, "The requested event page.", { events: [eventExample], next_cursor: null }),
        ...errorResponses([401, 404, 422, 429, 503])
      }
    }
  },
  {
    method: "POST",
    path: "/v1/job-change-monitors/{monitor_id}/events/{event_id}/read",
    operation: {
      operationId: "markJobChangeEventRead",
      tags: [TAG],
      summary: "Mark a job-change event as read",
      description: "Marks one event read and returns the event with its read_at timestamp.",
      "x-airscale-rate-limit": "120 requests per minute per workspace.",
      parameters: [MONITOR_ID, EVENT_ID],
      responses: {
        200: response({
          type: "object",
          additionalProperties: false,
          required: ["event"],
          properties: { event: eventResponse }
        }, "The event after it was marked read.", {
          event: { ...eventExample, read_at: "2026-10-11T10:05:00.000Z" }
        }),
        ...errorResponses([401, 404, 429, 503])
      }
    }
  }
];
