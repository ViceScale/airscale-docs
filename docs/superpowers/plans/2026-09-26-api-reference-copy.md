# API reference copy implementation plan

Approved scope: the six recommendations accepted in the conversation on 2026-09-26, plus the original Airschool wordmark request.

Goal: use Airschool for documentation branding and Airscale for the API product; explain endpoint inputs, results, costs, and recovery without exposing internal extraction modes or provider orchestration.

- [x] Inspect published profile page and current documentation source at base 6573603.
- [x] Preserve the SVG symbol and change both wordmarks and site name to Airschool.
- [x] Correct product naming in API MDX and OpenAPI source modules.
- [x] Remove extraction mode from public request schemas, examples, and prose without changing runtime code.
- [x] Describe optional response fields without promising normalization that the default runtime does not provide.
- [x] Simplify provider, sanitization, and billing explanations while retaining actual response codes, credit caveats, timeouts, and retry keys.
- [x] Regenerate OpenAPI and agent-readable documentation; update presentation and contract expectations.
- [x] Run full validation, inspect browser preview in light/dark themes, review complete diff, and record evidence.

No endpoint URL, runtime implementation, price, rate limit, or supported response shape is changed. Publication is a separate step.
