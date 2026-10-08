> This is a sanitized version of an internal experiment log, prepared for external
> sharing. Company name, product/brand names, internal service names, repository paths,
> ticket identifiers, and system identifiers have been generalized or removed. The
> methodology, reasoning, and findings are preserved as closely as possible to the
> original.

# Contour Experiment — guiding a decomposition (change propagation) on a real legacy monolith

This is a log for a Contour experiment distinct in kind from the three already recorded
in [`contour-experiments.md`](contour-experiments.md). Experiments 1 and 3 tested
**build from spec** (create a new Component from a record); Experiment 2 tested **change
propagation** on a small self-describing codebase. This experiment tests **change
propagation on a real, undocumented legacy monolith** — specifically, using an existing
Contour record of a legacy Component as the boundary and guardrail for a *behavior-
preserving decomposition* of that Component, carried out directly in the legacy source.

It bears on the paper's Roadmap item 1 (repeat change propagation beyond one codebase,
on a system that is not itself a Contour implementation) and item 6 (apply Contour to a
real legacy system). The question under test: **is a Contour record enough to guide a
described structural change — "split this Component along its two roles" — into real
legacy code correctly, and do its Requirements and Guardrails hold as enforceable
boundaries during that change?**

## Subject

A roughly 3,400-line stateful session bean inside an older enterprise application-server
monolith at a real company — the "program distribution" component of a sports-betting
back office. It plays two roles through one class and one remote contract: an
**export/producer** role (builds a data-export container that downstream holders pull)
and an **import/consumer** role (receives such a container and writes the corresponding
local entities). The two roles are entangled through shared process-wide state and a
shared remote interface. A Contour record of this Component already existed from prior
modeling work, including its Guardrails.

## Sources of truth, in priority order

1. **Contour record** — the existing Component record: its Functions, Data Objects,
   Events, the `depends-on` map, and — most load-bearing here — its **Guardrails**
   (notably a "program-distribution is reached only through the declared seam" boundary).
   This was the **boundary the change had to stay inside**, not a spec to build from.
2. **The legacy source itself** — authoritative for all behavior. Unlike a build-from-
   spec run, the change was made *in* this source, so the source was continuously read,
   not reconstructed.
3. **A structural map** produced on demand (per-method role classification, field-usage
   partition, lifecycle wiring) to plan the carve. This is derived from the source, not
   from the record.
4. **The technology radar / EA repository** — consulted before adopting any new library,
   per company policy, to keep the change on approved technology.

## What Contour was used for, concretely

- The decomposition target was expressed entirely in Contour's vocabulary *before* any
  code moved: one Component splitting into two, mediated by the existing data-container
  contract (an Interface/Event seam). The record's role partition (producer vs. consumer)
  is what made the target "two beans behind a preserved contract" rather than an
  arbitrary file split.
- A Guardrail was made **executable**: the "reached only through the declared seam"
  boundary was implemented as a structural test (an architecture-rule unit test) that
  fails the build if any new code reaches into the provider-unique packages from outside
  an allow-list. This is paper §3.6's "a failed check is a failed test" applied to a
  Guardrail, and §3.6's claim that Guardrails are enforced rather than declarative.
- The record's boundary discipline ("existing consumers are a constraint"; principle 4,
  data has a home) drove the decision to **preserve the remote contract unchanged** and
  delegate the few remote import methods to the new consumer Component, rather than split
  the external interface.

## What proves the approach (this run)

- **The record's boundary correctly scoped a large structural change.** The split landed
  as: export role stays on the original bean (renamed contract kept), import role moves
  to a new Component behind a new local interface, remote contract preserved with
  delegation. Every one of those decisions traces to something the record already
  asserted — the two roles, the shared contract, the external consumers. The change was
  large (~1,750 lines relocated, ~15 methods, two new interfaces, caller repoints across
  five modules) and the record kept it from drifting outside the declared boundary.
- **An executable Guardrail caught boundary erosion during the change, as intended.** The
  new consumer Component, once created, crossed into the provider-unique packages exactly
  as the original did. The seam test failed on the new class and forced a *deliberate,
  reviewed* widening of the allow-list rather than a silent boundary expansion — precisely
  the drift §3.6 says a Guardrail should prevent.
- **The two-role reading exposed cross-role state the code did not advertise.** Reading
  the Component through its record (two roles crossing one boundary) surfaced two pieces
  of genuinely shared process-wide state — a "sync in progress" flag and an event-listener
  registry — that a naive file split would have duplicated, silently breaking a gate and
  a notification path. Both were extracted into shared holders *before* the split, as
  behavior-neutral steps. This is the clearest win: the record's boundary thinking found a
  correctness hazard that was invisible at the level of the source.
- **Change propagation was record-first and boundary-first without prompting.** The
  working order was: read the record and its Guardrails, express the target in Contour
  terms, write a characterization safety net, extract shared state, then carve — the
  record bounding each step. Consistent with paper principles 6 and 8.
- **Radar/EA governance composed cleanly with the change.** Adopting the architecture-
  rule test library was checked against the company's technology radar first (it was not
  yet an approved standard; a governance ticket was raised and the entry registered).
  Contour said nothing about this and shouldn't; the point is only that the record-guided
  change slotted into existing governance without friction.

