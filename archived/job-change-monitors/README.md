# Unpublished job-change monitor API documentation

Hidden at the user’s request on 2026-09-23. These are source archives, not published pages. The nine wrappers use `.md` so Mintlify cannot discover them as MDX pages. The production generator does not copy this directory.

The backend endpoints and existing monitors are unchanged. Before restoring publication, confirm release readiness and V2-only authentication: V1/Bubble keys are unsupported. Keep the empty JSON body requirement for mark-event-read.

To restore, move `pages/**/*.md` to `api-reference/job-change-monitors/**/*.mdx`, restore the operation module, schemas, catalog/source contracts, navigation and overview card, then regenerate OpenAPI and agent discovery files and run validation. Git commit `5071ebd183adf25d61d6e77e002bacdf39eb6c2e` preserves the exact pre-hide source and tests.
