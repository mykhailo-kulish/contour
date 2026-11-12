// The engine Functions as a service layer. Each export is one Function from
// contour-engine.yaml. Both Interfaces (Console Web UI, MCP Server) call these
// — one core for every actor.
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { pool, query, withTransaction } from "./db.js";
import { ElementType, scopeOf, type StoreElementRequest } from "./contour.js";
import {
  ElementRejected, InvalidDefinition, NameTaken, NoSuchRevision, NotFound, StillReferenced,
} from "./errors.js";
import { reconcileReferences, findDependents } from "./references.js";
import { recordSearchText } from "./searchText.js";
import { validateElement } from "./validation.js";
import { diffBodies, type Change } from "./diff.js";

export interface ElementRow {
  id: string;
  name: string;
  version: number;
  system_id: string | null;
  element_type: string;
  created_at: Date;
  updated_at: Date;
}
export interface RelationshipRow {
  id: string;
  from_element_id: string;
  to_element_id: string;
  verb: string;
  // Both endpoints, summarized, so a reader can name and open them without another lookup.
  from_name: string;
  from_type: string;
  from_system_id: string | null;
  to_name: string;
  to_type: string;
  to_system_id: string | null;
}
export interface RecordRow {
  id: string;
  element_id: string;
  body: Record<string, unknown>;
}
export interface DefinitionRow {
  id: string;
  name: string;
  description: string;
  version: number;
  created_at: Date;
  updated_at: Date;
}

// ---------------------------------------------------------------------------
// Element Functions
// ---------------------------------------------------------------------------
export async function storeElement(req: StoreElementRequest): Promise<ElementRow> {
  return withTransaction((c) => storeElementTx(c, req, new Set<string>()));
}

