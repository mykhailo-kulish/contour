---
name: contour-verify
description: >
  Verify a codebase against an existing Contour architecture record. Loads the
  record — from a local Contour YAML file or from the contour-engine via its MCP
  tools — and checks the source code against it: structural conformance (the
  seven elements and nine relationships the record declares actually exist and
  connect as stated), behavioral conformance (each Function's steps, outcomes,
  and behavior match the code), and, above all, that every referenced
  Requirement is satisfied and every Guardrail is respected in the code. Every
  business branch is traced back to the outcome and the obligation that governs
  it, so a missed Requirement, a crossed Guardrail, or an unhandled outcome is
  reported as a failed check, not a documentation note. Use when asked to verify,
  audit, check, or reconcile code against a Contour record/spec, or to confirm a
  change stayed inside the Contour boundary.
---

# Contour Verify

You check source code **against** a Contour record. Contour is the framework in
`contour.md`; the record shape is `contour.schema.json` (local YAML) or the
`contour-engine` MCP tools (`mcp_contour_engine_*`). Read those if not already in
context — this skill assumes the framework's vocabulary (seven elements, nine
relationship verbs, two zoom levels, outcomes, bindings) and the schema's fields.

Verify is the mirror of Reverse. Reverse derives a record *from* code; Verify
holds an existing record as the **specification and boundary** and asks whether
the code conforms. Section 3.6 of `contour.md` is explicit: Requirements and
Guardrails are *enforced, not declarative* — "a Requirement or Guardrail that
fails that check isn't a documentation gap; it's a failed test." Verify produces
a pass/fail verdict per obligation and per declared outcome, with the code
evidence for each.

**The record is the authority; an interface spec is an output.** If the record's
Interface `binding` links or imports an OpenAPI/AsyncAPI/protobuf file, drift
between that spec and the code is checked the same way as drift between record
and code (`contour.md` §3.3) — the spec is not a second source of truth.

Verify does **not** edit code or the record. It reports. (If asked to also fix
drift, do that as a separate, explicit step after presenting the verdict.)

---

## 0. Load the record (the specification side)

Determine the source and load it fully before touching code:

- **Local YAML** (`--source local`, default when a `*.yaml`/`contour.yaml` path
  is given or MCP is unavailable): read the file; validate it against
  `contour.schema.json` if a validator is available. With no MCP engine to vet
  the record, also run the framework's reference checker to confirm the
  specification is internally sound before you judge code against it:

  ```
  python3 contour-check.py <record>.yaml
  ```

  It reports the §3.3 **contradictions** (the record is wrong) and the §3.7
  **gaps** (the record is unfinished), and exits non-zero only on
  contradictions. A contradiction in the record is a dangling/own-goal finding to
  surface in the report (§5) — the specification itself is defective, independent
  of the code; its gaps mean the record is incomplete, which colours what "code
  conforms" can even mean. If the checker isn't present alongside `contour.md`,
  note that and proceed with the structural/consistency checks by hand. Parse the
  nested ownership (Components under `System.groups`;
  functions/interfaces/dataObjects/events under their Component; top-level Actors
  and Requirement/Guardrail definitions) and resolve every inline name reference.
- **MCP / contour-engine** (`--source mcp`): pull the model with
  `mcp_contour_engine_list_or_search_elements` (list mode, optionally by
  `type`/`systemId`), then `retrieve_element` for each element's full record, and
  `retrieve_requirement` / `retrieve_guardrail` (or the `search_*` tools) for
  every referenced definition. Use `render_diagram` / `render_element_diagram`
  to get the shape the engine considers authoritative.

Build an in-memory map of:

- elements by name and type, ownership, and every relationship edge;
- each **Actor's** `uses` list (the Functions it claims) — the business
  statement each serving Interface's `exposes` must match;
- each **Function's** `steps` (ordered), `result`, `alternatives` (with any
  `becomes` maps and `Unreachable` mappings on `uses` steps), and `behavior`;
- each **Interface's** `serves` (one Actor or `System`), `binding` (`style` +
  keys), `exposes` (per Function: `operation`, `request`, `responses`), and
  `rationale`;
- each **Component's** `performs`, `owns`, `produces`, and `rationale`;
- each **`Neighbour`** block (another System drawn half-open) — its touched
  Events, Functions (name + outcomes) and Interfaces, each Interface serving
  this System as its Actor. A cross-System `uses` step resolves against this
  block, not against a Component of the model under check;
- each Requirement/Guardrail **definition text** keyed by name, plus the list of
  elements that reference it.

If the record references a definition that isn't defined, or a `uses` step names
an Interface/Function that doesn't exist, that is itself a finding (dangling
reference).

---

