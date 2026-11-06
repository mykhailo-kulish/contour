// Validate Element — checks one submitted element and its outgoing
// relationships against the Contour metamodel and already-persisted state.
// Element-scope contradictions only (contour.md 3.3). Read-only: it reads
// persisted state, writes nothing. Gaps are Check Model's concern.
//
// An element's scope is its System (scopeId): names are unique within it and
// resolve within it (Requirement: Element Name Is Unique Within Its System).
import type { PoolClient } from "pg";
import {
  ElementType, SAME_SYSTEM_VERBS, SCOPE_SQL, SYSTEM_CALLER, Verb, isUuid, type StoreElementRequest,
} from "./contour.js";

const VERB_FROM_TYPE: Record<string, Set<string>> = {
  [Verb.groups]: new Set([ElementType.System]),
  [Verb.performs]: new Set([ElementType.Component]),
  [Verb.exposes]: new Set([ElementType.Interface]),
  [Verb.calls]: new Set([ElementType.Function]),
  [Verb.uses]: new Set([ElementType.Actor, ElementType.Function]),
  [Verb.produces]: new Set([ElementType.Component, ElementType.Function]),
  [Verb.consumes]: new Set([ElementType.Function]),
  [Verb.reads]: new Set([ElementType.Function]),
  [Verb.modifies]: new Set([ElementType.Function]),
  [Verb.owns]: new Set([ElementType.Component]),
  [Verb.references]: new Set([ElementType.Component]),
  [Verb.dependsOn]: new Set([ElementType.Component]),
};

const VERB_TO_TYPE: Record<string, Set<string>> = {
  [Verb.groups]: new Set([ElementType.Component]),
  [Verb.performs]: new Set([ElementType.Function]),
  [Verb.exposes]: new Set([ElementType.Function]),
  [Verb.calls]: new Set([ElementType.Function]),
  [Verb.uses]: new Set([ElementType.Function]),
  [Verb.produces]: new Set([ElementType.Event]),
  [Verb.consumes]: new Set([ElementType.Event]),
  [Verb.reads]: new Set([ElementType.DataObject]),
  [Verb.modifies]: new Set([ElementType.DataObject]),
  [Verb.owns]: new Set([ElementType.DataObject]),
  [Verb.references]: new Set([ElementType.DataObject]),
  [Verb.dependsOn]: new Set([ElementType.Component]),
};

interface ElementRow {
  id: string;
  name: string;
  element_type: string;
  system_id: string | null;
}

function asNameList(value: unknown): string[] {
  if (value == null) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.map(String);
  return [];
}

const IRREGULAR_PAST = new Set([
  "placed", "sent", "paid", "made", "done", "created", "updated", "deleted",
  "removed", "stored", "found", "shown", "built", "run", "began", "begun",
  "written", "read", "set", "put", "left", "lost", "shipped", "cancelled",
  "canceled", "completed", "reserved", "detected", "issued", "failed",
  "received", "rejected", "accepted",
]);

// An Event name is past tense when any of its words is a past-tense verb — not only the last one.
// Event names often end in a particle or preposition after the verb ("Player Logged In",
// "User Signed Up", "Order Checked Out", "Customer Opted In", "Change Rolled Back"), so testing
// only the final word produced false positives on perfectly good past-tense names. We accept the
// name if any token ends in "ed" or is a known irregular past form.
export function isPastTense(name: string): boolean {
  const trimmed = (name || "").trim();
  if (!trimmed) return false;
  const words = trimmed.split(/\s+/).map((w) => w.toLowerCase());
  return words.some((w) => w.endsWith("ed") || IRREGULAR_PAST.has(w));
}

const scopeOfRow = (e: ElementRow) => e.system_id ?? e.id;

async function getElement(c: PoolClient, id: string): Promise<ElementRow | null> {
  if (!isUuid(id)) return null;
  const r = await c.query<ElementRow>(
    "SELECT id, name, element_type, system_id FROM contour_element WHERE id = $1",
    [id],
  );
  return r.rows[0] ?? null;
}