// One Store Element inside an existing transaction. `visited` carries the element ids already
// (re-)stored in this transaction so the dependent-healing pass below cannot loop (a target heals
// its dependents, and a dependent must never heal back to a target already stored this round).
async function storeElementTx(
  c: PoolClient, req: StoreElementRequest, visited: Set<string>,
): Promise<ElementRow> {
    const existing = req.element.id
      ? (await c.query<ElementRow>("SELECT * FROM contour_element WHERE id = $1", [req.element.id])).rows[0] ?? null
      : null;
    // The id is fixed before anything else: a System is its own scope, so even a new System's
    // references resolve against it.
    const id = existing?.id ?? req.element.id ?? randomUUID();
    const element = { ...req.element, id, name: (req.element.name ?? "").trim() };
    const scopeId = scopeOf({ id, elementType: element.elementType, systemId: element.systemId });

    // Bring the record's references and the outgoing edges into agreement, both ways
    // (Ownership Relations Are Stored), then validate and persist that one merged element.
    const { record, relationships } = await reconcileReferences(c, { ...req, element }, scopeId);
    const merged: StoreElementRequest = { element, record, relationships };

    // Validation precedes persistence — nothing written if invalid.
    const violations = await validateElement(c, merged, scopeId);
    if (violations.length) throw new ElementRejected(violations);

    const systemId = element.elementType === ElementType.System ? null : element.systemId ?? null;
    let el: ElementRow;
    if (!existing) {
      el = (await c.query<ElementRow>(
        `INSERT INTO contour_element (id, name, version, system_id, element_type)
         VALUES ($1, $2, 1, $3, $4) RETURNING *`,
        [id, element.name, systemId, element.elementType],
      )).rows[0];
    } else {
      // Record History Is Kept: before the live row advances, copy the body it is replacing into
      // contour_element_version at its current version (History Is Append Only — insert, never
      // update). A missing current record (shouldn't happen for an existing element) is skipped.
      await c.query(
        `INSERT INTO contour_element_version (element_id, version, body, change_note, changed_by)
         SELECT e.id, e.version, r.body, $2, $3
         FROM contour_element e JOIN contour_record r ON r.element_id = e.id
         WHERE e.id = $1
         ON CONFLICT (element_id, version) DO NOTHING`,
        [id, req.changeNote ?? null, req.changedBy ?? null],
      );
      el = (await c.query<ElementRow>(
        `UPDATE contour_element
         SET name = $2, system_id = $3, element_type = $4, version = version + 1, updated_at = now()
         WHERE id = $1 RETURNING *`,
        [id, element.name, systemId, element.elementType],
      )).rows[0];
    }

    const stext = recordSearchText(el.name, record);
    const existingRec = (await c.query("SELECT id FROM contour_record WHERE element_id = $1", [el.id])).rows[0];
    if (!existingRec) {
      await c.query(
        `INSERT INTO contour_record (id, element_id, body, search_text, search_tsv)
         VALUES ($1, $2, $3::jsonb, $4, to_tsvector('english', $4))`,
        [randomUUID(), el.id, JSON.stringify(record), stext],
      );
    } else {
      await c.query(
        `UPDATE contour_record
         SET body = $2::jsonb, search_text = $3, search_tsv = to_tsvector('english', $3)
         WHERE element_id = $1`,
        [el.id, JSON.stringify(record), stext],
      );
    }

    // Replace this element's outgoing edges with the reconciled set.
    await c.query("DELETE FROM contour_relationship WHERE from_element_id = $1", [el.id]);
    for (const rel of relationships) {
      await c.query(
        `INSERT INTO contour_relationship (id, from_element_id, to_element_id, verb)
         VALUES ($1, $2, $3, $4)`,
        [randomUUID(), el.id, rel.toElementId, rel.verb],
      );
    }

    // Heal dependents (Ownership Relations Are Stored, both ways): an element stored *before* this
    // one may name it in a list field or a Function step, with no edge because this target did not
    // yet exist — and a store only ever reconciles the element being stored, never its dependents.
    // Now that this element exists, re-store each dependent unchanged so its own reconcile resolves
    // the reference into the edge it was missing. `visited` (this element included) bounds the
    // pass: each dependent is re-stored at most once per transaction, and a dependent never heals
    // back to a target already stored this round, so the cascade terminates.
    visited.add(el.id);
    const dependents = await findDependents(c, { id: el.id, name: el.name, systemId: el.system_id });
    for (const depId of dependents) {
      if (visited.has(depId)) continue;
      const dep = await retrieveElementTx(c, depId);
      if (!dep) continue;
      await storeElementTx(c, {
        element: {
          id: dep.element.id, name: dep.element.name,
          elementType: dep.element.element_type as never, systemId: dep.element.system_id,
        },
        record: dep.record?.body ?? {},
        relationships: dep.relationships
          .filter((r) => r.from_element_id === dep.element.id)
          .map((r) => ({ verb: r.verb as never, toElementId: r.to_element_id })),
        changeNote: "Reference healed: target element became available",
        changedBy: req.changedBy ?? null,
      }, visited);
    }
    return el;
}

// Read one element (row, record body, outgoing relationships) on an existing transaction client —
// the dependent-healing pass's inputs, read inside the same transaction as the write.
async function retrieveElementTx(c: PoolClient, id: string): Promise<{
  element: ElementRow;
  record: { body: Record<string, unknown> } | null;
  relationships: { from_element_id: string; to_element_id: string; verb: string }[];
} | null> {
  const element = (await c.query<ElementRow>("SELECT * FROM contour_element WHERE id = $1", [id])).rows[0];
  if (!element) return null;
  const record = (await c.query<{ body: Record<string, unknown> }>(
    "SELECT body FROM contour_record WHERE element_id = $1", [id])).rows[0] ?? null;
  const relationships = (await c.query<{ from_element_id: string; to_element_id: string; verb: string }>(
    "SELECT from_element_id, to_element_id, verb FROM contour_relationship WHERE from_element_id = $1", [id])).rows;
  return { element, record, relationships };
}

