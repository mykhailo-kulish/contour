// The Meanings frontend client. Calls only the BFF (/bff) — never contour-engine
// directly. The BFF holds the service identity and reaches the Contour Service
// API; the browser reaches only Meanings' own channel.
const BASE = import.meta.env.VITE_BFF_BASE || "/bff";

export class CatalogUnavailable extends Error {}
export class Rejected extends Error {
  constructor(violations) {
    super("Rejected");
    this.violations = violations;
  }
}
export class NotFound extends Error {}

async function call(method, path, body) {
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new CatalogUnavailable();
  }
  if (res.status === 503) throw new CatalogUnavailable();
  if (res.status === 404) throw new NotFound();
  if (res.status === 422) {
    const data = await res.json().catch(() => ({}));
    throw new Rejected(data.violations || ["Rejected"]);
  }
  if (!res.ok) throw new CatalogUnavailable();
  const ct = res.headers.get("content-type") || "";
  return ct.includes("json") ? res.json() : res.text();
}

export const api = {
  // Explore Models — list elements (Systems in the picker, or a System's scope).
  explore: (params) => {
    const q = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== "") q.append(k, v);
    });
    return call("GET", `/explore?${q.toString()}`);
  },
  // Open Model — the System plus a light index of every element in its scope
  // (id/name/type + the uses/requirements/guardrails reference lists the tree
  // nests by; no full records). The editor loads a full record per element.
  model: (systemId) => call("GET", `/model/${encodeURIComponent(systemId)}`),
  // Read Element — one element's full record + relationships (populates a form).
  element: (id) => call("GET", `/elements/${encodeURIComponent(id)}`),
  // Read Element — batch: the full records of a set of elements in one call, to
  // hydrate an opened element's cross-reference set for the inspector.
  elements: (ids) => call("POST", `/elements/batch`, { ids }),
  // Read Element (Diagram View) — the neutral node/edge graph for one element,
  // rendered client-side with Mermaid. Unwraps the BFF's { graph } envelope.
  graph: (id) => call("GET", `/graph/${encodeURIComponent(id)}`).then((r) => (r && r.graph) || null),
  // Search Requirements / Guardrails — the definitions available to attach.
  requirements: (query) => call("GET", `/requirements?query=${encodeURIComponent(query || "")}`),
  guardrails: (query) => call("GET", `/guardrails?query=${encodeURIComponent(query || "")}`),
  // Resolve Requirements / Guardrails — batch-resolve definitions by exact name
  // in one request each (Definitions Resolve In One Query), for building the tree.
  resolveRequirements: (names) => call("POST", `/requirements/resolve`, { names }),
  resolveGuardrails: (names) => call("POST", `/guardrails/resolve`, { names }),
  // Save Element — Store Element (create when no id, update with id).
  place: (payload) => call("POST", `/elements`, payload),
  save: (id, payload) => call("POST", `/elements/${encodeURIComponent(id)}`, payload),
  // Check Model in View — Check Model (the authority on contradictions & gaps).
  check: (systemId) => call("GET", `/check/${encodeURIComponent(systemId)}`),
  // Define Requirement / Guardrail — Store Requirement / Store Guardrail.
  defineRequirement: (id, payload) => call("PUT", `/requirements/${encodeURIComponent(id)}`, payload),
  defineGuardrail: (id, payload) => call("PUT", `/guardrails/${encodeURIComponent(id)}`, payload),
};

export const TYPE_LABEL = {
  System: "System",
  Component: "Component",
  Interface: "Interface",
  Function: "Function",
  Event: "Event",
  DataObject: "Data Object",
  Actor: "Actor",
  Requirement: "Requirement",
  Guardrail: "Guardrail",
};
export const typeLabel = (t) => TYPE_LABEL[t] || t;

// A Function's step verbs (contour.md §3.3). Each step is one verb pointing at
// one target element: calls→Function, uses→Function in another System,
// reads/modifies→Data Object, produces/consumes→Event.
export const STEP_VERBS = ["consumes", "calls", "uses", "reads", "modifies", "produces"];
// The verbs an alternative's effects may use (a subset — no consumes).
export const EFFECT_VERBS = ["reads", "modifies", "produces", "calls"];

// Human text for each verb, used in the step/effect dropdowns. Just the verb —
// the target dropdown beside it makes the object clear, so no repetitive gloss.
export const VERB_TEXT = {
  consumes: "consumes",
  calls: "calls",
  uses: "uses",
  reads: "reads",
  modifies: "modifies",
  produces: "produces",
};
