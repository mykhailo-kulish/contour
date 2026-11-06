// Check Model — checks one stored System (everything scoped to it) and reports contradictions
// (wrong however the model was started) separately from gaps (not filled in
// yet), each gap carrying its next step from each direction (contour.md 3.7).
import { query } from "./db.js";
import { ElementType, SYSTEM_CALLER, Verb } from "./contour.js";
import { isPastTense } from "./validation.js";

export interface Contradiction { rule: string; finding: string; }
export interface Gap { rule: string; finding: string; topDown: string; bottomUp: string; }

interface El { id: string; name: string; element_type: string; }
interface Rel { from_element_id: string; to_element_id: string; verb: string; }

function names(value: unknown): string[] {
  if (value == null) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.map(String);
  return [];
}

class Model {
  elements: El[] = [];
  rels: Rel[] = [];
  records = new Map<string, Record<string, unknown>>();
  byId = new Map<string, El>();
  reqNames = new Set<string>();
  guardNames = new Set<string>();

  ofType(t: string): El[] { return this.elements.filter((e) => e.element_type === t); }
  out(fromId: string, verb: string): El[] {
    return this.rels.filter((r) => r.from_element_id === fromId && r.verb === verb)
      .map((r) => this.byId.get(r.to_element_id)).filter((e): e is El => !!e);
  }
  incoming(toId: string, verb: string): El[] {
    return this.rels.filter((r) => r.to_element_id === toId && r.verb === verb)
      .map((r) => this.byId.get(r.from_element_id)).filter((e): e is El => !!e);
  }
  record(id: string): Record<string, unknown> { return this.records.get(id) ?? {}; }
}

// Everything one System holds — the System and every element whose systemId is it — plus the edges
// touching them. An edge's endpoint in another System (a neighbour reached by uses or consumes) is
// resolvable through byId but is not one of this System's elements, so it is never itself checked.
async function load(systemId: string): Promise<Model> {
  const m = new Model();
  m.elements = (await query<El>(
    "SELECT id, name, element_type FROM contour_element WHERE COALESCE(system_id, id) = $1", [systemId])).rows;
  const ids = m.elements.map((e) => e.id);
  m.rels = (await query<Rel>(
    `SELECT from_element_id, to_element_id, verb FROM contour_relationship
     WHERE from_element_id = ANY($1::uuid[]) OR to_element_id = ANY($1::uuid[])`, [ids])).rows;
  const recs = (await query<{ element_id: string; body: Record<string, unknown> }>(
    "SELECT element_id, body FROM contour_record WHERE element_id = ANY($1::uuid[])", [ids])).rows;
  for (const r of recs) m.records.set(r.element_id, r.body ?? {});
  for (const e of m.elements) m.byId.set(e.id, e);
  const outside = [...new Set(m.rels.flatMap((r) => [r.from_element_id, r.to_element_id]))].filter((id) => !m.byId.has(id));
  if (outside.length) {
    for (const e of (await query<El>("SELECT id, name, element_type FROM contour_element WHERE id = ANY($1::uuid[])", [outside])).rows) {
      m.byId.set(e.id, e);
    }
  }
  for (const r of (await query<{ name: string }>("SELECT name FROM contour_requirement")).rows) m.reqNames.add(r.name);
  for (const g of (await query<{ name: string }>("SELECT name FROM contour_guardrail")).rows) m.guardNames.add(g.name);
  return m;
}

function componentOfFunction(m: Model, fnId: string): string | null {
  return m.incoming(fnId, Verb.performs)[0]?.id ?? null;
}
function componentOfData(m: Model, doId: string): string | null {
  return m.incoming(doId, Verb.owns)[0]?.id ?? null;
}
function producersOf(m: Model, eventId: string): El[] {
  return m.ofType(ElementType.Component).filter((c) =>
    m.out(c.id, Verb.produces).some((e) => e.id === eventId));
}