const RELATIONSHIP_SELECT = `
  SELECT r.id, r.from_element_id, r.to_element_id, r.verb,
         f.name AS from_name, f.element_type AS from_type, f.system_id AS from_system_id,
         t.name AS to_name,   t.element_type AS to_type,   t.system_id AS to_system_id
  FROM contour_relationship r
  JOIN contour_element f ON f.id = r.from_element_id
  JOIN contour_element t ON t.id = r.to_element_id`;

export async function retrieveElement(elementId: string): Promise<{
  element: ElementRow;
  record: RecordRow | null;
  relationships: RelationshipRow[];
}> {
  const el = (await query<ElementRow>("SELECT * FROM contour_element WHERE id::text = $1", [elementId])).rows[0];
  if (!el) throw new NotFound(`No element has id ${elementId}`);
  const record = (await query<RecordRow>("SELECT * FROM contour_record WHERE element_id = $1", [el.id])).rows[0] ?? null;
  const relationships = (await query<RelationshipRow>(
    `${RELATIONSHIP_SELECT} WHERE r.from_element_id = $1 OR r.to_element_id = $1 ORDER BY r.verb, t.name, f.name`,
    [el.id],
  )).rows;
  return { element: el, record, relationships };
}

// Retrieve Elements: the batch form of Retrieve Element — the full records
// (element, record body, immediate relationships) of a set of ids in a bounded
// number of queries (elements, records, relationships each read with
// id = ANY(ids)), never one round-trip per element (Requirement: Elements Load
// In Bounded Queries). An id with no element is simply absent from the result;
// an empty id set returns nothing without querying. Read-only.
export async function retrieveElements(ids: string[]): Promise<{
  element: ElementRow;
  record: RecordRow | null;
  relationships: RelationshipRow[];
}[]> {
  const unique = [...new Set((ids || []).filter((x) => typeof x === "string" && x.length))];
  if (!unique.length) return [];
  const elements = (await query<ElementRow>("SELECT * FROM contour_element WHERE id = ANY($1)", [unique])).rows;
  if (!elements.length) return [];
  const foundIds = elements.map((e) => e.id);
  const records = (await query<RecordRow>("SELECT * FROM contour_record WHERE element_id = ANY($1)", [foundIds])).rows;
  const recordByEl = new Map(records.map((r) => [r.element_id, r]));
  const rels = (await query<RelationshipRow>(
    `${RELATIONSHIP_SELECT} WHERE r.from_element_id = ANY($1) OR r.to_element_id = ANY($1) ORDER BY r.verb, t.name, f.name`,
    [foundIds],
  )).rows;
  const idSet = new Set(foundIds);
  const relsByEl = new Map<string, RelationshipRow[]>();
  const push = (key: string, r: RelationshipRow) => {
    const list = relsByEl.get(key);
    if (list) list.push(r); else relsByEl.set(key, [r]);
  };
  for (const r of rels) {
    if (idSet.has(r.from_element_id)) push(r.from_element_id, r);
    if (r.to_element_id !== r.from_element_id && idSet.has(r.to_element_id)) push(r.to_element_id, r);
  }
  return elements.map((el) => ({
    element: el,
    record: recordByEl.get(el.id) ?? null,
    relationships: relsByEl.get(el.id) ?? [],
  }));
}

// Retrieve System Scope: a light, batch index of one System's scope — the System itself included
// (scopeOf a System is the System) — for a caller building the System's navigation tree. Returns,
// per element, only the summary (id, name, elementType) and the record's name-reference lists the
// tree nests by (uses, performs, requirements, guardrails) — no full body, no relationships. Bounded: two
// queries (elements, then their records) however many elements the System holds, never one per
// element (Requirement: Scope Retrieval Is Bounded). Read-only.
export interface ScopeEntry {
  id: string;
  name: string;
  elementType: string;
  uses: string[];
  performs: string[];
  requirements: string[];
  guardrails: string[];
}