async function definitionExists(c: PoolClient, table: string, name: string): Promise<boolean> {
  const r = await c.query(`SELECT 1 FROM ${table} WHERE name = $1 LIMIT 1`, [name]);
  return r.rowCount! > 0;
}

// The Component that performs/owns the target, if any.
async function componentOf(c: PoolClient, targetId: string, verb: string): Promise<string | null> {
  const r = await c.query<{ from_element_id: string }>(
    "SELECT from_element_id FROM contour_relationship WHERE to_element_id = $1 AND verb = $2 LIMIT 1",
    [targetId, verb],
  );
  return r.rows[0]?.from_element_id ?? null;
}

// `req.element.id` is the id the element is (or will be) stored under; `scopeId` its System.
export async function validateElement(
  c: PoolClient, req: StoreElementRequest, scopeId: string | null,
): Promise<string[]> {
  const v: string[] = [];
  const el = req.element;
  const etype = el.elementType as string;
  const body = (req.record ?? {}) as Record<string, unknown>;
  const selfId = el.id ?? null;
  const name = (el.name || "").trim();

  if (!name) v.push("Element name must not be blank.");
  if (!Object.values(ElementType).includes(etype as ElementType)) {
    v.push(`Unknown element type '${etype}'.`);
  }

  // Every element but a System belongs to one existing System.
  if (etype === ElementType.System) {
    if (el.systemId != null) v.push("A System has no systemId.");
  } else if (el.systemId == null) {
    v.push("Only a System may omit systemId; every other element belongs to one System.");
  } else {
    const sys = await getElement(c, el.systemId);
    if (!sys || sys.element_type !== ElementType.System) {
      v.push(`systemId ${el.systemId} does not name a stored System.`);
    }
  }

  // Names are unique within a System (the System's own name included); System names are unique
  // among Systems.
  if (name && scopeId && isUuid(scopeId)) {
    const clash = (await c.query<ElementRow>(
      `SELECT id, name, element_type, system_id FROM contour_element
       WHERE ${SCOPE_SQL} = $1 AND name = $2 AND id <> $3 LIMIT 1`,
      [scopeId, name, selfId ?? "00000000-0000-0000-0000-000000000000"],
    )).rows[0];
    if (clash) v.push(`Name '${name}' is already used by the ${clash.element_type} ${clash.id} in this System; names are unique within a System.`);
    if (etype === ElementType.System) {
      const other = (await c.query<{ id: string }>(
        "SELECT id FROM contour_element WHERE system_id IS NULL AND name = $1 AND id <> $2 LIMIT 1",
        [name, selfId ?? "00000000-0000-0000-0000-000000000000"],
      )).rows[0];
      if (other) v.push(`Another System (${other.id}) is already named '${name}'.`);
    }
  }

  // Event names are past tense (3.5).
  if (etype === ElementType.Event && name && !isPastTense(name)) {
    v.push(`Event name '${el.name}' should be past tense (e.g. 'Order Placed').`);
  }

  // Referenced Requirements and Guardrails must be defined.
  for (const rname of asNameList(body.requirements)) {
    if (!(await definitionExists(c, "contour_requirement", rname))) {
      v.push(`Referenced Requirement '${rname}' is not defined.`);
    }
  }
  for (const gname of asNameList(body.guardrails)) {
    if (!(await definitionExists(c, "contour_guardrail", gname))) {
      v.push(`Referenced Guardrail '${gname}' is not defined.`);
    }
  }

  // Interface serves an existing Actor of its System or the keyword System (3.3 check 1).
  if (etype === ElementType.Interface && scopeId && isUuid(scopeId)) {
    const serves = body.serves;
    if (typeof serves === "string" && serves !== SYSTEM_CALLER) {
      const r = await c.query(
        `SELECT 1 FROM contour_element WHERE ${SCOPE_SQL} = $1 AND element_type = $2 AND name = $3 LIMIT 1`,
        [scopeId, ElementType.Actor, serves],
      );
      if (r.rowCount === 0) {
        v.push(`Interface serves '${serves}', which is neither the keyword 'System' nor an existing Actor of this System.`);
      }
    }
  }

  const exposesTargets: ElementRow[] = [];

  for (const rel of req.relationships ?? []) {
    const verb = rel.verb as string;

    const allowedFrom = VERB_FROM_TYPE[verb];
    if (!allowedFrom) { v.push(`Unknown relationship verb '${verb}'.`); continue; }
    if (!allowedFrom.has(etype)) {
      v.push(`A '${verb}' edge cannot start on a ${etype} (allowed: ${[...allowedFrom].sort().join(", ")}).`);
    }

    const target = await getElement(c, rel.toElementId);
    if (!target) {
      v.push(`Relationship '${verb}' target ${rel.toElementId} does not exist.`);
      continue;
    }

    const allowedTo = VERB_TO_TYPE[verb];
    if (!allowedTo.has(target.element_type)) {
      v.push(`A '${verb}' edge cannot point at a ${target.element_type} (allowed: ${[...allowedTo].sort().join(", ")}).`);
    }

    // Allocation, exposure and same-Component access stay inside the System.
    if (SAME_SYSTEM_VERBS.has(verb) && scopeId && scopeOfRow(target) !== scopeId) {
      v.push(`A '${verb}' edge to '${target.name}' leaves this System; only uses, consumes, references and depends-on may reach another System.`);
    }

    // calls stays within one Component (3.3 check 9).
    if (verb === Verb.calls && target.element_type === ElementType.Function && selfId) {
      const callerComp = await componentOf(c, selfId, Verb.performs);
      const calleeComp = await componentOf(c, target.id, Verb.performs);
      if (callerComp && calleeComp && callerComp !== calleeComp) {
        v.push(`A 'calls' edge to '${target.name}' crosses Components; a call must stay within one Component.`);
      }
    }

    // reads/modifies stay with the owner (3.3 check 10).
    if ((verb === Verb.reads || verb === Verb.modifies) && selfId) {
      const funcComp = await componentOf(c, selfId, Verb.performs);
      const ownerComp = await componentOf(c, target.id, Verb.owns);
      if (funcComp && ownerComp && funcComp !== ownerComp) {
        v.push(`A Function may only read/modify a Data Object its own Component owns; '${target.name}' is owned by another Component.`);
      }
    }

    // single allocation (3.3 check 10).
    if (verb === Verb.performs || verb === Verb.owns) {
      const rows = await c.query<{ from_element_id: string }>(
        "SELECT from_element_id FROM contour_relationship WHERE to_element_id = $1 AND verb = $2",
        [target.id, verb],
      );
      const others = rows.rows.map((r) => r.from_element_id).filter((id) => id !== selfId);
      if (others.length) {
        const label = verb === Verb.performs ? "performer" : "owner";
        v.push(`Allocation is single: '${target.name}' already has a ${label}; a second '${verb}' edge contradicts it.`);
      }
    }

    // `produces` is single only at Component scope: one producing Component per
    // Event. A Function -> Event produces is the precise cause, not an allocation.
    if (verb === Verb.produces && etype === ElementType.Component) {
      const rows = await c.query<{ from_element_id: string }>(
        `SELECT r.from_element_id FROM contour_relationship r
         JOIN contour_element e ON e.id = r.from_element_id
         WHERE r.to_element_id = $1 AND r.verb = $2 AND e.element_type = $3`,
        [target.id, Verb.produces, ElementType.Component],
      );
      const others = rows.rows.map((r) => r.from_element_id).filter((id) => id !== selfId);
      if (others.length) {
        v.push(`Allocation is single: '${target.name}' already has a producing Component; a second 'produces' edge contradicts it.`);
      }
    }

    if (verb === Verb.exposes) exposesTargets.push(target);
  }

  // An Interface exposes only Functions one Component performs (3.3 check 1).
  if (etype === ElementType.Interface && exposesTargets.length) {
    const comps = new Set<string>();
    for (const t of exposesTargets) {
      const comp = await componentOf(c, t.id, Verb.performs);
      if (comp) comps.add(comp);
    }
    if (comps.size > 1) {
      v.push("An Interface exposes Functions performed by more than one Component; it must sit on exactly one Component.");
    }
  }

  return v;
}
