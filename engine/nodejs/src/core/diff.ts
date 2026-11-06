// Typed, field-keyed delta between two revisions of one element's record body.
//
// Diff Element returns this instead of a line-by-line text diff: each change names the record
// field or relationship verb it touches, whether it was added, removed or changed, and the value,
// plus an `implication` derived from the same Contour invariants Validate Element and Check Model
// enforce — so the delta reads as a change agent's task list (Requirements: Delta Is Typed And
// Field Keyed, Delta States Code Implications). Which fields can change depends on the element's
// type, since a System is itself an element with its own record (contour.md 3.3).

export type ChangeKind = "added" | "removed" | "changed";

export interface Change {
  field: string;
  verb?: string; // the relationship verb this field is stored as, when it is a reference list
  kind: ChangeKind;
  name?: string; // for a keyed collection (an alternative, an exposed Function), the entry's key
  value?: unknown; // the "to" value (added/changed) or the "from" value (removed)
  implication: string;
}

// The reference-list fields of each element type and the verb each is stored as — mirrors
// LIST_REFERENCE_FIELDS in contour.ts, but kept local so the diff names the verb in its output.
const LIST_FIELD_VERB: Record<string, string> = {
  groups: "groups", performs: "performs", owns: "owns", produces: "produces",
  exposes: "exposes", uses: "uses", requirements: "", guardrails: "",
};

// Fields whose value is a keyed object (name -> detail), diffed per key.
const KEYED_FIELDS = new Set(["alternatives", "exposes"]);