## 1. Locate the code that implements the record

Identify the Component's codebase / boundary the record describes. Use a
**context-gatherer sub-agent** for an unfamiliar or large codebase to find, per
element, where it lives (controllers/routers for Interfaces, handlers/domain
services for Functions, entities/tables for Data Objects, publishers/consumers
for Events, outbound clients for `uses`/`depends-on`). Treat its output as your
reads, then read the business-logic files yourself — the outcome and
Requirement/Guardrail checks depend on reading the actual branching code.

Map each record element to its code location (or to **"not found"** — a
first-class result). Keep the mapping; the report references it.

---

## 2. Structural conformance

For each element and relationship the record declares, confirm the code backs it.
Report each as pass / fail / partial with the file/symbol evidence:

- **Elements exist**: each Function is real business work in code; each Interface
  is a real entry surface; each Data Object is a real owned store (state the
  Component keeps, not a request/response in transit); each Event is really
  produced/consumed; each Actor really initiates from outside, one-way.
- **Interface `serves`**: the Interface really serves the single caller the
  record names — an **Actor** (one role; if two distinct roles with different
  access share it, that is a finding) or **`System`** (the reserved keyword for
  this System's *own* Components reaching one another — an internal/service
  endpoint). A caller that is another System is never `System`: it is an Actor,
  by name. An Actor the code actually *calls back* is a violation of the one-way
  rule.
- **Interface `binding`**: the `style` and binding keys match the real
  technology (protocol, base address, auth). If the binding links a spec file,
  check the spec against the code too.
- **`exposes`**: the Interface actually exposes exactly the Functions listed, and
  only this Component's own Functions — no undeclared public entry points (a
  route with no Function in the record is a finding), and no listed Function that
  is actually unreachable. Each `operation` is unique within the Interface.
- **`calls` vs `uses`**: same-Component invocations declared as `calls` are
  in-process (no Interface between); cross-Component reaches declared as `uses`
  really cross the named Interface. A `uses` that is actually a direct call into
  another Component's internals (bypassing its Interface) is a violation; a
  `uses` step must name an Interface that `serves: System` and `exposes` the
  target.
- **Data ownership (principle 4)**: each Data Object has exactly one owning
  Component; only that Component's Functions `reads`/`modifies` it directly.
  A Function touching data the record says belongs to another Component is a
  violation. Cross-Component data access must appear as `references`/`consumes`,
  resting on a real `uses`→`exposes` chain or a real Event subscription.
- **Events**: names past tense; producer `produces`, consumer `consumes`;
  consuming an Event does not silently add a `depends-on`.
- **`depends-on` / `references`**: each is explainable by a real
  `uses`→`exposes` chain in code (soft consistency, `contour.md` §3.2) — report
  edges the code doesn't back, and code dependencies the record omits.
- **Actor `uses` ↔ Interface `exposes`** (`contour.md` §3.7): the Functions an
  Actor claims in its `uses` list must equal exactly what the Interface(s)
  serving it `exposes` in code — no more, no less. An Actor that reaches a
  Function in code its `uses` omits, or claims one no serving Interface actually
  exposes, is a finding. For an Interface serving `System`, the counterpart is
  the `uses` steps of the Functions that call it: what it exposes must equal what
  those steps use.
- **`rationale` recoverability** (`contour.md` §3.7): each Component and
  Interface carries a `rationale` (the Actor uses, Requirements, Guardrails,
  principles or allocation that justify it). Confirm the code bears out that
  stated reason; a Component or Interface whose rationale the code cannot
  substantiate — a channel nothing needs, a split no Requirement/Guardrail
  explains — is a finding in itself.

Also report the reverse gap: **code elements/edges absent from the record**
(undeclared endpoints, unpublished-but-present events, extra data writes, a
depended-on Component modeled as an Actor) — these are drift even though the
record itself is internally consistent.

---

## 3. Behavioral conformance

For each Function, compare the record's `steps`, `result`, `alternatives`, and
`behavior` to the code:

- **Steps order and content**: the code performs the `calls`/`reads`/`modifies`/
  `produces`/`uses` edges the `steps` list declares, in that order. `consumes`,
  if present, is the **first** step and is the trigger (the Function is invoked
  on that Event), not an outbound call. Report missing steps, extra steps, wrong
  targets, and reordering that changes meaning.
- **Outcomes** (the core behavioral check): every way the code can end maps to
  the Function's `result` or one of its `alternatives`, and every declared
  outcome is actually reachable in code. Report:
  - an **unhandled outcome** — a way the code ends that no `result`/`alternative`
    names;
  - a **phantom outcome** — a declared `alternative` the code can never reach;
  - a **`becomes` mismatch** — a callee ending the record maps onto this
    Function's alternative that the code maps differently (or not at all);
  - a **missing `Unreachable` handling** — a `uses` whose failure path the code
    doesn't handle the way the record's `Unreachable` mapping says.
  Business endings only: malformed-request and auth-failure paths are the
  binding's concern and should not appear as alternatives — flag it if they do.
