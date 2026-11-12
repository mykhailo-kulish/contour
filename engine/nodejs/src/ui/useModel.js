// useModel — loads Contour Systems through the BFF and exposes them as one
// editable, name-resolving world for the Modeler.
//
// Loading is light and bounded (so opening the Modeler is fast even with ~1000
// elements):
//   • on load we fetch every System and, per System, its *light scope* via
//     Open Model (Retrieve System Scope) — each element's id/name/type
//     plus only the reference lists the tree nests by (uses, requirements,
//     guardrails). No full records and no per-element fetches build the tree
//     (Tree Loads Without Per-Element Fetches); the tree shows no status;
//   • full records are *hydrated* only for the editor/inspector — the System in
//     view, and one element when it is selected — never to draw the tree;
//   • a cross-System `uses` target hydrates its neighbour System on demand.
// Every write goes back through the BFF to Contour; the hook invents nothing.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, CatalogUnavailable, Rejected } from "./api.js";
import {
  asList, readAlternatives, readResponse, readSchema, readShape, readSteps, statusOf,
} from "./model.js";

// An Interface's `exposes` is a list of Function names or an object keyed by
// Function name (contour.md §3.3). Normalize to a name list.
function exposedNames(v) {
  if (v == null) return [];
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string") return [v];
  if (typeof v === "object") return Object.keys(v);
  return [];
}

// Normalize an Interface's `exposes` into the editing model: an ordered list of
// { fn, operation, request, responses } rows. The stored form is either a bare
// name list (the binding's conventions cover operation/request/responses — a
// Web UI, say) or an object keyed by Function name, each value an
// { operation, request, responses } block (contour.md §3.3). `operation` stays
// text; `request` becomes a shape editor model (readShape), and each
// `responses` value becomes a { code, body } editing model (readResponse) —
// the same universal shape machinery Data Objects and Events use.
function readExposes(v) {
  const asText = (x) => (x == null ? "" : typeof x === "string" ? x : JSON.stringify(x));
  const readResponses = (r) => {
    const out = {};
    if (r && typeof r === "object" && !Array.isArray(r)) {
      Object.entries(r).forEach(([k, val]) => { out[k] = readResponse(val); });
    }
    return out;
  };
  const row = (fn, block) => {
    if (block == null || typeof block !== "object" || Array.isArray(block)) {
      return { fn, operation: "", request: null, responses: {} };
    }
    return {
      fn,
      operation: asText(block.operation),
      request: block.request == null || block.request === "" ? null : readShape(block.request),
      responses: readResponses(block.responses),
    };
  };
  if (v == null) return [];
  if (Array.isArray(v)) return v.map((n) => ({ fn: String(n), operation: "", request: null, responses: {} }));
  if (typeof v === "string") return [{ fn: v, operation: "", request: null, responses: {} }];
  if (typeof v === "object") return Object.entries(v).map(([fn, block]) => row(fn, block));
  return [];
}

// An Interface's `binding` is a free-form block whose one fixed key is `style`;
// every other key is interpreted by that style's binding (contour.md §3.3). For
// editing, keep `style` apart and the remaining keys as ordered key/value rows,
// each value kept as text (a nested object round-trips as its JSON text).
function readBinding(b) {
  if (!b || typeof b !== "object") return { style: "", keys: [] };
  const style = typeof b.style === "string" ? b.style : "";
  const keys = Object.entries(b)
    .filter(([k]) => k !== "style")
    .map(([k, v]) => ({ k, v: typeof v === "string" ? v : JSON.stringify(v) }));
  return { style, keys };
}

