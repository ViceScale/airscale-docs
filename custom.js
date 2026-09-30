(() => {
  const collapsibleTitles = new Set(["Post engagement", "Miscellaneous"]);

  function makeCollapsible(header) {
    if (!(header instanceof HTMLElement) || header.dataset.airscaleCollapsible === "true") return;

    const title = header.querySelector(".sidebar-title")?.textContent?.trim();
    if (!collapsibleTitles.has(title)) return;

    const pages = header.nextElementSibling;
    const heading = header.querySelector("h3");
    if (!(pages instanceof HTMLElement) || !pages.classList.contains("sidebar-group") || !heading) return;

    const button = document.createElement("button");
    button.type = "button";
    button.className = header.className;
    button.dataset.airscaleCollapsible = "true";
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-label", `Expand ${title}`);

    if (!pages.id) pages.id = `airscale-${title.toLowerCase().replace(/\s+/g, "-")}-pages`;
    button.setAttribute("aria-controls", pages.id);
    button.append(heading);
    pages.hidden = true;
    header.replaceWith(button);

    button.addEventListener("click", () => {
      const expanded = button.getAttribute("aria-expanded") !== "true";
      button.setAttribute("aria-expanded", String(expanded));
      button.setAttribute("aria-label", `${expanded ? "Collapse" : "Expand"} ${title}`);
      pages.hidden = !expanded;
    });
  }

  function applyCollapsibleGroups() {
    document.querySelectorAll("#sidebar .sidebar-group-header").forEach(makeCollapsible);
  }

  // Mintlify collapses nested OpenAPI objects; open the ones whose child
  // attributes are the point of the page. Each is opened once per render, so a
  // reader who collapses it again keeps it collapsed.
  const expandedByDefault = { "/api-reference/find-companies": ["body-filters"] };

  function applyDefaultExpanded() {
    const path = window.location.pathname.replace(/\/+$/, "");
    const fields = Object.entries(expandedByDefault).find(([page]) => path.endsWith(page))?.[1] ?? [];
    for (const field of fields) {
      const details = document.querySelector(`details[data-testid="${field}-children"]`);
      if (!(details instanceof HTMLDetailsElement) || details.dataset.airscaleDefaultExpanded === "true") continue;
      details.dataset.airscaleDefaultExpanded = "true";
      if (!details.open) details.querySelector(":scope > summary")?.click();
    }
  }

  // Delegate to Mintlify's native search so results, keyboard shortcuts, and
  // navigation stay in sync with the rest of the documentation site.
  function openHomepageSearch(event) {
    if (!(event.target instanceof Element) || !event.target.closest("[data-airschool-search]")) return;
    const entries = ["search-bar-entry", "search-bar-entry-mobile"].map(id => document.getElementById(id));
    const entry = entries.find(button => button && button.getClientRects().length > 0) ?? entries.find(Boolean);
    if (entry) entry.click();
  }

  function start() {
    document.addEventListener("click", openHomepageSearch);
    applyCollapsibleGroups();
    applyDefaultExpanded();
    new MutationObserver(() => {
      applyCollapsibleGroups();
      applyDefaultExpanded();
    }).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