export async function checkModel(systemId: string): Promise<{ contradictions: Contradiction[]; gaps: Gap[] }> {
  const m = await load(systemId);
  const contradictions: Contradiction[] = [];
  const gaps: Gap[] = [];

  // ----- contradictions -----
  for (const fn of m.ofType(ElementType.Function)) {
    const performers = m.incoming(fn.id, Verb.performs);
    if (performers.length > 1) contradictions.push({ rule: "single allocation", finding: `Function '${fn.name}' has ${performers.length} performers; exactly one is allowed.` });
  }
  for (const doe of m.ofType(ElementType.DataObject)) {
    const owners = m.incoming(doe.id, Verb.owns);
    if (owners.length > 1) contradictions.push({ rule: "single allocation", finding: `Data Object '${doe.name}' has ${owners.length} owners; exactly one is allowed.` });
  }
  for (const ev of m.ofType(ElementType.Event)) {
    const prod = producersOf(m, ev.id);
    if (prod.length > 1) contradictions.push({ rule: "single allocation", finding: `Event '${ev.name}' is produced by ${prod.length} Components; one is allowed.` });
  }
  for (const fn of m.ofType(ElementType.Function)) {
    const comp = componentOfFunction(m, fn.id);
    if (!comp) continue;
    for (const verb of [Verb.reads, Verb.modifies]) {
      for (const doe of m.out(fn.id, verb)) {
        const owner = componentOfData(m, doe.id);
        if (owner && owner !== comp) contradictions.push({ rule: "reads/modifies stay with the owner", finding: `Function '${fn.name}' ${verb} '${doe.name}', owned by another Component.` });
      }
    }
    for (const callee of m.out(fn.id, Verb.calls)) {
      const calleeComp = componentOfFunction(m, callee.id);
      if (comp && calleeComp && comp !== calleeComp) contradictions.push({ rule: "calls stays within one Component", finding: `Function '${fn.name}' calls '${callee.name}' across Components; redesign as a 'uses' step through an Interface serving System.` });
    }
  }
  for (const iface of m.ofType(ElementType.Interface)) {
    const comps = new Set<string>();
    for (const fn of m.out(iface.id, Verb.exposes)) {
      const c = componentOfFunction(m, fn.id);
      if (c) comps.add(c);
    }
    if (comps.size > 1) contradictions.push({ rule: "interface sits on one Component", finding: `Interface '${iface.name}' exposes Functions performed by ${comps.size} Components; it must sit on exactly one.` });
    const serves = m.record(iface.id).serves;
    const actorNames = new Set(m.ofType(ElementType.Actor).map((a) => a.name));
    if (typeof serves === "string" && serves !== SYSTEM_CALLER && !actorNames.has(serves)) {
      contradictions.push({ rule: "interface serves existing Actor or System", finding: `Interface '${iface.name}' serves '${serves}', which is neither 'System' nor an existing Actor.` });
    }
  }
  for (const e of m.elements) {
    const body = m.record(e.id);
    for (const rname of names(body.requirements)) if (!m.reqNames.has(rname)) contradictions.push({ rule: "referenced definitions exist", finding: `${e.element_type} '${e.name}' references undefined Requirement '${rname}'.` });
    for (const gname of names(body.guardrails)) if (!m.guardNames.has(gname)) contradictions.push({ rule: "referenced definitions exist", finding: `${e.element_type} '${e.name}' references undefined Guardrail '${gname}'.` });
  }
  for (const ev of m.ofType(ElementType.Event)) {
    if (ev.name.trim() && !isPastTense(ev.name)) contradictions.push({ rule: "event names are past tense", finding: `Event '${ev.name}' is not past tense.` });
  }

  // ----- gaps -----
  const systems = m.ofType(ElementType.System);
  const components = m.ofType(ElementType.Component);
  if (systems.length && !components.length) {
    gaps.push({ rule: "no Components yet", finding: `System '${systems[0].name}' has no Components; it says what it does, not how it is split.`, topDown: "split the System into Components derived from its Requirements and Guardrails", bottomUp: "identify the deployables in source code and model each as a Component" });
  }
  // Every Component scoped to the System must be named in the System's `groups`
  // (contour.md §3: "A System groups the Components that implement it"). A Component attached
  // only by its systemId, with no groups edge from the System, is a gap — the System's own
  // record doesn't yet say it contains it. The write path reconciles groups<->edges, so this
  // surfaces models ingested or edited without the System's groups populated.
  for (const sys of systems) {
    const grouped = new Set(m.out(sys.id, Verb.groups).map((c) => c.id));
    for (const comp of components) {
      if (!grouped.has(comp.id)) {
        gaps.push({ rule: "Component not grouped by its System", finding: `Component '${comp.name}' is not grouped by System '${sys.name}'.`, topDown: `add '${comp.name}' to '${sys.name}'.groups`, bottomUp: `confirm '${comp.name}' implements '${sys.name}'; if so record it in the System's groups` });
      }
    }
  }
  for (const fn of m.ofType(ElementType.Function)) {
    if (!m.incoming(fn.id, Verb.performs).length) gaps.push({ rule: "Function not allocated", finding: `Function '${fn.name}' is performed by no Component.`, topDown: `allocate '${fn.name}' to the Component responsible for it`, bottomUp: `find the handler implementing '${fn.name}' and set its Component's performs` });
  }
  for (const doe of m.ofType(ElementType.DataObject)) {
    if (!m.incoming(doe.id, Verb.owns).length) gaps.push({ rule: "Data Object not allocated", finding: `Data Object '${doe.name}' is owned by no Component.`, topDown: `give '${doe.name}' a single owning Component`, bottomUp: `find the store for '${doe.name}' and set its Component's owns` });
  }
  for (const ev of m.ofType(ElementType.Event)) {
    if (!producersOf(m, ev.id).length) gaps.push({ rule: "Event not allocated", finding: `Event '${ev.name}' is produced by no Component.`, topDown: `attribute '${ev.name}' to the Component whose Function produces it`, bottomUp: `find where '${ev.name}' is published and set that Component's produces` });
  }
  for (const iface of m.ofType(ElementType.Interface)) {
    const exposed = m.out(iface.id, Verb.exposes);
    if (exposed.length && !exposed.some((f) => m.incoming(f.id, Verb.performs).length)) {
      gaps.push({ rule: "interface has no performed Function", finding: `Interface '${iface.name}' exposes Functions none of which is performed yet.`, topDown: "allocate the exposed Functions to the Component this Interface sits on", bottomUp: "identify the Component owning this entry point and set its performs" });
    }
  }
  // Actor uses vs Interface serving it
  const exposedToActor = new Map<string, Set<string>>();
  for (const iface of m.ofType(ElementType.Interface)) {
    const serves = m.record(iface.id).serves;
    if (typeof serves !== "string" || serves === SYSTEM_CALLER) continue;
    const set = exposedToActor.get(serves) ?? new Set<string>();
    for (const f of m.out(iface.id, Verb.exposes)) set.add(f.name);
    exposedToActor.set(serves, set);
  }
  for (const actor of m.ofType(ElementType.Actor)) {
    const uses = new Set(names(m.record(actor.id).uses));
    const served = exposedToActor.get(actor.name) ?? new Set<string>();
    if (uses.size && !served.size) {
      gaps.push({ rule: "Actor uses but no Interface serves it", finding: `Actor '${actor.name}' uses Functions, but no Interface serving it exposes any.`, topDown: `add an Interface serving '${actor.name}' exposing exactly what it uses`, bottomUp: `check whether '${actor.name}' really needs them; otherwise drop them from uses` });
    }
    for (const fn of uses) if (!served.has(fn) && served.size) gaps.push({ rule: "Actor uses a Function nothing serving it exposes", finding: `Actor '${actor.name}' uses '${fn}', but no Interface serving it exposes it.`, topDown: `expose '${fn}' on an Interface serving '${actor.name}'`, bottomUp: `check whether '${actor.name}' really needs '${fn}'; if not, drop it from uses` });
    for (const fn of served) if (!uses.has(fn)) gaps.push({ rule: "Interface exposes a Function the Actor does not claim", finding: `An Interface serving '${actor.name}' exposes '${fn}', not in its uses.`, topDown: `add '${fn}' to '${actor.name}'.uses, or stop exposing it`, bottomUp: `confirm '${actor.name}' uses '${fn}'; if so add it to uses, else it was exposed by accident` });
  }
  for (const e of m.elements) {
    if (e.element_type === ElementType.Component || e.element_type === ElementType.Interface) {
      if (!m.record(e.id).rationale) gaps.push({ rule: "structure without rationale", finding: `${e.element_type} '${e.name}' has no rationale.`, topDown: "record the Actor uses, Requirements, Guardrails or allocation it derives from", bottomUp: "recover why this structure exists; an unrecoverable rationale is itself a finding" });
    }
  }

  return { contradictions, gaps };
}