// Shape a loaded element into the editing model the components consume. Works
// from a full record (summary + record + relationships) or from a bare summary
// (no record yet — a not-hydrated element), in which case the derived fields
// are empty until it is hydrated.
function toEl(full) {
  const element = full.element || full;
  const body = (full.record && full.record.body) || {};
  const kind = element.elementType;
  return {
    id: element.id,
    name: element.name,
    kind,
    // A System's own scope is itself; every other element's scope is its System.
    systemId: element.systemId ?? (kind === "System" ? element.id : null),
    version: element.version,
    hydrated: !!full.record,
    body,
    relationships: full.relationships || [],
    description: typeof body.description === "string" ? body.description : "",
    steps: kind === "Function" ? readSteps(body.steps) : [],
    result: typeof body.result === "string" ? body.result : "",
    alts: kind === "Function" ? readAlternatives(body.alternatives) : [],
    behavior: typeof body.behavior === "string" ? body.behavior : "",
    uses: asList(body.uses),
    performs: kind === "Component" ? asList(body.performs) : [],
    owns: kind === "Component" ? asList(body.owns) : [],
    requirements: asList(body.requirements),
    guardrails: asList(body.guardrails),
    schema: kind === "DataObject" || kind === "Event" ? readSchema(body) : null,
    // Interface channel fields (contour.md §3.3): who it serves, its binding
    // (style + free-form keys), and the Functions it exposes with their
    // operation/request/responses.
    serves: kind === "Interface" ? (typeof body.serves === "string" ? body.serves : "") : "",
    binding: kind === "Interface" ? readBinding(body.binding) : { style: "", keys: [] },
    exposes: kind === "Interface" ? readExposes(body.exposes) : [],
  };
}

// Shape one entry from Open Model (Retrieve System Scope) into a tree
// element. The scope is a light index — summary plus only the reference lists
// the tree nests by (uses, requirements, guardrails) — so this element is NOT
// hydrated: its body, steps, schema and relationships stay empty until the
// editor loads the full record with Read Element (refetchElement). `systemId`
// is supplied by the caller (every entry belongs to the opened System; a System
// entry is its own scope).
function toScopeEl(entry, systemId) {
  const kind = entry.elementType;
  return {
    id: entry.id,
    name: entry.name,
    kind,
    systemId: kind === "System" ? entry.id : systemId,
    hydrated: false,
    body: {},
    relationships: [],
    description: "",
    steps: [],
    result: "",
    alts: [],
    behavior: "",
    uses: Array.isArray(entry.uses) ? entry.uses : [],
    performs: Array.isArray(entry.performs) ? entry.performs : [],
    owns: [],
    requirements: Array.isArray(entry.requirements) ? entry.requirements : [],
    guardrails: Array.isArray(entry.guardrails) ? entry.guardrails : [],
    // Keep the same empty-but-shaped schema a not-hydrated typed element had on
    // the old summary path, so the editor never reads `.mode` off null before
    // the full record loads.
    schema: kind === "DataObject" || kind === "Event" ? readSchema({}) : null,
    // Interface channel fields stay empty until the full record hydrates.
    serves: "",
    binding: { style: "", keys: [] },
    exposes: [],
  };
}

