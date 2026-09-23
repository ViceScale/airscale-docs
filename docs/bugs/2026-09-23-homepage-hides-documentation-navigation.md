# Homepage replaces the Documentation tab destination

Date: 2026-09-23
Status: fixed locally; release verification follows
Area: Mintlify documentation navigation

## Reproduction

At https://airscale.mintlify.app/ on desktop, click Documentation. It points to `/` and stays on the custom-mode AirSchool homepage, where the guide sidebar is hidden. The user cannot enter the previous guide navigation from the Documentation tab. The pages still exist and can be reached through a category card or search.

## Root cause

The homepage recreation kept `index` as the first page of the Documentation tab. Mintlify derives the tab destination from the first page; `mode: custom` suppresses the visible sidebar. Earlier browser checks verified category-card navigation and search but missed clicking the top-level Documentation tab.

## Fix

Give `index` its own Home tab. Restore Documentation to the original five groups and 48 guides, starting at `docs/sales-navigator`. Point the header logo to `/`; Back to website still opens the marketing site. Preserve API, MCP, CLI, and use-case destinations and all page URLs.

## Regression coverage

`tests/documentation-pages.test.mjs` now requires separate Home ownership, a sidebar-enabled Documentation entry page, all 48 original guide pages, and the logo's home target. It failed before the config fix and passed afterward (52 focused tests). Existing navigation-order fixtures were updated without weakening content-preservation checks; publication selects the API tab by name instead of a positional index.

Manual smoke: from Home, click Documentation and verify the guide heading, all five sidebar groups and 48 guide links; open a second guide; return through Home/logo; repeat using the 390px mobile navigation menu. Keep the homepage design and check API/CLI tabs retain their destinations. No domain switch is part of this fix.

## Local verification

Desktop 1512x982: Documentation opens `/docs/sales-navigator`; sidebar is visible with Build lists, Enrichments, Export, CRM integrations, Utilities, and 48 guide links. No horizontal overflow. The new Home and Documentation destinations are separate. Full source and generated build results are retained in the release evidence.

Mobile 390x844: opened navigation, selected Find phone numbers, and reached `/docs/phone-numbers` without horizontal overflow. Clicking the header logo returned to the AirSchool homepage. Generated staging Mintlify validation passed.