// A record-body field normalized to a list of names. The tree's reference lists may be stored as
// a string, an array, or (an Interface's exposes) an object keyed by name — mirror the UI's own
// normalization so the engine and the client agree on what resolves.
function nameList(v: unknown): string[] {
  if (v == null) return [];
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string") return [v];
  if (typeof v === "object") return Object.keys(v as Record<string, unknown>);
  return [];
}

export async function retrieveSystemScope(systemId: string): Promise<{
  system: { id: string; name: string; elementType: string };
  elements: ScopeEntry[];
}> {
  // The System anchors the scope. A System's system_id is null, so COALESCE(system_id, id) folds
  // the System row into its own scope alongside everything whose system_id is this System.
  const sys = (await query<ElementRow>(
    "SELECT * FROM contour_element WHERE id::text = $1 AND element_type = $2",
    [systemId, ElementType.System],
  )).rows[0];
  if (!sys) throw new NotFound(`No System has id ${systemId}`);

  // Query 1: every element in the scope (the System included). One query, no per-element fetch.
  const elements = (await query<ElementRow>(
    "SELECT id, name, element_type FROM contour_element WHERE COALESCE(system_id, id) = $1 ORDER BY element_type, name",
    [sys.id],
  )).rows;
  const ids = elements.map((e) => e.id);

  // Query 2: the record body of every one of those elements, at once — just the reference fields.
  const bodies = ids.length
    ? (await query<{ element_id: string; body: Record<string, unknown> }>(
        "SELECT element_id, body FROM contour_record WHERE element_id = ANY($1)",
        [ids],
      )).rows
    : [];
  const bodyByEl = new Map(bodies.map((r) => [r.element_id, r.body ?? {}]));

  return {
    system: { id: sys.id, name: sys.name, elementType: sys.element_type },
    elements: elements.map((e) => {
      const body = bodyByEl.get(e.id) ?? {};
      return {
        id: e.id,
        name: e.name,
        elementType: e.element_type,
        uses: nameList(body.uses),
        performs: nameList(body.performs),
        requirements: nameList(body.requirements),
        guardrails: nameList(body.guardrails),
      };
    }),
  };
}

// List an element's revisions, newest first: the live row is the current version, and every
// superseded body is a history snapshot in contour_element_version (Record History Is Kept).
// Used by the Console's version-history dialog (Element View in UI) to populate the list the
// reader picks two revisions from to Diff. Read-only.
export interface ElementVersionRow {
  version: number;
  current: boolean;
  changeNote: string | null;
  changedBy: string | null;
  createdAt: Date;
}

export async function listElementVersions(elementId: string): Promise<ElementVersionRow[]> {
  const el = (await query<ElementRow>("SELECT * FROM contour_element WHERE id::text = $1", [elementId])).rows[0];
  if (!el) throw new NotFound(`No element has id ${elementId}`);

  const snaps = (await query<{ version: number; change_note: string | null; changed_by: string | null; created_at: Date }>(
    `SELECT version, change_note, changed_by, created_at
     FROM contour_element_version WHERE element_id = $1 ORDER BY version DESC`,
    [el.id],
  )).rows;

  const current: ElementVersionRow = {
    version: el.version, current: true, changeNote: null, changedBy: null, createdAt: el.updated_at,
  };
  const history: ElementVersionRow[] = snaps.map((s) => ({
    version: s.version, current: false, changeNote: s.change_note, changedBy: s.changed_by, createdAt: s.created_at,
  }));
  // Newest first: current (highest version) ahead of the superseded snapshots.
  return [current, ...history];
}

export async function deleteElement(elementId: string): Promise<boolean> {
  return withTransaction(async (c) => {
    const el = (await c.query("SELECT id FROM contour_element WHERE id = $1", [elementId])).rows[0];
    if (!el) return false;
    await c.query(
      "DELETE FROM contour_relationship WHERE from_element_id = $1 OR to_element_id = $1",
      [elementId],
    );
    await c.query("DELETE FROM contour_record WHERE element_id = $1", [elementId]);
    await c.query("DELETE FROM contour_element WHERE id = $1", [elementId]);
    return true;
  });
}

