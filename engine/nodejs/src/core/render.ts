// Export Graph — project one stored element to a neutral, notation-free graph
// (contour-engine.yaml "Export Graph"; Contour §4 "Interoperability").
//
// The engine is the authority for the model, not for any picture of it. Export Graph
// states the model as a graph in Contour's own vocabulary — nodes named by their Contour
// element type, edges named by their Contour relationship verb — and assigns no shapes,
// colours or layout. A consumer (the Meanings System, an ArchiMate exporter, an LLM) turns
// the graph into views; the engine draws nothing. The export is one-way and lossy: nothing
// drawn or arranged from it is read back into the model.
//
// Four model Requirements/Guardrails shape the projection:
//   - Graph Carries Contour Semantics: every node is a Contour element type, every edge a
//     Contour verb, in Contour's vocabulary; no notation is assigned.
//   - Nodes Carry Their Own Summary: each node carries a one-line summary from its record
//     (an element's description, or an Interface's binding style).
//   - Graph Derives Only From Stored State: every node and edge comes from a stored element,
//     relationship or record field; nothing is invented.
//   - Gaps Never Block An Export: a reference that resolves to nothing is simply absent.
import { query } from "./db.js";
import { ElementType, Verb, STEP_VERBS } from "./contour.js";
import { NotFound } from "./errors.js";

interface El {
  id: string;
  name: string;
  element_type: string;
  system_id: string | null;
  body?: Record<string, unknown>;
}
interface Rel { from_element_id: string; to_element_id: string; verb: string; }

// One node of the exported graph: a stored element, named by its Contour element type, with a
// one-line summary from its record. No shape, colour or position (Graph Carries Contour Semantics).
export interface GraphNode {
  id: string;
  elementType: string;
  name: string;
  systemId: string | null;
  summary?: string;
}
// One edge of the exported graph: a stored relationship, named by its Contour verb, with a label
// (the verb by default; for a uses edge, the Interface that carries it). On a Function View, a
// Function's own step edge also carries `ordinal` — the step's 1-based position in the record's
// steps[] (a stored-state fact, not notation; §4 still holds).
// On a Function View, an edge that realises a long-form alternative's `effects` carries no
// `ordinal` (it is not a main-path step) and instead carries `hint` — the alternative's `when`
// text — so a consumer can show it as an on-hover explanation of the conditional branch.
export interface GraphEdge {
  from: string;
  to: string;
  verb: string;
  label: string;
  ordinal?: number;
  hint?: string;
}
export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// One line of summary for a node, from its record only (Nodes Carry Their Own Summary):
// an element's description, or an Interface's binding style. Trimmed to one short line.
function summaryOf(e: El): string | undefined {
  const desc = typeof e.body?.description === "string" ? (e.body!.description as string).trim() : "";
  if (desc) return desc.replace(/\r?\n/g, " ").slice(0, 160);
  const binding = e.body?.binding as { style?: string } | undefined;
  if (binding?.style) return `${binding.style} interface`;
  return undefined;
}

const toNode = (e: El): GraphNode => {
  const node: GraphNode = {
    id: e.id,
    elementType: e.element_type,
    name: e.name,
    systemId: e.system_id,
  };
  const summary = summaryOf(e);
  if (summary) node.summary = summary;
  return node;
};

// Load record bodies for a set of elements and attach them (for node summaries).
async function attachRecords(elements: El[]): Promise<void> {
  if (!elements.length) return;
  const ids = elements.map((e) => e.id);
  const recs = (await query<{ element_id: string; body: Record<string, unknown> }>(
    "SELECT element_id, body FROM contour_record WHERE element_id = ANY($1::uuid[])", [ids])).rows;
  const byId = new Map(recs.map((r) => [r.element_id, r.body ?? {}]));
  for (const e of elements) e.body = byId.get(e.id) ?? {};
}

// The Interface(s) that expose each Function, so a cross-Component `uses` edge can be labelled
// with the Interface that carries it (same derivation the record's uses steps make).
function interfacesOfFunction(rels: Rel[], byId: Map<string, El>): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const r of rels) {
    if (r.verb !== Verb.exposes) continue;
    if (byId.get(r.from_element_id)?.element_type !== ElementType.Interface) continue;
    const list = m.get(r.to_element_id);
    if (list) list.push(r.from_element_id); else m.set(r.to_element_id, [r.from_element_id]);
  }
  return m;
}

