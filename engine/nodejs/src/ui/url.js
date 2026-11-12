// Shareable View URL (requirement: Shareable View URL). The Console reflects the
// current view in the address bar so a Modeler can copy and share it, and
// restores a view from such a URL on load and on Back/Forward.
//
// URL shape (path + query), e.g.
//   /                                      → nothing selected (model root)
//   /s/<systemId>                          → a System selected
//   /s/<systemId>/e/<elementId>            → an element of that System selected
//   /d/req/<defId>  |  /d/gr/<defId>       → a Requirement/Guardrail definition
//   ?g=component                           → the System's Functions grouped By Component (default: actor, omitted)
//   ?v=diagram                             → the center pane shows the Diagram (default: form, omitted)
//
// Elements are referenced by id so a link survives renames. Grouping and pane
// are only meaningful for an element view, so they are dropped otherwise.

// Build the path+query string for a view. `view` = { systemId, elementId, defKind, defId, grouping, pane }.
export function buildUrl(view) {
  if (!view) return "/";
  const q = [];
  if (view.grouping === "component") q.push("g=component");
  if (view.pane === "diagram") q.push("v=diagram");
  const qs = q.length ? "?" + q.join("&") : "";
  if (view.defKind && view.defId) {
    return `/d/${view.defKind}/${encodeURIComponent(view.defId)}${qs}`;
  }
  if (view.systemId && view.elementId && view.elementId !== view.systemId) {
    return `/s/${encodeURIComponent(view.systemId)}/e/${encodeURIComponent(view.elementId)}${qs}`;
  }
  if (view.systemId) {
    return `/s/${encodeURIComponent(view.systemId)}${qs}`;
  }
  return "/";
}

// Parse the current location into a view descriptor, or null when there is no
// recognizable view (the model root). Unknown shapes return null (the caller
// then shows the default/first view).
export function parseUrl(loc = window.location) {
  const parts = (loc.pathname || "/").split("/").filter(Boolean);
  const params = new URLSearchParams(loc.search || "");
  const grouping = params.get("g") === "component" ? "component" : "actor";
  const pane = params.get("v") === "diagram" ? "diagram" : "form";

  if (parts[0] === "d" && (parts[1] === "req" || parts[1] === "gr") && parts[2]) {
    return { defKind: parts[1], defId: decodeURIComponent(parts[2]), grouping, pane };
  }
  if (parts[0] === "s" && parts[1]) {
    const systemId = decodeURIComponent(parts[1]);
    if (parts[2] === "e" && parts[3]) {
      return { systemId, elementId: decodeURIComponent(parts[3]), grouping, pane };
    }
    return { systemId, elementId: systemId, grouping, pane };
  }
  return null;
}

// The selected element id a view descriptor points at (a real id, or a
// req:/gr: definition pseudo-id the app uses for definitions).
export function selFromView(view) {
  if (!view) return null;
  if (view.defKind && view.defId) return (view.defKind === "req" ? "req:" : "gr:") + view.defId;
  return view.elementId || view.systemId || null;
}

// Push or replace the URL for a view, without reloading. `push` adds a history
// entry (Back/Forward walks views); otherwise it replaces in place.
export function writeUrl(view, { push = false } = {}) {
  const url = buildUrl(view);
  if (url === window.location.pathname + window.location.search) return;
  if (push) window.history.pushState({ view }, "", url);
  else window.history.replaceState({ view }, "", url);
}