- **`responses` coverage**: for each exposed Function, the Interface's
  `responses` cover its `result` and every alternative and only those (unless the
  binding's conventions cover them). A `result`/`alternative` with no response
  mapping, or a response for an outcome the Function can't produce, is a finding.
- **Behavior prose**: the business rules and side effects described actually
  happen, and the code does not do materially more/other business work than the
  record admits. Because prose can under-specify branching (`contour.md` §6),
  drive the deep check through the branch analysis in §4 rather than the prose
  alone.

---

## 4. Requirement and Guardrail verification — the core of Verify

This is the enforced check. For **every element** in the record, take each
Requirement and Guardrail it references and grade it against the code, tracing
through the element's branches and outcomes so nothing business-relevant is
skipped.

### 4.1 Re-establish branch coverage

For each Function that carries obligations (and any it calls), enumerate the
business decision points in the code — `if` / `else if` / `switch`-`case` /
guard clause / early return / ternary / `&&`/`||` short-circuit / loop condition
/ exception path. Measuring cyclomatic complexity (a tool such as `radon`,
`gocyclo`, ESLint `complexity`, `lizard`, PMD if available and read-only, else a
hand count) gives you the branch budget: **CC tells you how many branches must be
accounted for.** Tie each business branch to the **outcome** it produces
(`result`, an `alternative`, or a `becomes` mapping) and the obligation that
governs it. If the code has more business branches than the record's
outcomes + Requirements/Guardrails explain, that gap is a finding (the record has
drifted behind the code, or an obligation/outcome is missing).

### 4.2 Grade each Requirement

A **Requirement** is a positive obligation — verify the code *does* it:

1. Find the branch/logic in code that should satisfy the Requirement's condition
   and outcome (e.g. "rejects orders under $1.00" → the guard that compares total
   to the threshold and ends in the `Below Minimum` alternative).
2. Verdict:
   - **Satisfied** — the code implements the rule and reaches the declared
     outcome; cite the file/line/branch.
   - **Violated** — the rule is absent, or implemented with the wrong
     threshold/condition/outcome; cite what the code does instead.
   - **Unverifiable** — the Requirement's text is too vague to check against code,
     or the relevant code couldn't be located; say which and why (do not guess a
     pass).
3. **Prefer a runtime/behavioral check where feasible** (`contour.md` §3.6): if a
   test exists that asserts the rule, note it; if the interface can be exercised
   live and the user permits, exercise it. Otherwise grade statically against the
   code and label it a static grade.

### 4.3 Grade each Guardrail

A **Guardrail** is a boundary — verify the code *does not* cross it. Boundaries
are harder to test than to state (`contour.md` §6), so reason explicitly:

