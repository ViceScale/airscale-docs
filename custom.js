(() => {
  const collapsibleTitles = new Set(["Post engagement", "Miscellaneous", "Job change monitoring"]);

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

  function start() {
    applyCollapsibleGroups();
    new MutationObserver(applyCollapsibleGroups).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