// Turn the stored relationships into graph edges. Every verb is carried (allocation included),
// so the consumer decides what to nest or hide; nothing is collapsed here. A `uses` edge is
// labelled with the Interface that exposes its target, when one is known; every other edge is
// labelled with its verb.
function toEdges(rels: Rel[], byId: Map<string, El>): GraphEdge[] {
  const ifacesOfFn = interfacesOfFunction(rels, byId);
  const edges: GraphEdge[] = [];
  for (const r of rels) {
    if (!byId.has(r.from_element_id) || !byId.has(r.to_element_id)) continue;
    let label: string = r.verb;
    if (r.verb === Verb.uses) {
      const ifaceId = (ifacesOfFn.get(r.to_element_id) ?? [])[0];
      const iface = ifaceId ? byId.get(ifaceId) : undefined;
      if (iface) label = `uses via ${iface.name}`;
    }
    edges.push({ from: r.from_element_id, to: r.to_element_id, verb: r.verb, label });
  }
  return edges;
}

// One System's graph: every element scoped to the System is a node, every relationship among
// them (and to the half-open neighbours its edges reach) is an edge. Allocation is kept as edges,
// not collapsed into nesting, and produces/consumes are kept as edges so an Event reads as a flow
// hub — the consumer decides what to nest or hide.
async function exportSystemGraph(systemId: string): Promise<Graph> {
  const own = (await query<El>(
    "SELECT id, name, element_type, system_id FROM contour_element WHERE COALESCE(system_id, id)::text = $1", [systemId])).rows;
  if (!own.some((e) => e.element_type === ElementType.System)) throw new NotFound(`No System has id ${systemId}`);
  const ownIds = own.map((e) => e.id);
  const rels = (await query<Rel>(
    `SELECT from_element_id, to_element_id, verb FROM contour_relationship
     WHERE from_element_id = ANY($1::uuid[]) OR to_element_id = ANY($1::uuid[])`, [ownIds])).rows;
  const ownSet = new Set(ownIds);
  const outsideIds = [...new Set(rels.flatMap((r) => [r.from_element_id, r.to_element_id]))].filter((id) => !ownSet.has(id));
  const outside = outsideIds.length
    ? (await query<El>("SELECT id, name, element_type, system_id FROM contour_element WHERE id = ANY($1::uuid[])", [outsideIds])).rows
    : [];
  const elements = [...own, ...outside];
  await attachRecords(elements);
  const byId = new Map(elements.map((e) => [e.id, e]));
  return { nodes: elements.map(toNode), edges: toEdges(rels, byId) };
}

// One element's graph: the element and every relationship where it is either endpoint, with the
// neighbour at the other end of each edge. Flat — the consumer lays it out. Takes the already
// fetched element row (the dispatcher has it).
async function exportElementGraph(el: El): Promise<Graph> {
  const elementId = el.id;
  const rels = (await query<Rel>(
    "SELECT from_element_id, to_element_id, verb FROM contour_relationship WHERE from_element_id = $1 OR to_element_id = $1",
    [elementId],
  )).rows;
  const neighbourIds = new Set<string>();
  for (const r of rels) { neighbourIds.add(r.from_element_id); neighbourIds.add(r.to_element_id); }
  neighbourIds.delete(elementId);

  const neighbours = neighbourIds.size
    ? (await query<El>("SELECT id, name, element_type, system_id FROM contour_element WHERE id = ANY($1::uuid[])", [[...neighbourIds]])).rows
    : [];
  const elements = [el, ...neighbours];
  await attachRecords(elements);
  const byId = new Map(elements.map((e) => [e.id, e]));
  return { nodes: elements.map(toNode), edges: toEdges(rels, byId) };
}

// The trailing element name a step target names. A `uses` step's target is written
// "Interface / Function"; every other step verb targets a bare name. The stored relationship's
// target element carries that same name, so matching on the trailing name ties a step to its edge.
function stepTargetName(target: unknown): string {
  const t = String(target ?? "");
  const slash = t.lastIndexOf("/");
  return (slash >= 0 ? t.slice(slash + 1) : t).trim();
}