// Diff Element: compare two stored revisions of one element — a System included, since a System is
// itself an element with its own record — and return a typed, field-keyed delta with the from/to
// bodies alongside (Requirements: Record History Is Kept, Delta Is Typed And Field Keyed, Delta
// States Code Implications). Read-only.
export interface DiffElementResult {
  element: { id: string; name: string; elementType: string; systemId: string | null };
  from: number;
  to: number;
  fromBody: Record<string, unknown>;
  toBody: Record<string, unknown>;
  changes: Change[];
}

export async function diffElement(
  elementId: string, fromVersion: number, toVersion: number,
): Promise<DiffElementResult> {
  const el = (await query<ElementRow>("SELECT * FROM contour_element WHERE id::text = $1", [elementId])).rows[0];
  if (!el) throw new NotFound(`No element has id ${elementId}`);

  // The live record is the current version; any earlier version is a history snapshot.
  const live = (await query<{ body: Record<string, unknown> }>(
    "SELECT body FROM contour_record WHERE element_id = $1", [el.id],
  )).rows[0];

  const bodyAt = async (v: number): Promise<Record<string, unknown>> => {
    if (v === el.version) {
      if (!live) throw new NoSuchRevision(`Element ${elementId} has no stored record`);
      return live.body;
    }
    const snap = (await query<{ body: Record<string, unknown> }>(
      "SELECT body FROM contour_element_version WHERE element_id = $1 AND version = $2", [el.id, v],
    )).rows[0];
    if (!snap) throw new NoSuchRevision(`Element ${elementId} has no version ${v}`);
    return snap.body;
  };

  const fromBody = await bodyAt(fromVersion);
  const toBody = await bodyAt(toVersion);
  return {
    element: { id: el.id, name: el.name, elementType: el.element_type, systemId: el.system_id },
    from: fromVersion,
    to: toVersion,
    fromBody,
    toBody,
    changes: diffBodies(el.element_type, fromBody, toBody),
  };
}

// ---------------------------------------------------------------------------
// Requirement / Guardrail Functions
// ---------------------------------------------------------------------------
async function storeDefinition(
  table: string, kind: "Requirement" | "Guardrail", defId: string | null, name: string, description: string,
  changeNote?: string | null,
): Promise<DefinitionRow> {
  if (!name?.trim() || !description?.trim()) {
    throw new InvalidDefinition();
  }
  return withTransaction(async (c) => {
    const byName = (await c.query<DefinitionRow>(`SELECT * FROM ${table} WHERE name = $1`, [name])).rows[0] ?? null;
    const byId = defId ? (await c.query<DefinitionRow>(`SELECT * FROM ${table} WHERE id = $1`, [defId])).rows[0] ?? null : null;

    let obj: DefinitionRow;
    if (byId) {
      if (byName && byName.id !== byId.id) throw new NameTaken(`Another definition already has the name '${name}'.`);
      // Record History Is Kept: snapshot the description being replaced, at its current version,
      // before the live row advances (History Is Append Only — insert only).
      await c.query(
        `INSERT INTO contour_definition_version (definition_id, kind, version, description, change_note)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (definition_id, version) DO NOTHING`,
        [byId.id, kind, byId.version, byId.description, changeNote ?? null],
      );
      obj = (await c.query<DefinitionRow>(
        `UPDATE ${table} SET name = $2, description = $3, version = version + 1, updated_at = now()
         WHERE id = $1 RETURNING *`,
        [byId.id, name, description],
      )).rows[0];
    } else {
      if (byName) throw new NameTaken(`Another definition already has the name '${name}'.`);
      obj = (await c.query<DefinitionRow>(
        `INSERT INTO ${table} (id, name, description, version) VALUES ($1, $2, $3, 1) RETURNING *`,
        [defId || randomUUID(), name, description],
      )).rows[0];
    }
    await c.query(
      `UPDATE ${table} SET search_tsv = to_tsvector('english', $2) WHERE id = $1`,
      [obj.id, `${name} ${description}`],
    );
    return obj;
  });
}