## What challenges the approach (this run)

- **The record guides structure; it cannot verify behavior preservation.** This is the
  same structure-vs-behavior split Experiment 3 found, seen from the change-propagation
  side. The record told me *where* the seam was and *what* must stay inside it. It said
  nothing that could confirm the moved code still *behaves* identically. That guarantee
  had to come entirely from characterization tests written against the source and from
  the fact that method bodies were relocated verbatim. A record is not a behavior-
  preservation oracle, and for a legacy carve that oracle is the expensive part.
- **Conditional behavior lived in prose and tests, not in the record.** The import path's
  load-bearing branches — a staleness/skip guard, a provider-mismatch rejection, a
  create-vs-update split, per-item rollback isolation — are exactly the branching control
  flow the paper's `steps` cannot express (§6). They had to be pinned with characterization
  tests before the move, because the record could neither state them precisely nor prove
  they survived. This is another data point for the paper's live question of whether
  `steps` should gain conditional structure or push branches into named Requirements.
- **"Behavior-preserving" had no record-level expression.** The entire change was governed
  by an obligation the record has no vocabulary for: *this change must not alter runtime
  behavior at all.* That is neither a Requirement (a positive obligation to achieve
  something) nor a Guardrail (a boundary on implementation) as §3.6 defines them — it is a
  property of the *change*, not of the element. Contour records elements, not change
  contracts. For change-propagation work this is a gap: the single most important
  constraint on the task was un-modelable.
- **Current-vs-target ambiguity, again.** As in Experiment 3, the record described a
  boundary the code did not yet physically have (two Components), while the source still
  had one class. Which parts of the record were "as-is" and which "to-be" had to be held
  in my head and in a design document, not in the record. This is the same §6 gap
  (no current/target distinction) that legacy work keeps hitting.
- **The record's cross-role state was implied, not marked.** The two shared statics the
  split hinged on were discoverable *by reasoning in Contour terms*, but the record itself
  did not flag them as cross-role or as a decomposition hazard. The reasoning ("state read
  by one role and written by the other cannot be duplicated") is Contour-shaped, but the
  record carried no explicit marker; a less careful execution could have missed it. A
  candidate convention: a Guardrail on shared state that names it as single-owner across a
  prospective split.
- **Verification of behavior preservation was unit-level only.** As with Experiment 3, the
  result was checked statically (compiles across the whole build) and by the affected unit/
  characterization tests, never by running the decomposed system against the original on the
  same inputs. The relevant integration test's availability in the target environment was
  unknown, so the characterization net was the only behavioral safety available — which is
  why it was made mandatory. The claim this run supports is therefore "the record guided a
  behavior-preserving *structure*," not "the behavior was proven preserved."

## Net read (for this experiment)

Consistent with the companion document's pattern: **the record was sufficient for the
structure and boundary of a described change, and silent on its behavior.** What is new
here, relative to Experiments 1–3:

1. It is the first change-propagation run on a real legacy monolith (Roadmap item 1
   taken to the setting of item 6), and the first time a Contour **Guardrail was the
   primary driver** of a change rather than a check applied afterward. The executable
   seam Guardrail did real work: it caught boundary erosion mid-change and forced an
   explicit decision.

2. It surfaces a genuinely new gap the build-from-spec experiments could not: **a
   behavior-preserving change has no home in the record.** The dominant constraint on a
   refactor/decomposition — "change the shape, not the behavior" — is a property of the
   change, and Contour models elements. Requirements and Guardrails (§3.6) are the closest
   fit and are the wrong shape for it. Whether change propagation wants a lightweight
   "change contract" notion, or whether this stays outside the model as the developer's
   own discipline, is an open question the paper does not currently raise.

3. It reinforces two existing §6 limitations with independent evidence: conditional
   control flow that `steps` cannot hold (the import branches), and the absence of a
   current/target distinction (a record describing a two-Component boundary over
   one-Component code).

The practical implication matches the companion's third point: what can be fixed with
record conventions (a current/target marker, a shared-state-ownership Guardrail) is worth
trialing; what is intrinsic (the record cannot prove behavior preservation) is a boundary
on what change propagation can claim, and argues that a characterization test suite is a
required companion to the record for any behavior-preserving change on legacy code, the
same way `schema` pointing at a real spec is required for a legacy build.

## Suggested roadmap touch-ups (for the maintainer)

- Roadmap item 1 (repeat change propagation beyond one codebase) now has a first real-
  legacy data point; consider recording that it held for *structural* change under a
  Guardrail, and that behavior preservation rested on a characterization suite the record
  did not provide.
- Roadmap item 7 (trial record conventions for Experiment 3's gaps) could add two
  candidates from this run: (a) a marker distinguishing behavior-preserving change from
  behavior-changing work — or an explicit statement that this is out of scope for the
  model and belongs to the developer/test suite; (b) a Guardrail form that marks a piece
  of state as single-owner across a prospective decomposition, so cross-role shared state
  is flagged in the record rather than rediscovered by reasoning.