// Read a Function record's ordered steps as { verb, targetName } pairs (ignoring `becomes`),
// in record order — the source of the step ordinals.
function orderedSteps(body: Record<string, unknown> | undefined): { verb: string; targetName: string }[] {
  const steps = Array.isArray(body?.steps) ? (body!.steps as unknown[]) : [];
  const out: { verb: string; targetName: string }[] = [];
  for (const s of steps) {
    if (!s || typeof s !== "object") continue;
    const entry = Object.entries(s as Record<string, unknown>).find(([k]) => k !== "becomes");
    if (!entry) continue;
    out.push({ verb: entry[0], targetName: stepTargetName(entry[1]) });
  }
  return out;
}

// Read a Function record's long-form alternative effects, keyed "verb\0targetName" -> the
// alternative's `when` text. These are the conditional branches (contour.md §3.3): an alternative
// with `effects` does something (e.g. produces an Event) when its condition holds. Their edges are
// NOT main-path steps, so they carry no ordinal; instead each carries its `when` as a hint, so the
// diagram shows the branch without a sequence number and explains it on hover. When several
// alternatives map the same verb+target, their `when` texts are joined (the single stored edge is
// shared), so no branch's explanation is lost.
function alternativeEffectHints(body: Record<string, unknown> | undefined): Map<string, string> {
  const hints = new Map<string, string>();
  const alts = body?.alternatives;
  if (!alts || typeof alts !== "object" || Array.isArray(alts)) return hints;
  for (const alt of Object.values(alts as Record<string, unknown>)) {
    if (!alt || typeof alt !== "object") continue;
    const when = typeof (alt as Record<string, unknown>).when === "string"
      ? ((alt as Record<string, unknown>).when as string).trim() : "";
    const effects = (alt as Record<string, unknown>).effects;
    if (!Array.isArray(effects)) continue;
    for (const e of effects) {
      if (!e || typeof e !== "object") continue;
      const entry = Object.entries(e as Record<string, unknown>).find(([k]) => k !== "becomes");
      if (!entry) continue;
      const key = `${entry[0]}\u0000${stepTargetName(entry[1])}`;
      if (!when) { if (!hints.has(key)) hints.set(key, ""); continue; }
      const prev = hints.get(key);
      hints.set(key, prev ? `${prev}; ${when}` : when);
    }
  }
  return hints;
}

