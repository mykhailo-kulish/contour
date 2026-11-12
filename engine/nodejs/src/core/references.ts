// Reconcile References — keeps an element's record and its stored outgoing edges in agreement on
// Store Element (Requirement: Ownership Relations Are Stored). Two directions:
//
//   record -> edges  every name the record lists (a System's groups, a Component's performs / owns /
//                    produces, an Interface's exposes, an Actor's uses, a Function's step and
//                    alternative-effect targets) that resolves to a stored element becomes an edge;
//   edges -> record  every outgoing edge whose verb the record keeps as a name list (groups,
//                    performs, owns, produces, exposes, an Actor's uses) is listed in the record.
//
// A Function's steps are never rewritten from edges: order lives only in the steps (contour.md 3.3),
// so a step-verb edge without a step is kept as an edge but invents no step.
//
// Names resolve within the element's System. A name that doesn't resolve is left as it is — a gap,
// never a blocked write (Gaps Never Block A Write); a name that resolves to an element of the wrong
// type still becomes an edge, so Validate Element reports the contradiction.
import type { PoolClient } from "pg";
import {
  ElementType, LIST_REFERENCE_FIELDS, SCOPE_SQL, STEP_VERBS, Verb, isUuid,
  type RelationshipInput, type StoreElementRequest,
} from "./contour.js";

type Body = Record<string, unknown>;

function asNames(value: unknown): string[] {
  if (value == null) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.map(String);
  return [];
}

// `exposes` is a list of Function names or an object keyed by Function name (contour.md 3.3).
function listedNames(body: Body, field: string): string[] {
  const v = body[field];
  if (field === "exposes" && v && typeof v === "object" && !Array.isArray(v)) return Object.keys(v);
  return asNames(v);
}

function appendName(body: Body, field: string, name: string): void {
  const v = body[field];
  if (v == null) body[field] = [name];
  else if (typeof v === "string") body[field] = [v, name];
  else if (Array.isArray(v)) v.push(name);
  else if (typeof v === "object") (v as Record<string, unknown>)[name] = {}; // exposes, object form
}

// Step-verb references of a Function: its steps, then the effects of its long-form alternatives.
export function stepReferences(body: Body): { verb: string; target: string }[] {
  const out: { verb: string; target: string }[] = [];
  const visit = (step: unknown) => {
    if (!step || typeof step !== "object" || Array.isArray(step)) return;
    for (const [k, v] of Object.entries(step as Body)) {
      if (STEP_VERBS.has(k) && v != null && String(v).trim()) out.push({ verb: k, target: String(v).trim() });
    }
  };
  if (Array.isArray(body.steps)) body.steps.forEach(visit);
  const alts = body.alternatives;
  if (alts && typeof alts === "object" && !Array.isArray(alts)) {
    for (const alt of Object.values(alts as Body)) {
      const effects = alt && typeof alt === "object" ? (alt as Body).effects : null;
      if (Array.isArray(effects)) effects.forEach(visit);
    }
  }
  return out;
}

async function inScope(c: PoolClient, scopeId: string, name: string): Promise<string | null> {
  const r = await c.query<{ id: string }>(
    `SELECT id FROM contour_element WHERE ${SCOPE_SQL} = $1 AND name = $2`, [scopeId, name]);
  return r.rows[0]?.id ?? null;
}

// Outside the element's System a name is only taken when exactly one element anywhere has it.
async function uniqueAnywhere(c: PoolClient, name: string, elementType?: string): Promise<string | null> {
  const r = elementType
    ? await c.query<{ id: string }>("SELECT id FROM contour_element WHERE name = $1 AND element_type = $2 LIMIT 2", [name, elementType])
    : await c.query<{ id: string }>("SELECT id FROM contour_element WHERE name = $1 LIMIT 2", [name]);
  return r.rows.length === 1 ? r.rows[0].id : null;
}

async function resolveName(c: PoolClient, scopeId: string, name: string, crossSystem: boolean, elementType?: string) {
  return (await inScope(c, scopeId, name)) ?? (crossSystem ? await uniqueAnywhere(c, name, elementType) : null);
}

// A `uses` step reads "Interface / Function": find the Interface (in this System, else uniquely
// anywhere — a neighbour's), then the Function of that name it exposes. Without a usable Interface,
// fall back to the Function's own name.
async function resolveUsesStep(c: PoolClient, scopeId: string, target: string): Promise<string | null> {
  const slash = target.lastIndexOf("/");
  const fnName = (slash >= 0 ? target.slice(slash + 1) : target).trim();
  if (slash >= 0) {
    const ifaceName = target.slice(0, slash).trim();
    const ifaceId = await resolveName(c, scopeId, ifaceName, true, ElementType.Interface);
    if (ifaceId) {
      const r = await c.query<{ id: string }>(
        `SELECT e.id FROM contour_relationship r JOIN contour_element e ON e.id = r.to_element_id
         WHERE r.from_element_id = $1 AND r.verb = $2 AND e.name = $3 LIMIT 1`,
        [ifaceId, Verb.exposes, fnName]);
      if (r.rows[0]) return r.rows[0].id;
    }
  }
  return resolveName(c, scopeId, fnName, true, ElementType.Function);
}