1. State what crossing it would look like in code (e.g. "computes/authorizes/
   settles payments locally instead of delegating to Billing"; or, for an
   ordering guardrail like `All Or Nothing`, "persists or announces before all
   checks passed").
2. Search for that crossing: local reimplementation of delegated logic, direct
   access to data owned elsewhere, bypassing an Interface, reaching past a
   declared boundary, leaking something an Interface "must never expose," or
   effects produced on an alternative path the guardrail forbids.
3. Verdict:
   - **Respected** — no crossing found; state what you checked (so "respected"
     isn't mistaken for "unchecked").
   - **Crossed** — cite the exact code that violates the boundary.
   - **Unverifiable** — boundary too vague to check, or code not locatable; say so.

### 4.4 Coverage guarantee

Every referenced Requirement and Guardrail gets an explicit verdict — no silent
omissions. Every business branch identified in §4.1 is tied to the outcome and
the obligation that governs it, or flagged as **uncovered** (a branch with
business meaning that no outcome/Requirement/Guardrail in the record addresses).
A dangling reference (element cites a definition the record doesn't define, or a
`uses`/`becomes` names something undefined) is reported as a failure.

---

## 5. Verdict and report

Produce a structured, skimmable report. Keep two kinds of finding distinct, the
way `contour.md` §3.7 separates them: a **contradiction** — the record and the
code conflict, so one is wrong (a declared element/edge/outcome the code
disproves, or code behavior the record forbids) — versus a **gap** — something
the record leaves unfilled that the code reveals (an undeclared endpoint, an
unclaimed Actor `use`, a Component or Interface with no recoverable rationale).
A contradiction fails the verdict; a gap is reported as drift-to-reconcile, not
a hard failure, unless it hides a contradiction.

1. **Overall verdict** — PASS only if there are no contradictions: no structural
   violations, no behavioral violations (steps, outcomes, and `responses`
   coverage all conform), and every Requirement satisfied and every Guardrail
   respected; otherwise FAIL, with the count of each failure class. List gaps and
   Unverifiable items separately — they do not silently pass, nor do they
   silently fail the verdict on their own.
2. **Requirements table** — name · governing element · verdict
   (Satisfied/Violated/Unverifiable) · code evidence · static-or-runtime.
3. **Guardrails table** — name · governing element · verdict
   (Respected/Crossed/Unverifiable) · what was checked · evidence.
4. **Structural findings** — record-declared-but-missing, and
   code-present-but-undeclared (drift both ways), including Interface
   `serves`/`binding`/`exposes` mismatches and any depended-on Component modeled
   as an Actor.
5. **Behavioral findings** — per Function: steps mismatches; outcome findings
   (unhandled / phantom / `becomes` / `Unreachable`); `responses` coverage; and
   the branch-coverage check: CC, #business branches, #covered, any uncovered
   branch.
6. **Consistency-check findings** — the style-neutral checks from `contour.md`
   §3.3 that touch code or the record's internal integrity (on the local-YAML
   source these are exactly what `contour-check.py` from §0 automates; here you
   additionally confirm each against the code, which the checker cannot see):
   1. each Interface belongs to one Component and `serves` an existing Actor or
      `System`; `exposes` only that Component's Functions;
   2. each exposed Function's `responses` cover its `result` and every
      alternative and only those (unless the binding covers them);
   3. no two Functions share an `operation` within one Interface;
   4. requests/response bodies reference only the Component's own Data Objects,
      nested types, or projections;
   5. every `uses` step names an Interface that `serves: System` and
      `exposes` the target;
   6. `becomes` keys are callee outcomes (or `Unreachable` on a `uses`); values
      are the caller's alternatives;
   7. every `uses` step maps `Unreachable`;
   8. `consumes` appears only as the first step, at most once, on another
      Component's Event, and such a Function is exposed by no Interface;
   9. a `calls` step stays within one Component — a caller and callee the code
      places in different Components contradicts the edge (`contour.md` §3.3
      check 9 / principle 9: the redesign rule, never a silent cross-Component
      call);
   10. allocation is single — one performing Component per Function, one owning
       Component per Data Object, one producing Component per Event;
       `reads`/`modifies` stay with the owner, and an Event is produced where
       its Function runs (`contour.md` §3.3 check 10).
7. **Unverifiable / assumptions** — what couldn't be determined and why (vague
   obligation text, code not found, complexity unmeasured, a caller you couldn't
   classify as Actor vs `System`). State plainly; never convert an unchecked
   item into a pass.
8. Where the record came from (file path, or engine + element/definition names)
   and the code boundary checked.

---

## Guardrails for this skill

- **Verify is read-only.** Do not modify code or the record. Fixing drift is a
  separate, explicitly-requested step. (`contour-check.py` is read-only too — it
  reads the record file and reports; it never edits.)
- **Vet the record before judging code against it.** With no MCP engine, run
  `contour-check.py` on the local-YAML record (§0); a contradiction in the record
  is a defect in the specification itself, reported independently of the code.
- **Every Requirement and Guardrail gets an explicit verdict**; "not mentioned"
  is not an allowed outcome.
- **Every declared outcome is checked both ways** — reachable in code, and every
  code ending named by a `result`/`alternative`. An unhandled or phantom outcome
  is a finding.
- **Don't confirm without evidence.** A pass cites the code that satisfies it; a
  "respected" states what was checked. No evidence → Unverifiable, not pass.
- **The record is the specification; the code is what's judged.** But report
  *both* directions of drift — code doing more than the record admits is a
  finding too. A linked interface spec is an output, not a second authority.
- **Hold the v0.5 model**: a Function carries no technology (technology is on the
  Interface `binding`); an Interface serves exactly one caller (Actor or
  `System`); Actors are one-way; a request/response in transit is an inline
  shape, not a Data Object; `consumes` is a first-step trigger.
- **Ground checks in real branches.** Use cyclomatic complexity as the branch
  budget so no business `if` escapes the outcome/Requirement/Guardrail trace.
- **Prefer behavioral/runtime evidence** where feasible and permitted; label
  static grades as static. Exercising a live interface is medium-risk — confirm
  before hitting anything beyond a local/dev instance, and never against
  production without explicit permission.
- **Don't fabricate metrics or verdicts**; measured-or-estimated must be labeled,
  and unlocatable code is Unverifiable.
