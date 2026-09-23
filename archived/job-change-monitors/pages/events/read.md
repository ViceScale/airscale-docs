---
title: "Mark a job-change event as read"
description: "Acknowledge one job-change event after processing it."
canonical: "https://airscale.mintlify.app/api-reference/job-change-monitors/events/read"
openapi: "/openapi.json POST /v1/job-change-monitors/{monitor_id}/events/{event_id}/read"
---

<Note>
Job-change monitoring requires a **V2 workspace API key**. V1 (Bubble) API keys are not supported by these endpoints. Monitors and monitoring credits belong to the V2 workspace associated with the key.
</Note>

Mark one event as read after your integration has handled it. The response returns the event with its `read_at` timestamp, and the monitor's unread count decreases.

Send an empty JSON body (`{}`) with `Content-Type: application/json`. Omitting the body returns `400 Invalid JSON` from the public API.

<Info>
Treat the event ID as the durable acknowledgement key. Webhook retries use the same event ID, so processing it idempotently prevents duplicate downstream work.
</Info>

Reading an event does not delete it. You can still retrieve it through [List job-change events](/api-reference/job-change-monitors/events) or the monitor detail response.

## Next step

Review [Create a job-change monitor](/api-reference/job-change-monitors/create) for webhook setup and one-time signing-secret handling.
