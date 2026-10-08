# Contour Experiments

## Evidence log and roadmap for the Contour framework

**Companion to [`contour.md`](contour.md)** (v0.3 and later) — the
framework paper holds the concept; this document holds the evidence for
it and the plan for testing it further. It grows as experiments run,
without requiring a new release of the paper.

**Author:** Mykhailo Kulish ([LinkedIn](https://www.linkedin.com/in/mkulish/))

References of the form **paper §3.6** or **paper principle 3** point
into `contour.md`; plain **Section n** references point inside this
document.

---

## Claims under test

The paper makes two primary claims: that a readable Contour record is
enough to **propagate a described change** into an existing codebase
correctly, and enough to **build a new Component from as a spec**. A
third possibility — reconstructing an existing system's real prior
behavior from its record alone — is explicitly optional, and nothing
else depends on it. Where the evidence stands:

| Claim | Tested on | Status |
|---|---|---|
| Change propagation into existing code | Small self-describing codebase (Experiment 2) | Supported — two passes, both behaviorally verified |
| Build from spec — structure and boundary | Small codebase (Experiment 1); real legacy subsystem (Experiment 3) | Supported — one source-verified contradiction (a missing dependency) |
| Build from spec — detailed behavior | Small codebase (Experiment 1) | Supported — two independent builds agreed on core semantics |
| Build from spec — detailed behavior | Real legacy subsystem (Experiment 3) | Not supported by the record alone — the legacy source had to be read directly; record-derived tests caught one of seven behavioral defects |
| Full reconstruction from the record alone | — | Untested, optional |

Every experiment so far is a single run, and Experiment 3's comparison
with the legacy system was static (reading its source), never
behavioral (running both against the same inputs).

---

## 1. Experimental setup

Three experiments have been run. The first two used `contour-engine`, a
Java/Spring Boot implementation of the Contour metamodel itself, built
from a YAML record (`contour.yaml`) in the shape sketched in paper
§3.3 and served through a REST API and an MCP server. The record
carries one Requirement and three Guardrails that the results below
refer to:

- Requirement **Uses full-text search** — search over the record must be
  backed by a real full-text index, not a scan.
- Guardrail **Read-only function** — the search Function must not modify
  any Data Object.
- Guardrail **Proper field indexes** — the fields the search Requirement
  names must be indexed.
- Guardrail **Interfaces Share One Core** — the REST and MCP Interfaces
  expose the same Functions through one service layer; neither may
  implement behavior of its own.

The experiments:

- **Experiment 1 — build from spec: two independent implementations from
  one record.** This tests the second claim (a new Component can be
  built from the record as a spec). `contour-engine` (Java) and
  `contour-engine-py` (Python/FastAPI), built by different sessions from
  nothing but the same byte-identical `contour.yaml`, were run
  simultaneously against one shared database and cross-called against
  each other's data.
- **Experiment 2 — change propagation into existing code.** This tests
  the first claim. A plain-language change ("also search Requirements
  and Guardrails, not just Elements") was routed record-first: the agent
  read the existing Requirement and Guardrails via the MCP server before
  touching any code, amended the Requirement (v1 → v2), then conformed
  the Java implementation to it, rebuilt, and confirmed the change
  behaviorally against the live database. A second, self-correcting pass
  (v2 → v3) used the first pass's own findings to redesign the record —
  splitting one search Function into three scoped ones — and
  re-propagated that into code.
- **Experiment 3 — build from spec against a real legacy subsystem.** This
  tests the second claim outside a self-describing codebase, and is a
  first run of Roadmap item 6 (Section 5). The subject was an
  undocumented, roughly 2,900-line stateful component inside an older
  application-server monolith at a real company, owning the lifecycle
  of a transactional order record — submission, cancellation,
  settlement, and an early-exit valuation path. A Component record of
  its *target* shape (Functions, Data Objects, Events, Requirements,
  Guardrails, and a `depends-on` map classifying each neighbour as
  already decomposed, hybrid, still in the monolith, or not actually a
  dependency) served as the spec for a new, standalone service built
  from scratch. Below it, in priority order, the builder had a
  companion extraction plan derived from the record (technology stack,
  API shape, integration mechanism per dependency), a line-referenced
  deep-dive into the legacy component's core methods, and real schemas
  from the company's schema registry where they existed. Every
  `depends-on` neighbour was treated as an opaque boundary behind a
  client interface. The first build compiled and passed its tests:
  around eight REST endpoints and one event consumer, eight integration
  clients, a relational model with versioned migrations, and roughly
  two dozen tests written from the record's Requirement text. A second
  pass then compared the build against the legacy source line by line.
  That pass re-read each cited method body directly instead of relying
  on a sub-agent's summary of it. It found six behavioral defects and
  one identifier-typing error in the first build, and each was fixed
  with a regression test.

Experiments 1 and 2 are documented in full in `EXPERIMENT-REPORT.md` and
`EXPERIMENT-REPORT-CHANGE-PROPAGATION.md`, Experiment 3 in
[`EXPERIMENT-NOTES-ANONYMIZED.md`](EXPERIMENT-NOTES-ANONYMIZED.md)
(company, product, and service names removed); this document
summarizes what they show for the paper's claims.

**How far Experiment 3 can be trusted.** It is weaker evidence than its
scale suggests, in three specific ways. First, the record was not the
only input. The claim actually tested was "record plus legacy source,
plus real schemas where they exist," and Section 3 shows that most of
the behavioral precision came from the source. Second, the comparison
with the legacy system was static, not behavioral. The second pass read
the legacy code line by line, but the new service was never run against
the legacy component's inputs and outputs, and it has carried no
production traffic. The tests were written by the same builder who
wrote the code, and at least two had been written against the first
implementation rather than against the record, so they had to change
when that implementation was corrected. Third, it is a single build,
with no second independent implementation to diverge from, and that
divergence is what exposed most of Experiment 1's findings.

---

## 2. What proves the approach

- **A record propagates a described change correctly into existing code.**
  The first claim held on both passes of Experiment 2: each record
  amendment was implemented, rebuilt against an already-populated
  database with a clean migration, and passed a live behavioral
  acceptance test — without the developer ever pointing at a file.
- **A record builds independent implementations that agree on core
  semantics.** The second claim held in Experiment 1: given nothing but
  the same record, the Java and Python engines derived the same table
  shape, ownership rules, relationship semantics, versioning, and
  delete-cascade behavior. An element created by one was fully readable,
  linkable, and deletable by the other; cross-ownership and
  required-field validation rejected the same inputs on both, with the
  same HTTP status.
- **Requirements and Guardrails behaved as enforceable obligations, not
  prose.** The Read-only function and Proper field indexes Guardrails
  held through both iterations of Experiment 2, checked by direct
  assertion, and the Uses full-text search Requirement's version history
  (v1 → v2 → v3) stands as a legible, auditable record of what the
  capability was asked to do and why.
- **Record-first is the workflow an agent reaches for naturally, not one
  that has to be imposed.** In Experiment 2 the agent read the record before
  the code and amended the record before touching the code, unprompted —
  consistent with paper principles 6 and 8.
- **Interfaces Share One Core held in practice.** Adding two new search
  Functions required no change to the pre-existing REST endpoint at all —
  one service-layer change updated both the REST and MCP surfaces
  together, as the Guardrail intends.
- **A test derived from a Requirement caught a deviation before review
  did (Experiment 3).** A settlement-commit Requirement names exactly
  four statuses that cannot be settled again. The first implementation
  instead reused a broader "terminal status" grouping taken from the
  legacy source, which includes a fifth status. That fifth status is a
  legitimate entry point for a booking-only commit, such as crediting a
  consolation amount. A test written from the Requirement's own wording
  failed, which is paper §3.6's "a failed check is a failed test"
  working as intended. The second pass then qualified the result: the
  real legacy rule is neither list. It is status membership *and* a
  settlement timestamp *and* an elapsed grace period (Section 3). The
  test caught the implementation drifting from the record. It could not
  show that the record matched the system.
- **The record's structure carried over to a real legacy subsystem
  (Experiment 3).** Functions, Data Objects, Events, Requirements, and
  Guardrails translated directly into a working service. The `depends-on`
  classification turned each neighbour into either a client interface or
  Component-internal logic, with no ambiguity about which. Guardrails
  shaped structure as well as behavior. "Booking logic stays in the
  booking helper" produced a separate booking seam instead of inline
  balance arithmetic. "Failure recording runs independently of the
  caller's rollback" produced a dedicated component so that the
  framework's new-transaction propagation would actually apply.
- **The design principles decided cases the record left open
  (Experiment 3).** The registry's status enum lists roughly 19 values,
  but the Component's own Functions transition into only a subset of
  them. Paper principle 4 settled it: this Component is the sole writer
  of its record's status, so the service models the lifecycle it owns
  and treats the extra values as a downstream projection's own union.
  For one valuation-pricing dependency, no external spec existed at
  all. That client was built from the record alone (its steps, one
  Requirement, and one Guardrail), although with no real counterpart to
  check it against.

---

## 3. What challenges the approach

- **The record specifies logical content, not physical shape — and the gap
  produced a real, reproducible failure.** The one outright crash observed
  across Experiments 1 and 2 came from this: the record requires full-text
  search to exist and be indexed, but not how, so the two implementations
  in Experiment 1 built schema-incompatible physical indexes (a functional
  index over the whole record body vs. a generated column over named
  fields) — one engine's search then failed with a 500 against the
  other's schema.
- **A naming convention stated in prose doesn't have one algorithmic
  reading.** "Event names are past tense" (paper §3.5) is a convention, not
  a defined test; the two implementations in Experiment 1 chose different
  irregular-verb lists and accepted or rejected the identical input (`"Data
  Given"`) differently. Enforced as a hard validation rule, a rule stated
  only in natural language will diverge across implementations.
- **A derived obligation between a Requirement and a Guardrail isn't visible
  as a dependency.** In Experiment 2, Proper field indexes was only
  correct once Uses full-text search defined which fields were in scope;
  widening the Requirement silently reopened the Guardrail, and nothing in
  the record structure flagged that coupling — the agent had to infer it to
  avoid leaving the Guardrail quietly violated.
- **The record leaves response shape undecided when a change spans more than
  one kind of thing.** Extending search to cover Requirements and Guardrails
  as well as Elements (Experiment 2, first pass) forced an undocumented
  design choice — a discriminated result union vs. separate per-kind
  results — that a second agent could reasonably resolve differently and
  still be fully record-compliant, while producing wire-incompatible output.
  It took a deliberate second record change (splitting into three scoped
  search Functions) to remove the ambiguity; the original record didn't rule
  it out.
- **The paper's §4 shapes were read differently by each engine.** The two
  engines in Experiment 1 rendered the same diagram content (same nodes,
  same edges) with different shapes and layout conventions. Paper §4 now
  states that shapes are recommended rather than normative.
- **Validation payload shape and interface transport are unconstrained by
  the record.** Both engines in Experiment 1 returned the same HTTP status on
  invalid input but different violation-payload shapes, and chose
  incompatible MCP transports (SSE vs. stdio) — less a record ambiguity than
  a silent gap in what Interfaces Share One Core is meant to guarantee:
  drop-in interchangeability, or only consistent logical behavior.
- **Tooling: wholesale edge-list replacement makes small record changes
  risky.** In `contour-engine`, a relationship is only editable by
  replacing its owning element's full outgoing edge list, so adding two
  edges in Experiment 2 meant re-submitting 24- and 11-edge lists in
  full. A tooling gap rather than a metamodel gap, but it bears on how
  safely a record can be evolved.
- **The physical-schema gap reproduced at real scale (Experiment 3).** The
  record's two core Data Objects are prose-only. The registry schema for
  the same data is an order of magnitude richer: money in minor units, a
  validation-failure taxonomy of about 20 codes, a unified incentives
  model, product-line-specific fields, and a detailed status that
  supersedes a deprecated simple one. The record also gave no identifier
  types, and one was got wrong: channel and till identifiers were typed
  as UUIDs by analogy with the customer identifier and had to be
  corrected to integers after a field-by-field pass over the real schema.
  Paper §3.3 already says `schema` should point at the existing spec.
  For a legacy extraction, that pointer is not optional.
- **The target design broke an existing consumer's contract, and nothing
  in the record could flag it (Experiment 3).** The new service uses a
  genuine UUID primary key, while an existing Event schema types the
  order identifier as an integer. The main schema even carries a field
  named "uuid" that is really a legacy numeric id. The publisher
  currently emits a placeholder numeric projection of the UUID, and the
  issue is unresolved. The record carried the Data Object's ownership but
  not the fact that its Event already had consumers bound to a wire
  shape. A consumed, pre-existing Event contract is a compatibility
  constraint, and the record had no way to mark it as one.
- **A document derived from the record got a mechanism wrong where the
  record was right (Experiment 3).** The record said only that
  submission `uses` a validation service's Interface, which is
  mechanism-agnostic per paper principle 3. The extraction plan, written
  from the record, assumed synchronous REST. The legacy source showed a
  binary RPC protocol with a schema-defined contract. The logical edge
  was correct; the mechanism filled in one tier below it was a guess.
  Mechanism claims about a record's edges need to be verified against
  source, and the Interface's `schema`, left empty in this record, is
  where the verified answer belongs.
- **What happens when a dependency call fails is not recorded
  (Experiment 3).** Every integration client needed a policy for a call
  that fails outright (timeout, server error, partition), which is
  distinct from a call that succeeds and says no. Neither the record nor
  the plan stated one. The builder made the validation and
  risk-reservation dependencies fail-closed, because the record names
  them as hard gates through a Requirement and a Guardrail, and made a
  secondary compliance-cooldown check fail-open. The reasoning is
  defensible, but it is inference, and a second builder could choose
  differently. This is the same class of divergence as Experiment 1's
  transports, one level deeper.
- **A Requirement named an obligation but not its computation, and the
  build left it unmet (Experiment 3).** Settlement handling must update
  a customer's aggregate risk/exposure figures when the settled amount
  changes. The target endpoint and its request shape exist and were
  found. The mapping from a settlement delta (win, loss, refund) to
  which attribute moves by how much was in neither the record nor the
  plan, and could not be inferred from source with confidence. The
  builder deferred the call rather than invent product behavior. That
  was the right decision, but by paper §3.6's own rule it is a failed
  Requirement check, not a documentation gap, so the build is
  substantially complete rather than complete. It is also the first
  direct evidence for the paper's §6 concern that `behavior` can be
  under-specified for real domain logic.
- **Record-derived tests caught one behavioral defect, and reading the
  source directly found six more (Experiment 3).** A test written from a
  Requirement cannot catch what the Requirement doesn't say. The second
  pass found:
  - a "forced" cancellation override built as an unconditional widening,
    where the legacy code uses catch-and-substitute that skips the
    validity re-checks and so avoids running compensating side effects
    twice;
  - a final-state guard missing its timestamp and grace-period
    conditions;
  - two separate time-window checks merged into one, measured from the
    wrong timestamp;
  - no compensation path when an approval fails partway through, leaving
    a reserved incentive unreleased;
  - a plain threshold comparison that ignored negative corrections;
  - an incentive release missing its category gate.

  The record named every one of these obligations, sometimes in the same
  prose that turned out to be ambiguous: "if the amount actually
  changed" does not say whether the change is measured as an absolute
  value. It fixed the exact rule in none of them. Several would have
  changed what can be cancelled or settled, which is a correctness
  failure and not merely a divergence.
- **The record was wrong in places, not only silent (Experiment 3).**
  Two defects trace to the record itself, not to gaps it left.
  - The cancellation Function's `steps` and the record's `depends-on`
    map omit an audit-journal side effect that the legacy method runs on
    every successful cancellation, so the first build had none at all.
    The dependency map needed a correction from source.
  - The four-status settlement Requirement above is a lossy summary of a
    rule with three conditions, one of them time-dependent. Implemented
    faithfully, it produces the wrong answer for a record in a final
    status whose settlement is older than the grace period.

  The experiment notes attribute every second-pass defect to "gaps the
  record correctly leaves open." For these two, that attribution does
  not hold.
- **Real control flow needs the branches `steps` cannot hold (Experiment
  3).** Three of the six second-pass defects are conditional structure:
  a catch-and-substitute retry, two independent guards, and a
  compensation path on failure. A straight-line `steps` list can't
  express any of them, so each lived only in prose or nowhere. That
  prose is where the first build went wrong. The paper's §6 left
  branching out until experiments showed real systems need it, and this
  is that evidence.
- **A prose summary of control flow loses precision, and a record is one
  (Experiment 3).** Three of the second-pass defects started from a
  sub-agent's natural-language summary of a legacy method that was
  imprecise. In one case the sub-agent said outright that it could not
  verify the method body, and nobody followed that up until the second
  pass. Direct reads of the cited lines supplied the exact status sets,
  fields, and branch structure. The builder's resulting rule was to
  treat a paraphrase of control flow as a lead to verify, never as
  ground truth, especially where there is more than one branch. A
  Contour record written from source is the same kind of paraphrase, and
  the settlement Requirement above failed in the same way.
- **The record described a target Component, and nothing marked it as a
  target (Experiment 3).** The subsystem being extracted was not yet a
  Component in paper principle 1's sense, because it still shared the
  monolith's lifecycle; the record described the service it should
  become. The decomposition status of each neighbour had to be carried
  as an attribute the metamodel doesn't define. The current-versus-planned
  route for one money-movement dependency lived only in the plan, whose
  "separately gated cutover" caution was written for strangling a live
  monolith and did not apply to a from-scratch build. Contour cannot
  currently say whether a record describes what exists or what is
  planned, and legacy work needs both.

---

## 4. Net read

Across the three experiments the pattern is consistent at the level of
structure and much weaker at the level of detailed behavior. On one
small codebase, Experiments 1 and 2 supported both primary claims. Two
independent implementations agreed on ownership, relationships,
versioning, validation outcomes, and cascade semantics, with no
core-metamodel violation. The divergences sat in the tier the record
leaves underspecified by design: physical schema, payload and transport
shape, a prose naming heuristic, and diagram cosmetics.

Experiment 3 splits the build-from-spec answer in two. As a statement
of structure and boundary, the record of a real legacy subsystem was
sufficient. It covered what the Component owns, which Functions it
performs, which neighbours it calls and which logic moves inside it,
and which Requirements and Guardrails bind it. Source verification
contradicted it in only one place there: a missing dependency. As a
behavioral spec, the record was not sufficient. Of the seven behavioral
defects in the first build, a test derived from the record caught one.
The other six surfaced only when the legacy source was read directly,
and one of those showed that the Requirement behind the first catch was
itself a simplification. The claim that held is therefore narrower than
"record plus source": the record fixed the shape, the source supplied
the behavior, and the build was only as correct as the source reading
was direct. At the end, one Requirement is still unmet, one consumer
incompatibility is unresolved, and nothing has been checked by running
the new service against the old one. The framework-level issues fell
outside the record entirely, as they should: transaction propagation
across self-invocation, which technology is enlisted in a rollback,
identifier generation in unit tests, and feature-flag state.

Three practical implications follow. The first is about precision
rather than the metamodel. Where the record states an obligation but not
its physical or algorithmic realization, compliant implementations can
and will diverge. Neither the two-view structure (paper §3.2) nor the
Requirement/Guardrail layer (paper §3.6) yet distinguishes "must behave
the same" from "must be built the same way underneath."

The second is that, on real logic, errors enter from more directions
than "the record says too little":
- documents built on top of the record guess (the RPC mechanism);
- legacy conventions override the record's wording (the status set);
- the record itself collapses a conditional rule into a flat one (the
  grace period);
- intermediary summaries of the source lose branch structure.

The last two are the same failure: prose summarizing branching control
flow drops exactly the conditions that matter. That matters most for
Contour's aim of being a spec an LLM can act on, because a record's
`behavior` and Requirement text are written at exactly that level of
prose. Record-derived tests inherit the record's precision and cannot
exceed it.

The third is about what can be fixed, and where. Failure policy per
dependency, compatibility with consumers that already exist, and current
versus target look closable with record conventions (Roadmap item 7).
Conditional and compensating logic is a question for the metamodel,
because `steps` cannot express it (paper §6). Domain computation rules
that the record's author never had are a limit on any record written
from source.

---

## 5. Roadmap

1. **Repeat the change-propagation test beyond one codebase.**
   Experiment 2 showed it working on a small, self-describing system.
   The next runs should use a codebase that is not itself a Contour
   implementation, with a non-developer writing the change description,
   and check that every referenced Requirement and Guardrail (paper
   §3.6) was honored.
2. **Repeat the build-from-spec test at larger scope.** Experiment 1's
   two independent implementations from one record cover a small
   metamodel engine. The open question is where the record's precision
   runs out as the Component grows — and whether the divergences
   Section 3 found (physical schema, payload shape, transport) can be
   closed by record fields alone. Experiment 3 took this to a roughly
   2,900-line legacy subsystem with one build, checked statically
   against the legacy source. Still missing: a second, independent
   build from the same record, and a behavioral comparison that runs
   the new service and the legacy component on the same inputs. The six
   defects Experiment 3 found by reading the source would make a
   natural first test set.
3. **Round-trip test full reconstruction of an existing system —
   optional, secondary.** Have an LLM produce a Contour record from a
   real system's source; then regenerate the code from *only* that
   record and compare the regenerated behavior against the original.
   Worth trying because the model happens to support it, but not a
   precondition for anything else here.
4. **Prototype the composed System landscape.** A System has a notation
   (paper §4) but no *composed* view: several Component diagrams
   assembled into one landscape of the System they belong to, without
   violating the one-page constraint at the individual level. That view
   is what would show whether a System needs properties beyond a name
   and a description — ownership, a lifecycle of its own, cross-Component
   requirements — or whether grouping is all it ever needs to be.
5. **Render the diagram tier from the serialization.** A YAML
   serialization of the seven elements and the record fields now exists
   (Section 1); rendering the diagrams from it automatically, rather than
   drawing them by hand, is the missing half.
6. **Apply Contour to a real legacy system** with little or no existing
   documentation, to see where the element vocabulary or the record-level
   detail strains against undocumented complexity — including cases
   where a "legacy system" turns out, once modeled, to be several
   Components already. Experiment 3 is a first run. It found the strain
   in current-versus-target state, failure policy, consumed contracts,
   and conditional behavior rather than in the element vocabulary. Its
   sharpest open question is authoring. A record written from
   undocumented source is a paraphrase of it, and Experiment 3's
   record dropped a dependency and flattened a time-dependent rule, the
   same two ways a sub-agent's summary failed. How a record is verified
   against source before it is trusted as a spec, and at what cost, is
   untested. So is the several-Components case.
7. **Trial record conventions for the gaps Experiment 3 found**, before
   any becomes a metamodel change (paper principle 2). Candidates: a
   failure policy stated as a Requirement or Guardrail on each Function
   that `uses` another Component; a Guardrail binding an Event's or
   Interface's `schema` to an existing consumed contract; a
   current/target marker on a record, and on its `depends-on` edges, for
   extraction work; and, for every Function with a failure or override
   path, a named Requirement stating that path's conditions explicitly
   rather than leaving them to `behavior` prose. Each should be judged
   by whether a second, independent build from the same record stops
   diverging on that point.

---

## Changelog

- **2026-09-25** — Document created by splitting the experiment results
  (formerly paper §8) and next steps (formerly paper §7) out of
  `contour.md` v0.24 into this companion, unchanged in substance; added
  the claims-status table and head matter. Covers Experiments 1–3,
  including Experiment 3's second, source-verified pass.