// Function View (Export Graph given a Function): a step-ordered, depth-resolved projection.
//   - the focus Function, plus the Actors/Functions that invoke it (inbound uses/calls callers);
//   - the focus's own steps as step edges, each tagged with its 1-based position in the record's
//     steps[], matched to a stored relationship by verb AND target together (so two steps to one
//     target via different verbs keep distinct ordinals and never swap);
//   - each step that calls/uses another Function resolves that target in depth: the target is
//     included carrying only its own ordered step edges (none of its callers/performs/exposes),
//     recursing until a Function invokes no further Function (a cycle is entered at most once).
// Everything derives from stored state; no notation is assigned (ordinal is a stored fact).
//
// The depth-resolved expansion is shared with the Actor View (an Actor's used Functions are each
// expanded the same way): `seeds` are the Function ids whose steps are drawn, `callersOf` the one
// Function whose inbound callers are also drawn (none for an Actor View), and `extraNodes`/
// `extraEdges` seed any element and edge the caller wants kept verbatim (the Actor node, and its
// `uses` edges to those Functions).
async function expandFunctionGraph(
  seeds: string[],
  callersOf: string | null,
  extraNodes: El[],
  extraEdges: Rel[],
): Promise<Graph> {
  const nodes = new Map<string, El>();        // id -> element row (deduped)
  const byIdAll = new Map<string, El>();      // every element seen across batches (for labelling)
  const allRels: Rel[] = [...extraEdges];     // every relationship seen across batches (for labelling)
  // Kept raw edges, in discovery order, before labelling: { rel, ordinal?, hint? }.
  const kept = new Map<string, { r: Rel; ordinal?: number; hint?: string }>();
  const expanded = new Set<string>();         // Function ids whose steps are drawn

  // Verbatim seed nodes (e.g. the Actor) and edges (e.g. Actor --uses--> Function).
  for (const e of extraNodes) { nodes.set(e.id, e); if (!byIdAll.has(e.id)) byIdAll.set(e.id, e); }
  for (const r of extraEdges) kept.set(`${r.from_element_id}->${r.to_element_id}:${r.verb}`, { r });

  // Assign ordinals to one Function's outgoing step edges, in record order, matched by verb+name.
  function numberSteps(fnId: string, steps: { verb: string; targetName: string }[], outRels: Rel[], byId: Map<string, El>) {
    const queues = new Map<string, number[]>(); // "verb\0name" -> step ordinals in order
    steps.forEach((s, i) => {
      if (!s.verb || !s.targetName) return;
      const key = `${s.verb}\u0000${s.targetName}`;
      const q = queues.get(key) ?? [];
      q.push(i + 1);
      queues.set(key, q);
    });
    const ord = new Map<string, number>(); // "from->to:verb" -> ordinal
    for (const r of outRels) {
      if (r.from_element_id !== fnId) continue;
      const toName = byId.get(r.to_element_id)?.name;
      const q = toName ? queues.get(`${r.verb}\u0000${toName}`) : undefined;
      if (q && q.length) ord.set(`${r.from_element_id}->${r.to_element_id}:${r.verb}`, q.shift()!);
    }
    return ord;
  }

  let frontier: string[] = [...new Set(seeds)];
  while (frontier.length) {
    const batch = frontier.filter((id) => !expanded.has(id));
    batch.forEach((id) => expanded.add(id));
    if (!batch.length) break;

    // Every relationship touching any Function in this batch (both directions).
    const rels = (await query<Rel>(
      `SELECT from_element_id, to_element_id, verb FROM contour_relationship
       WHERE from_element_id = ANY($1::uuid[]) OR to_element_id = ANY($1::uuid[])`, [batch])).rows;
    allRels.push(...rels);

    // Elements referenced, so we can read names/types (for matching and for nodes).
    const refIds = [...new Set(rels.flatMap((r) => [r.from_element_id, r.to_element_id]).concat(batch))];
    const rows = refIds.length
      ? (await query<El>("SELECT id, name, element_type, system_id FROM contour_element WHERE id = ANY($1::uuid[])", [refIds])).rows
      : [];
    await attachRecords(rows);
    const byId = new Map(rows.map((e) => [e.id, e]));
    for (const e of rows) if (!byIdAll.has(e.id)) byIdAll.set(e.id, e);

    const next: string[] = [];
    for (const fnId of batch) {
      const fnRow = byId.get(fnId);
      if (!fnRow) continue;
      if (!nodes.has(fnId)) nodes.set(fnId, fnRow);

      // Step edges out of this Function, numbered by the record's step order.
      const outRels = rels.filter((r) => r.from_element_id === fnId && STEP_VERBS.has(r.verb));
      const ordByRel = numberSteps(fnId, orderedSteps(fnRow.body), outRels, byId);
      // Long-form alternative effects: the conditional branches, keyed verb+target. An edge that
      // realises one carries no step ordinal and instead its alternative's `when` as a hint.
      const altHints = alternativeEffectHints(fnRow.body);
      for (const r of outRels) {
        const to = byId.get(r.to_element_id);
        if (!to) continue;
        if (!nodes.has(to.id)) nodes.set(to.id, to);
        const key = `${r.from_element_id}->${r.to_element_id}:${r.verb}`;
        const ordinal = ordByRel.get(key);
        // A conditional branch (an alternative's effect) renders without a sequence number and
        // carries its `when` as a hint. When the same verb+target is also a main-path step, the
        // step wins the ordinal (it is on the main path); otherwise the edge is number-less.
        const altKey = `${r.verb}\u0000${to.name}`;
        const hasHint = altHints.has(altKey);
        if (hasHint && ordinal === undefined) {
          const when = altHints.get(altKey) ?? "";
          kept.set(key, { r, hint: when || undefined });
        } else {
          kept.set(key, { r, ordinal });
        }
        // Descend into Functions this one calls/uses.
        if ((r.verb === Verb.calls || r.verb === Verb.uses) && to.element_type === ElementType.Function && !expanded.has(to.id)) {
          next.push(to.id);
        }
      }

      // Callers of the requested Function only (inbound uses/calls from an Actor or Function).
      // An Actor View passes no callersOf, so nothing inbound is drawn for its seed Functions.
      if (callersOf && fnId === callersOf) {
        for (const r of rels) {
          if (r.to_element_id !== fnId) continue;
          if (r.verb !== Verb.uses && r.verb !== Verb.calls) continue;
          const from = byId.get(r.from_element_id);
          if (!from) continue;
          if (from.element_type !== ElementType.Actor && from.element_type !== ElementType.Function) continue;
          if (!nodes.has(from.id)) nodes.set(from.id, from);
          kept.set(`${r.from_element_id}->${r.to_element_id}:${r.verb}`, { r });
        }
      }
    }
    frontier = next;
  }

  // Label the kept edges in a final pass, using the Interface map derived from *all* the
  // relationships gathered across every batch — so a `uses` edge is labelled "uses via
  // <Interface>" whether its target was the focus or a Function resolved in a later batch
  // (the target's `exposes` relationship is only fetched when that target is expanded).
  const ifacesOfFn = interfacesOfFunction(allRels, byIdAll);
  const edges: GraphEdge[] = [];
  for (const { r, ordinal, hint } of kept.values()) {
    let label: string = r.verb;
    if (r.verb === Verb.uses) {
      const ifaceId = (ifacesOfFn.get(r.to_element_id) ?? [])[0];
      const iface = ifaceId ? byIdAll.get(ifaceId) : undefined;
      if (iface) label = `uses via ${iface.name}`;
    }
    const edge: GraphEdge = { from: r.from_element_id, to: r.to_element_id, verb: r.verb, label };
    if (ordinal !== undefined) edge.ordinal = ordinal;
    if (hint) edge.hint = hint;
    edges.push(edge);
  }

  return { nodes: [...nodes.values()].map(toNode), edges };
}