export function useModel() {
  const [elements, setElements] = useState(null); // id -> el (summaries, overlaid with hydrated full records)
  const [systemIds, setSystemIds] = useState([]); // System element ids, in listing order
  const [reqDefs, setReqDefs] = useState([]); // [{id,name,description}]
  const [grDefs, setGrDefs] = useState([]);
  const [error, setError] = useState(null);
  const [check, setCheck] = useState({}); // systemId -> check result

  // A ref mirroring `elements`, so hydrate callbacks can read the latest map
  // without listing `elements` in their deps — keeping their identity stable so
  // the select effects that call them don't re-fire on every hydrate (which
  // would loop: hydrate -> elements changes -> callback identity changes ->
  // effect re-runs -> hydrate …).
  const elementsRef = useRef(null);
  useEffect(() => { elementsRef.current = elements; }, [elements]);

  // Merge a batch of elements (by id) into the map.
  const mergeEls = useCallback((els) => {
    setElements((prev) => {
      const next = { ...(prev || {}) };
      els.forEach((e) => { if (e) next[e.id] = e; });
      return next;
    });
  }, []);

  // Resolve the Requirement/Guardrail definitions referenced by a set of
  // elements and merge them into the def lists. Contour resolves a set of
  // referenced definition names in one batch call each (Resolve Requirements /
  // Resolve Guardrails — Definitions Resolve In One Query), instead of one Search
  // per name, so building the tree issues a fixed, small number of requests.
  const resolveDefs = useCallback(async (els) => {
    const reqNames = new Set();
    const grNames = new Set();
    els.forEach((el) => {
      (el.requirements || []).forEach((n) => reqNames.add(n));
      (el.guardrails || []).forEach((n) => grNames.add(n));
    });
    const resolve = async (names, resolveByNames) => {
      if (!names.size) return [];
      const hits = await resolveByNames([...names]).catch(() => []);
      return (Array.isArray(hits) ? hits : []).filter((d) => d && typeof d.name === "string");
    };
    const [reqs, grs] = await Promise.all([
      resolve(reqNames, api.resolveRequirements),
      resolve(grNames, api.resolveGuardrails),
    ]);
    setReqDefs((prev) => mergeDefs(prev, reqs));
    setGrDefs((prev) => mergeDefs(prev, grs));
  }, []);

  const load = useCallback(async () => {
    setError(null);
    try {
      const sysRes = await api.explore({ elementType: "System", pageSize: 500 });
      const systems = sysRes.items || [];
      // One Open Model (Retrieve System Scope) per System: a light, bounded
      // index of each System's scope — summary + the uses/requirements/guardrails
      // reference lists the tree nests by, no full records and no per-element
      // fetches (Tree Loads Without Per-Element Fetches).
      const scoped = await Promise.all(
        systems.map((s) =>
          api.model(s.id)
            .then((c) => ({ systemId: s.id, system: c.system, items: c.elements || [] }))
            .catch(() => ({ systemId: s.id, system: null, items: [] }))),
      );
      const map = {};
      scoped.forEach((c) => {
        // The scope includes the System itself; key every entry by id. All are
        // light (not hydrated) — the editor loads a full record on selection.
        c.items.forEach((it) => { if (!map[it.id]) map[it.id] = toScopeEl(it, c.systemId); });
        if (c.system && !map[c.system.id]) map[c.system.id] = toScopeEl(c.system, c.systemId);
      });
      // Resolve the Requirement/Guardrail definitions the tree references (names
      // come straight from the light scope, so this needs no full records).
      resolveDefs(Object.values(map));
      setSystemIds(systems.map((s) => s.id));
      setElements(map);
    } catch (e) {
      setElements({});
      setError(e instanceof CatalogUnavailable ? "Catalog Unavailable — Contour couldn't be reached." : String(e.message || e));
    }
  }, [resolveDefs]);

  useEffect(() => { load(); }, [load]);

  // Hydrate one System: fetch the full record of every element scoped to it,
  // merge them in, resolve its referenced definitions, and mark it hydrated.
  // Hydrate a set of elements' full records in one batch call (Retrieve
  // Elements), replacing one request per element. Ids already hydrated are
  // skipped, so repeated calls for the same selection are no-ops (this is what
  // stops the select effects from looping).
  const hydrateElements = useCallback(async (ids) => {
    const cur = elementsRef.current || {};
    const want = [...new Set((ids || []).filter(Boolean))]
      .filter((id) => !cur[id] || !cur[id].hydrated);
    if (!want.length) return [];
    try {
      const fulls = (await api.elements(want)).map(toEl);
      mergeEls(fulls);
      resolveDefs(fulls);
      return fulls;
    } catch {
      return [];
    }
  }, [mergeEls, resolveDefs]);

  // Hydrate the bounded cross-reference set an opened element's inspector needs,
  // in one batch call (Read Element -> Retrieve Elements) — not the whole System.
  //   • Actor          -> the Functions it uses.
  //   • DataObject/Event -> the System's Functions (to compute "used by").
  //   • other          -> just the element itself.
  const hydrateCrossRefs = useCallback(async (current) => {
    if (!current || !current.systemId) return;
    const scope = Object.values(elementsRef.current || {}).filter((e) => e.systemId === current.systemId);
    let ids = [current.id];
    if (current.kind === "Actor") {
      const used = new Set(current.uses || []);
      ids = ids.concat(scope.filter((e) => e.kind === "Function" && used.has(e.name)).map((e) => e.id));
    } else if (current.kind === "DataObject" || current.kind === "Event") {
      ids = ids.concat(scope.filter((e) => e.kind === "Function").map((e) => e.id));
    }
    await hydrateElements(ids);
  }, [hydrateElements]);

  // Re-fetch one element's full record (on select / after an edit elsewhere).
  const refetchElement = useCallback(async (id) => {
    if (!id) return;
    try { const el = await api.element(id).then(toEl); mergeEls([el]); }
    catch { /* leave as-is */ }
  }, [mergeEls]);

  // Hydrate a Function's cross-System targets in one batch call — a `calls`/`uses`
  // step reaches a neighbour System's Interface/Function, so the step/outcome
  // dropdowns need those records. Reads the Function's own full record first (so
  // its steps are known regardless of load timing), resolves the step targets to
  // ids across all Systems' light scope, and fetches them at once. Called lazily
  // when a Function is opened.
  const hydrateFunctionTargets = useCallback(async (fn) => {
    if (!fn || fn.kind !== "Function") return;
    let full = fn;
    if (!fn.hydrated) {
      const got = await hydrateElements([fn.id]);
      full = got[0] || (elementsRef.current || {})[fn.id] || fn;
    }
    const targetNames = new Set();
    const collect = (steps) => (steps || []).forEach((s) => {
      if (!s || !s.target) return;
      const t = String(s.target);
      const slash = t.lastIndexOf("/");
      targetNames.add((slash >= 0 ? t.slice(slash + 1) : t).trim());
    });
    collect(full.steps);
    (full.alts || []).forEach((a) => collect(a.effects));
    if (!targetNames.size) return;
    const ids = Object.values(elementsRef.current || {})
      .filter((e) => (e.kind === "Function" || e.kind === "Interface") && targetNames.has(e.name))
      .map((e) => e.id);
    await hydrateElements(ids);
  }, [hydrateElements]);

  // Hydrate every element of one System matching one of `kinds`, in one batch
  // call. The light System scope carries no `exposes` (an Interface) nor
  // outcomes (a Function), so the Function editor's "Exposed by" panel and the
  // Interface editor's exposes/responses need the relevant records loaded.
  // Called lazily when an Interface is opened (Functions, to offer real
  // outcomes) and when a Function is opened (Interfaces, to show what exposes it).
  const hydrateKindOf = useCallback(async (systemId, kinds) => {
    if (!systemId) return;
    const set = new Set(kinds);
    const ids = Object.values(elementsRef.current || {})
      .filter((e) => e.systemId === systemId && set.has(e.kind))
      .map((e) => e.id);
    if (ids.length) await hydrateElements(ids);
  }, [hydrateElements]);

  // A world keyed by id for cross-references; carries each element's System for
  // per-System scoping and the fields the dropdowns/outcome-mapping need.
  const world = useMemo(() => {
    const w = {};
    Object.values(elements || {}).forEach((el) => {
      w[el.id] = {
        name: el.name,
        kind: el.kind,
        systemId: el.systemId,
        schema: el.schema || { mode: "fields", fields: [], nested: [] },
        result: el.kind === "Function" ? el.result : undefined,
        altNames: el.kind === "Function" ? (el.alts || []).map((a) => a.name).filter(Boolean) : undefined,
        exposes: el.kind === "Interface" ? exposedNames(el.body && el.body.exposes) : undefined,
        serves: el.kind === "Interface" ? (el.body && el.body.serves) || "" : undefined,
        bindingStyle: el.kind === "Interface" ? (el.body && el.body.binding && el.body.binding.style) || "" : undefined,
        performs: el.kind === "Component" ? asList(el.body && el.body.performs) : undefined,
        produces: el.kind === "Component" ? asList(el.body && el.body.produces) : undefined,
      };
    });
    return w;
  }, [elements]);

  const defs = useMemo(
    () => ({ reqNames: new Set(reqDefs.map((d) => d.name)), grNames: new Set(grDefs.map((d) => d.name)) }),
    [reqDefs, grDefs],
  );

  const scopeOf = useCallback(
    (systemId) => {
      const out = {};
      Object.values(elements || {}).forEach((el) => { if (el.systemId === systemId) out[el.id] = el; });
      return out;
    },
    [elements],
  );

  const status = useCallback((el) => statusOf(el, world, defs), [world, defs]);

  const componentOfFunction = useCallback(
    (fn) => {
      if (!fn || fn.kind !== "Function") return null;
      const hit = Object.entries(world).find(
        ([, w]) => w.kind === "Component" && w.systemId === fn.systemId && (w.performs || []).includes(fn.name),
      );
      return hit ? { id: hit[0], ...hit[1] } : null;
    },
    [world],
  );

  // Writes. After a write, refresh only what changed; the whole model is never
  // reloaded. A create or a System write can add a tree node, so reload the
  // light scope (Open Model) — cheap, and element records hydrate on open. An
  // update of an existing element changed only that one record: refresh it and
  // its direct relationship neighbours in one batch call (rehydrateElement).
  const rehydrateElement = useCallback(async (elementId) => {
    if (!elementId) return;
    const [saved] = await hydrateElements([elementId]);
    if (!saved) return;
    // Neighbours = the other endpoint of every relationship the saved element
    // carries (both directions), minus the element itself — fetched in one
    // batch call so the "used by" refs, tree nesting and dropdowns stay
    // consistent with the change.
    const neighbourIds = new Set();
    (saved.relationships || []).forEach((r) => {
      if (r.fromElementId && r.fromElementId !== elementId) neighbourIds.add(r.fromElementId);
      if (r.toElementId && r.toElementId !== elementId) neighbourIds.add(r.toElementId);
    });
    if (neighbourIds.size) await hydrateElements([...neighbourIds]);
  }, [hydrateElements]);

  const save = useCallback(async (payload) => {
    try {
      const existing = payload.element.id;
      const res = existing ? await api.save(existing, payload) : await api.place(payload);
      const newId = res?.element?.id || existing || null;
      // A brand-new element (no prior id) or a System create can add a node to
      // the tree, so reload the light scope. An update of an existing element
      // changed only that one record: refresh it and its direct neighbours.
      if (existing && payload.element.elementType !== "System") {
        await rehydrateElement(existing);
      } else {
        await load();
      }
      setError(null);
      return newId;
    } catch (e) {
      if (e instanceof Rejected) setError("Rejected by Contour: " + e.violations.join("; "));
      else if (e instanceof CatalogUnavailable) setError("Catalog Unavailable — nothing was saved.");
      else setError(String(e.message || e));
      throw e;
    }
  }, [rehydrateElement, load]);

  const defineReq = useCallback(async (id, name, description) => {
    try { await api.defineRequirement(id, { name, description }); setReqDefs((p) => mergeDefs(p, [{ id, name, description }])); setError(null); }
    catch (e) { setError(e instanceof Rejected ? e.violations.join("; ") : String(e.message || e)); throw e; }
  }, []);
  const defineGr = useCallback(async (id, name, description) => {
    try { await api.defineGuardrail(id, { name, description }); setGrDefs((p) => mergeDefs(p, [{ id, name, description }])); setError(null); }
    catch (e) { setError(e instanceof Rejected ? e.violations.join("; ") : String(e.message || e)); throw e; }
  }, []);

  const runCheck = useCallback(async (systemId) => {
    if (!systemId) return;
    try {
      const res = await api.check(systemId);
      setCheck((c) => ({ ...c, [systemId]: res }));
      setError(null);
    } catch (e) {
      setError(e instanceof CatalogUnavailable ? "Catalog Unavailable — the model can't be checked right now." : String(e.message || e));
    }
  }, []);

  return {
    elements, systemIds, world, defs, reqDefs, grDefs, error, setError,
    check, runCheck, status, scopeOf, componentOfFunction,
    refetchElement, hydrateCrossRefs, hydrateFunctionTargets, hydrateKindOf, reload: load, save, defineReq, defineGr,
  };
}

// Merge definition lists by name (latest wins), preserving order of first sight.
function mergeDefs(prev, incoming) {
  const byName = new Map(prev.map((d) => [d.name, d]));
  incoming.forEach((d) => { if (d && d.name) byName.set(d.name, { ...byName.get(d.name), ...d }); });
  return [...byName.values()];
}