export const storeRequirement = (id: string | null, name: string, description: string, changeNote?: string | null) =>
  storeDefinition("contour_requirement", "Requirement", id, name, description, changeNote);
export const storeGuardrail = (id: string | null, name: string, description: string, changeNote?: string | null) =>
  storeDefinition("contour_guardrail", "Guardrail", id, name, description, changeNote);

async function retrieveDefinition(table: string, name: string): Promise<DefinitionRow> {
  const obj = (await query<DefinitionRow>(`SELECT * FROM ${table} WHERE name = $1`, [name])).rows[0];
  if (!obj) throw new NotFound(`No definition named '${name}'`);
  return obj;
}
export const retrieveRequirement = (name: string) => retrieveDefinition("contour_requirement", name);
export const retrieveGuardrail = (name: string) => retrieveDefinition("contour_guardrail", name);

async function isReferenced(c: PoolClient, field: string, name: string): Promise<boolean> {
  const r = await c.query(
    `SELECT 1 FROM contour_record
     WHERE jsonb_typeof(body -> $1) = 'array' AND (body -> $1) @> to_jsonb($2::text) LIMIT 1`,
    [field, name],
  );
  return r.rowCount! > 0;
}

async function deleteDefinition(table: string, field: string, name: string): Promise<boolean> {
  return withTransaction(async (c) => {
    const obj = (await c.query(`SELECT id FROM ${table} WHERE name = $1`, [name])).rows[0];
    if (!obj) return false;
    if (await isReferenced(c, field, name)) throw new StillReferenced(`'${name}' is still referenced.`);
    await c.query(`DELETE FROM ${table} WHERE name = $1`, [name]);
    return true;
  });
}
export const deleteRequirement = (name: string) => deleteDefinition("contour_requirement", "requirements", name);
export const deleteGuardrail = (name: string) => deleteDefinition("contour_guardrail", "guardrails", name);

// The elements whose record references a definition by name — i.e. whose record `field`
// (`requirements` or `guardrails`) array contains `name`. Read-only; used by the View
// Requirement / View Guardrail screens to show "referenced by". Same containment predicate as
// isReferenced, but returning the elements instead of a boolean.
async function definitionReferences(
  field: "requirements" | "guardrails",
  name: string,
): Promise<{ id: string; name: string; elementType: string; systemId: string | null }[]> {
  const rows = (await query<{ id: string; name: string; element_type: string; system_id: string | null }>(
    `SELECT e.id, e.name, e.element_type, e.system_id
     FROM contour_record r JOIN contour_element e ON e.id = r.element_id
     WHERE jsonb_typeof(r.body -> $1) = 'array' AND (r.body -> $1) @> to_jsonb($2::text)
     ORDER BY e.element_type ASC, e.name ASC`,
    [field, name],
  )).rows;
  return rows.map((e) => ({ id: e.id, name: e.name, elementType: e.element_type, systemId: e.system_id }));
}
export const requirementReferences = (name: string) => definitionReferences("requirements", name);
export const guardrailReferences = (name: string) => definitionReferences("guardrails", name);