// A stable, order-insensitive view of a list of scalars.
function asSet(v: unknown): Set<string> {
  if (!Array.isArray(v)) return new Set();
  return new Set(v.map((x) => (typeof x === "string" ? x : JSON.stringify(x))));
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

// The implication of a change, keyed by field (and kind). Derived from the Contour invariants:
// an added alternative needs a response mapping in every exposing Interface and a test; a changed
// performs may split a calls edge across Components; a System gaining a groups entry is a new
// Component to allocate; an added requirement/guardrail reference becomes an obligation to grade.
function implicationFor(elementType: string, field: string, kind: ChangeKind, name?: string): string {
  const who = name ? `'${name}'` : "an entry";
  switch (field) {
    case "steps":
      return "The Function's main path changed — re-trace outcomes, becomes mappings and the one-test-per-outcome coverage.";
    case "result":
      return "The main-path ending changed — update every Interface response map that names it and its test.";
    case "alternatives":
      if (kind === "added")
        return `New outcome ${who} — add a response mapping in every Interface exposing this Function, and one test for it (contour.md 3.3 check 2).`;
      if (kind === "removed")
        return `Outcome ${who} removed — drop its response mapping from every exposing Interface and its test; check no caller's becomes still maps to it.`;
      return `Outcome ${who} changed — re-check its response mapping and test.`;
    case "exposes":
      if (kind === "added")
        return `Interface now exposes ${who} — the Actor it serves must 'use' it, and its responses must cover exactly that Function's outcomes (checks 1, 2).`;
      if (kind === "removed")
        return `Interface no longer exposes ${who} — a caller 'uses' step or the served Actor's 'uses' may now be a gap.`;
      return `Exposed Function ${who} changed — re-check request/response shapes against its outcomes.`;
    case "performs":
      return "Function allocation changed — a 'calls' step that now spans two Components contradicts the edge; it is a redesign (one Component, or an Interface + 'uses'), never a silent rewrite (check 9).";
    case "owns":
      return "Data Object ownership changed — reads/modifies must stay with the owner; a cross-Component reader must go through an Event or external Function (principle 4, check 10).";
    case "produces":
      return "Event production changed — an Event is produced where its Function runs; check its consumers in other Systems still resolve.";
    case "groups":
      return kind === "added"
        ? `System grouped a new Component ${who} — allocate its Functions, Data Objects and Events, and give it a rationale.`
        : `Component ${who} left the System — its allocations and Interfaces may now be gaps.`;
    case "uses":
      return "An Actor's used Functions changed — every Interface serving it must expose exactly this set (contour.md 3.7).";
    case "serves":
      return "The Interface's caller changed — what it exposes must now equal that caller's 'uses' (check 1, 3.7).";
    case "binding":
      return "The Interface binding changed — regenerate or re-check its spec (OpenAPI/gRPC/…) against the record.";
    case "schema":
      return "The shape changed — update every request/response projection that references it and any bound consumer.";
    case "requirements":
      return kind === "added"
        ? `New obligation ${who} — satisfy it and grade the element against the Requirement's description (3.6).`
        : `Requirement ${who} no longer referenced — its test no longer applies to this element.`;
    case "guardrails":
      return kind === "added"
        ? `New boundary ${who} — the implementation must stay inside it; grade against the Guardrail's description (3.6).`
        : `Guardrail ${who} no longer referenced — its boundary no longer governs this element.`;
    case "description":
    case "behavior":
      return "Prose changed — re-read; may change how a reader or agent interprets the element without any structural signal.";
    default:
      return `Field '${field}' ${kind}.`;
  }
}

// Compute the delta from `fromBody` to `toBody` for an element of `elementType`.
export function diffBodies(
  elementType: string,
  fromBody: Record<string, unknown>,
  toBody: Record<string, unknown>,
): Change[] {
  const changes: Change[] = [];
  const fields = new Set<string>([...Object.keys(fromBody ?? {}), ...Object.keys(toBody ?? {})]);

  for (const field of fields) {
    const a = (fromBody ?? {})[field];
    const b = (toBody ?? {})[field];
    if (deepEqual(a, b)) continue;

    const verb = LIST_FIELD_VERB[field];
    const base = (kind: ChangeKind, name?: string, value?: unknown): Change => ({
      field, ...(verb ? { verb } : {}), kind, ...(name ? { name } : {}),
      ...(value !== undefined ? { value } : {}), implication: implicationFor(elementType, field, kind, name),
    });

    // A keyed collection (alternatives, exposes): diff per entry so each outcome/operation is
    // its own change with its own implication.
    if (KEYED_FIELDS.has(field) && (isObj(a) || isObj(b))) {
      const ao = isObj(a) ? a : {};
      const bo = isObj(b) ? b : {};
      const keys = new Set<string>([...Object.keys(ao), ...Object.keys(bo)]);
      for (const k of keys) {
        if (!(k in ao)) changes.push(base("added", k, bo[k]));
        else if (!(k in bo)) changes.push(base("removed", k, ao[k]));
        else if (!deepEqual(ao[k], bo[k])) changes.push(base("changed", k, bo[k]));
      }
      continue;
    }

    // A reference list of scalars (performs, owns, requirements, …): one change per added/removed
    // name, so the delta names the specific Function/Requirement that moved.
    if (Array.isArray(a) || Array.isArray(b)) {
      const as = asSet(a), bs = asSet(b);
      const everyScalar = [...as, ...bs].every((x) => !x.startsWith("{") && !x.startsWith("["));
      if (everyScalar && field !== "steps") {
        for (const name of bs) if (!as.has(name)) changes.push(base("added", name, name));
        for (const name of as) if (!bs.has(name)) changes.push(base("removed", name, name));
        continue;
      }
      // steps (ordered) or a list of objects: report as one whole-field change.
      changes.push(base(a === undefined ? "added" : b === undefined ? "removed" : "changed", undefined, b ?? a));
      continue;
    }

    // A scalar or nested object field (description, behavior, schema, serves, binding, result).
    changes.push(base(a === undefined ? "added" : b === undefined ? "removed" : "changed", undefined, b ?? a));
  }

  // Deterministic order: by field, then by name.
  changes.sort((x, y) => (x.field === y.field ? (x.name ?? "").localeCompare(y.name ?? "") : x.field.localeCompare(y.field)));
  return changes;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