// Function View: expand the focus Function's steps in depth, and also draw the focus's inbound
// callers (Actors/Functions that invoke it).
function exportFunctionGraph(focus: El): Promise<Graph> {
  return expandFunctionGraph([focus.id], focus.id, [], []);
}

// Actor View: the Actor node, plus each Function it `uses` expanded in depth exactly like a
// Function View (its steps, recursively) — so the Actor's Functions are not bare nodes but show
// what they do. The Actor's own `uses` edges to those Functions are kept verbatim; no inbound
// callers are drawn (the Actor is the caller). Everything else derives from stored state.
async function exportActorGraph(focus: El): Promise<Graph> {
  const rels = (await query<Rel>(
    "SELECT from_element_id, to_element_id, verb FROM contour_relationship WHERE from_element_id = $1 AND verb = $2",
    [focus.id, Verb.uses],
  )).rows;
  // Only the Functions the Actor uses are seeds (an Actor uses Functions; §3).
  const targetIds = [...new Set(rels.map((r) => r.to_element_id))];
  const targets = targetIds.length
    ? (await query<El>("SELECT id, name, element_type, system_id FROM contour_element WHERE id = ANY($1::uuid[])", [targetIds])).rows
    : [];
  const byId = new Map(targets.map((e) => [e.id, e]));
  const seeds = targets.filter((e) => e.element_type === ElementType.Function).map((e) => e.id);
  const usedRels = rels.filter((r) => byId.get(r.to_element_id)?.element_type === ElementType.Function);
  await attachRecords([focus]);
  return expandFunctionGraph(seeds, null, [focus], usedRels);
}

// Export Graph (the Function): one id, one graph. A System id yields the whole-System graph;
// a Function id yields the step-ordered, depth-resolved Function View; an Actor id yields the
// Actor and each Function it uses expanded in depth (the same step resolution as a Function View);
// any other element id yields a graph scoped to that element and its direct relationships. A
// System id and an element id are the same namespace — the element row's type decides which
// projection is built — so there is one entry point, not several.
export async function exportGraph(id: string): Promise<Graph> {
  const el = (await query<El>(
    "SELECT id, name, element_type, system_id FROM contour_element WHERE id = $1", [id])).rows[0];
  if (!el) throw new NotFound(`No element has id ${id}`);
  if (el.element_type === ElementType.System) return exportSystemGraph(id);
  if (el.element_type === ElementType.Function) return exportFunctionGraph(el);
  if (el.element_type === ElementType.Actor) return exportActorGraph(el);
  return exportElementGraph(el);
}