// ---------------------------------------------------------------------------
// Search Functions
// ---------------------------------------------------------------------------
export async function searchSpecifications(params: {
  query?: string | null;
  elementType?: string | null;
  name?: string | null;
  exactName?: string | null;
  systemId?: string | null;
  componentId?: string | null;
  page?: number;
  pageSize?: number;
}): Promise<{ items: { id: string; name: string; elementType: string }[]; total: number }> {
  const page = Math.max(params.page ?? 1, 1);
  const pageSize = Math.min(Math.max(params.pageSize ?? 20, 1), 200);

  const conds: string[] = [];
  const args: unknown[] = [];
  const add = (sql: string, val: unknown) => { args.push(val); conds.push(sql.replace("$?", `$${args.length}`)); };

  if (params.elementType) add("e.element_type = $?", params.elementType);
  if (params.name) add("e.name ILIKE $?", `%${params.name}%`);
  if (params.exactName) add("e.name = $?", params.exactName);
  // Everything in a System, the System itself included (its scope).
  if (params.systemId) add("COALESCE(e.system_id, e.id)::text = $?", params.systemId);
  if (params.componentId) {
    args.push(params.componentId);
    conds.push(`e.id IN (SELECT to_element_id FROM contour_relationship
      WHERE from_element_id = $${args.length} AND verb IN ('performs','owns','produces'))`);
  }
  let rankSql = "";
  if (params.query) {
    args.push(params.query);
    const p = `$${args.length}`;
    conds.push(`r.search_tsv @@ plainto_tsquery('english', ${p})`);
    rankSql = `, ts_rank(r.search_tsv, plainto_tsquery('english', ${p})) AS rank`;
  }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const order = params.query ? "ORDER BY rank DESC, e.name ASC" : "ORDER BY e.name ASC";

  const total = Number(
    (await query<{ count: string }>(
      `SELECT count(*)::text AS count FROM contour_element e JOIN contour_record r ON r.element_id = e.id ${where}`,
      args,
    )).rows[0].count,
  );
  args.push(pageSize, (page - 1) * pageSize);
  const items = (await query<{ id: string; name: string; element_type: string }>(
    `SELECT e.id, e.name, e.element_type${rankSql}
     FROM contour_element e JOIN contour_record r ON r.element_id = e.id
     ${where} ${order} LIMIT $${args.length - 1} OFFSET $${args.length}`,
    args,
  )).rows;

  return {
    items: items.map((i) => ({ id: i.id, name: i.name, elementType: i.element_type })),
    total,
  };
}

async function searchDefinitions(table: string, q: string): Promise<DefinitionRow[]> {
  return (await query<DefinitionRow>(
    `SELECT * FROM ${table}
     WHERE search_tsv @@ plainto_tsquery('english', $1)
     ORDER BY ts_rank(search_tsv, plainto_tsquery('english', $1)) DESC, name ASC`,
    [q || ""],
  )).rows;
}
export const searchRequirements = (q: string) => searchDefinitions("contour_requirement", q);
export const searchGuardrails = (q: string) => searchDefinitions("contour_guardrail", q);

// Resolve a known set of definitions by exact name in one bounded query
// (name = ANY(names)), not one lookup per name (Requirement: Definitions Resolve
// In One Query). Names with no matching definition are simply absent from the
// result — a gap, never an error. An empty set returns nothing without querying.
async function resolveDefinitions(table: string, names: string[]): Promise<DefinitionRow[]> {
  const unique = [...new Set((names || []).filter((n) => typeof n === "string" && n.length))];
  if (!unique.length) return [];
  return (await query<DefinitionRow>(
    `SELECT * FROM ${table} WHERE name = ANY($1) ORDER BY name ASC`,
    [unique],
  )).rows;
}
export const resolveRequirements = (names: string[]) => resolveDefinitions("contour_requirement", names);
export const resolveGuardrails = (names: string[]) => resolveDefinitions("contour_guardrail", names);

// Helper used by Check Model / Render Diagram: is this the id of a stored System?
export async function systemExists(systemId: string): Promise<boolean> {
  const r = await query(
    "SELECT 1 FROM contour_element WHERE id::text = $1 AND element_type = $2 LIMIT 1",
    [systemId, ElementType.System],
  );
  return r.rowCount! > 0;
}

export { pool };