export async function reconcileReferences(
  c: PoolClient,
  req: StoreElementRequest,
  scopeId: string | null,
): Promise<{ record: Body; relationships: RelationshipInput[] }> {
  const record: Body = structuredClone(req.record ?? {});
  const edges: RelationshipInput[] = [];
  const have = new Set<string>();
  const add = (verb: string, toElementId: string) => {
    const key = `${verb}:${toElementId}`;
    if (have.has(key)) return;
    have.add(key);
    edges.push({ verb: verb as Verb, toElementId });
  };

  // Explicit edges first (deduplicated — the store has one edge per verb and target).
  for (const r of req.relationships ?? []) if (r?.verb && r?.toElementId) add(r.verb, r.toElementId);
  if (!scopeId) return { record, relationships: edges }; // no System: Validate Element rejects it

  const etype = req.element.elementType as string;
  const fields = LIST_REFERENCE_FIELDS[etype] ?? [];

  // record -> edges
  for (const { field, verb } of fields) {
    for (const name of listedNames(record, field)) {
      const id = await inScope(c, scopeId, name);
      if (id) add(verb, id);
    }
  }
  if (etype === ElementType.Function) {
    for (const { verb, target } of stepReferences(record)) {
      const id = verb === Verb.uses
        ? await resolveUsesStep(c, scopeId, target)
        : await resolveName(c, scopeId, target, verb === Verb.consumes);
      if (id) add(verb, id);
    }
  }

  // edges -> record
  if (fields.length && edges.length) {
    const ids = [...new Set(edges.map((e) => e.toElementId))].filter(isUuid);
    const names = new Map(
      (await c.query<{ id: string; name: string }>(
        "SELECT id, name FROM contour_element WHERE id = ANY($1::uuid[])", [ids])).rows.map((r) => [r.id, r.name]));
    for (const { field, verb } of fields) {
      const listed = new Set(listedNames(record, field));
      for (const e of edges) {
        if (e.verb !== verb) continue;
        const name = names.get(e.toElementId);
        if (name && !listed.has(name)) { appendName(record, field, name); listed.add(name); }
      }
    }
  }

  return { record, relationships: edges };
}

// Find Dependents To Heal (Ownership Relations Are Stored, both ways): the elements whose stored
// record *names* the just-stored target, so re-reconciling each one now resolves a reference that
// could not resolve when it was first stored (its target did not yet exist). Returns element ids to
// re-store, never the target itself.
//
// A record names the target when:
//   - a list-reference field (groups / performs / owns / produces / exposes / an Actor's uses)
//     contains the target's name, or
//   - a Function step (or alternative effect) targets the name: a bare-name step for any verb, or a
//     `uses` step written "Interface / Function" whose Interface *or* Function part is the name (so
//     storing an Interface heals the Functions whose `uses` step routes through it, and storing the
//     exposed Function heals them too).
//
// Scope mirrors resolution (resolveName / resolveUsesStep): a dependent in the target's own System
// always qualifies; a dependent in another System qualifies only when the target name is unique
// across the whole model (the only way a cross-System `uses`/`consumes` resolves). Purely a
// candidate set — Store Element's reconcile decides what actually becomes an edge, so a false
// positive costs only an idempotent re-store.
export async function findDependents(
  c: PoolClient,
  target: { id: string; name: string; systemId: string | null },
): Promise<string[]> {
  const name = (target.name ?? "").trim();
  if (!name) return [];
  const scopeId = target.systemId ?? target.id; // a System is its own scope

  // The target's name is unique across the model → a neighbour System may resolve to it.
  const dup = await c.query(
    "SELECT 1 FROM contour_element WHERE name = $1 AND id <> $2 LIMIT 2", [name, target.id]);
  const uniqueAnywhere = dup.rowCount === 0;

  // Candidate records: those in the target's scope, plus (when the name is unique) every record
  // that mentions the name anywhere. jsonb::text containment is a coarse, index-free prefilter; the
  // precise name test is done in JS below and, ultimately, by reconcile itself.
  const rows = (await c.query<{ id: string; name: string; element_type: string; body: Body }>(
    `SELECT e.id, e.name, e.element_type, r.body
     FROM contour_element e JOIN contour_record r ON r.element_id = e.id
     WHERE e.id <> $1
       AND ( COALESCE(e.system_id, e.id) = $2 OR $3 = true )
       AND r.body::text LIKE '%' || $4 || '%'`,
    [target.id, scopeId, uniqueAnywhere, name],
  )).rows;

  const out: string[] = [];
  for (const row of rows) {
    if (namesTarget(row.element_type, row.body, name)) out.push(row.id);
  }
  return out;
}

// Does this record name `target` through any reference a Store Element reconcile would turn into an
// edge? List-reference fields for the element's type, and — for a Function — its step and
// alternative-effect targets, including both sides of a `uses` "Interface / Function" step.
function namesTarget(elementType: string, body: Body, target: string): boolean {
  for (const { field } of LIST_REFERENCE_FIELDS[elementType] ?? []) {
    if (listedNames(body, field).includes(target)) return true;
  }
  if (elementType === ElementType.Function) {
    for (const { verb, target: t } of stepReferences(body)) {
      if (verb === Verb.uses) {
        const slash = t.lastIndexOf("/");
        const iface = slash >= 0 ? t.slice(0, slash).trim() : "";
        const fn = (slash >= 0 ? t.slice(slash + 1) : t).trim();
        if (iface === target || fn === target) return true;
      } else if (t === target) {
        return true;
      }
    }
  }
  return false;
}
