// The Contour v0.5 vocabulary: seven element types and the relationship verbs.
// Shared by persistence, validation and rendering. Mirrors contour.md Section 3.

export const ElementType = {
  System: "System",
  Component: "Component",
  Interface: "Interface",
  Function: "Function",
  Event: "Event",
  DataObject: "DataObject",
  Actor: "Actor",
} as const;
export type ElementType = (typeof ElementType)[keyof typeof ElementType];

export const Verb = {
  groups: "groups",
  performs: "performs",
  exposes: "exposes",
  uses: "uses",
  calls: "calls",
  produces: "produces",
  consumes: "consumes",
  reads: "reads",
  modifies: "modifies",
  owns: "owns",
  references: "references",
  dependsOn: "depends-on",
} as const;
export type Verb = (typeof Verb)[keyof typeof Verb];

export const ALL_ELEMENT_TYPES = new Set<string>(Object.values(ElementType));
export const ALL_VERBS = new Set<string>(Object.values(Verb));

// The reserved caller keyword for an Interface serving this System's own
// Components (contour.md 3.3).
export const SYSTEM_CALLER = "System";

// The built-in outcome every cross-Component `uses` step maps (3.3 check 7).
export const UNREACHABLE = "Unreachable";

export interface RelationshipInput {
  verb: Verb;
  toElementId: string;
}

export interface StoreElementRequest {
  element: {
    id?: string | null;
    name: string;
    elementType: ElementType;
    systemId?: string | null;
  };
  record?: Record<string, unknown>;
  relationships?: RelationshipInput[];
  // Optional provenance kept on the superseded revision's history snapshot (Record History Is
  // Kept): why this write happened, and which Interface wrote it.
  changeNote?: string | null;
  changedBy?: string | null;
}

// The System an element belongs to — its scope for name uniqueness and name resolution. A System
// is its own scope; every other element's scope is its systemId.
export function scopeOf(el: { id: string; elementType: string; systemId?: string | null }): string | null {
  return el.elementType === ElementType.System ? el.id : (el.systemId ?? null);
}

// SQL expression for an element row's scope (System id), matching the unique index.
export const SCOPE_SQL = "COALESCE(system_id, id)";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

// Record fields that hold names of other elements, by element type, and the edge verb each one is
// stored as (Requirement: Ownership Relations Are Stored). A Function's references live in its
// ordered steps (and the effects of its alternatives) instead — see STEP_VERBS.
export const LIST_REFERENCE_FIELDS: Record<string, { field: string; verb: Verb }[]> = {
  [ElementType.System]: [{ field: "groups", verb: Verb.groups }],
  [ElementType.Component]: [
    { field: "performs", verb: Verb.performs },
    { field: "owns", verb: Verb.owns },
    { field: "produces", verb: Verb.produces },
  ],
  [ElementType.Interface]: [{ field: "exposes", verb: Verb.exposes }],
  [ElementType.Actor]: [{ field: "uses", verb: Verb.uses }],
};

// Verbs a Function's steps (and alternative effects) are written in; each targets another element.
export const STEP_VERBS = new Set<string>([
  Verb.consumes, Verb.calls, Verb.uses, Verb.reads, Verb.modifies, Verb.produces,
]);

// Verbs whose target must belong to the same System as the source: allocation, exposure and
// same-Component access. `uses`, `consumes`, `references` and `depends-on` may reach a neighbour
// System (contour.md 3.3, 3.7).
export const SAME_SYSTEM_VERBS = new Set<string>([
  Verb.groups, Verb.performs, Verb.owns, Verb.exposes, Verb.calls, Verb.reads, Verb.modifies, Verb.produces,
]);
