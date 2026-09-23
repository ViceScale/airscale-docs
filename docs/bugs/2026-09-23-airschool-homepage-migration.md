# AirSchool homepage parity and Sales Navigator shortcut

Date: 2026-09-23
Area: documentation homepage
Status: implementation verified locally; hosted receipt follows

## Reference and reproduction

The user supplied the Framer homepage markup and approved recreating it in Mintlify. The existing Mintlify root was a text/card directory rather than the AirSchool landing page. Read-only inspection of https://docs.airscale.io/ confirmed the hero, grid background, three illustrated category cards, search shortcuts, and two support cards. The original Sales Navigator shortcut pointed to `/docs/hubspot-app` rather than `/docs/sales-navigator`.

## Implementation

Use a static custom-mode homepage, original local artwork, namespaced `airschool.css`, and native Mintlify search delegation in `custom.js`. Correct the shortcut and retain all supplied category/demo/support destinations. Preserve the Mintlify header with MCP and CLI navigation, preview noindex and canonical metadata. Use semantic h1/h2/h3 headings and accessible keyboard focus. Cards stack at mobile sizes; dark mode uses dark surfaces and readable text.

Browser inspection caught Mintlify dropping a raw `nav` tag and an SVG `circle`, and adding image zoom buttons within links. Replace the nav with a supported div with navigation role, use SVG paths, and set noZoom on decorative linked artwork. Scope the link-border override to the homepage so Mintlify's prose styling does not add blue borders to its cards.

## Regression coverage

`tests/publication-migration.test.mjs` requires the homepage stylesheet and all four assets to survive both staging and production publication byte-for-byte. The test failed on the missing stylesheet before the publication allowlist update and passed after it.

Manual browser smoke: verify the rendered shortcut navigation, all images loaded, no nested image zoom controls, heading hierarchy, hero-search click on desktop and mobile, native keyboard shortcut, Sales Navigator and API card navigation, dark-mode contrast, no horizontal overflow at 1512px and 390px. Local search opens the native dialog but results require CLI login; hosted results are checked separately. No API enrichment, booking, or email action is submitted.

## Verification

Local desktop 1512x982 and mobile emulation 390x844: all artwork loaded, three columns/one column respectively, scrollWidth equals viewport width. Dark theme selected through Mintlify's theme menu and inspected. API card opened `/api-reference/api-overview`, where homepage styles were absent. Console contained only the Mintlify development Socket.io warning, no captured errors. Final source validation passed 351/351 tests, generated checks, and Mintlify build. Generated staging and production Mintlify builds passed. The final homepage-only border-color adjustment also passed the six publication tests and browser inspection. Hosted verification follows publication.

Domain and production publication remain separate from this staging homepage change.
