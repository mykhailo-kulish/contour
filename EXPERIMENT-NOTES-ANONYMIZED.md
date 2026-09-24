# Experiment Notes — Contour Applied to a Real Legacy System (Anonymized)

> This is a sanitized version of an internal experiment log, prepared for external
> sharing. Company name, product/brand names, internal service names, repository paths,
> and system identifiers have been generalized or removed. The methodology, reasoning,
> and findings are preserved as closely as possible to the original.

This is a live log for a Contour experiment (see the Contour framework paper, §7 item 6:
"Apply Contour to a real legacy system"). The question under test: **is a Contour record,
plus the legacy source it was built from, sufficient to correctly build a new standalone
Component from scratch?**

This complements the paper's Section 8 experiments (which used a small, self-describing
reference codebase) with a real, large, undocumented legacy subsystem inside a production
monolith at a real company: a service responsible for the end-to-end lifecycle of a
transactional "order" record — submission, cancellation, settlement, and an early-exit
valuation path — implemented as a single large stateful component (roughly 2,900 lines)
inside an older enterprise application server-based monolith.

## Sources of truth, in priority order

1. **Contour record** — a Component record describing this subsystem's target shape
   (Functions, Data Objects, Events, Requirements, Guardrails, and a `depends-on` map
   classifying each neighboring system as already-decomposed / hybrid / still-in-monolith
   / not-actually-a-dependency). This is the **spec**.
2. **A companion extraction plan document** — the "how": target technology stack, API
   resource mapping, per-dependency integration mechanism, preparatory findings, module
   layout. This is *derived from* the Contour record plus additional source drill-downs;
   it fills in physical/mechanism detail Contour deliberately leaves out (design
   principle 3 — Contour records logical relations, not communication mechanisms).
3. **A line-referenced mechanical deep-dive document** into the legacy component's two
   core methods (SQL statements, wire protocol shape, booking aggregation logic, feature
   flags, in-memory state) — used to sanity-check the record and plan, and to fill in
   wire/SQL-level detail neither carries.
4. **Real schemas** (from an internal schema registry, and the live legacy source) — per
   explicit permission from the person running the experiment, real API specs, JSON
   schemas, and SQL DDL were used where they existed, rather than only inferring shape
   from the record. Used for physical realization detail (DTO field shapes, event
   payloads) that Contour's `schema` field would otherwise point at as an external spec
   link rather than restate.

Per Contour's own design principle 3 and the plan's dependency table, every `depends-on`
Component was treated as an **opaque boundary** — a real client interface was built, sized
to the real contract where one existed in the schema registry, without needing to run or
fully replicate the neighboring service itself.

## Divergence / underspecification log

Findings are logged here as they were hit, in the spirit of Contour §8.2 ("What
challenges the approach"). Each entry: what the record/plan left open, what filled the
gap, and which tier (record vs. plan vs. legacy source vs. real schema) resolved it.

### 1. Contour record vs. real external schema — Data Object under-specification (confirms §8.2 pattern)

The Contour record's two core Data Objects (the "order" record and its line items) carry
only a plain-language description each (fields named in prose: status, a voucher code,
amount, price, channel/location, transaction id...). A real external JSON
Schema for the equivalent wire representation — found in the company's internal schema
registry — was far richer: money fields used a fixed minor-unit (cents) convention,
there was a structured validation-failure taxonomy (~20 error codes across ~9
categories), a unified "incentives" array covering several distinct promotional
mechanisms that the record described only loosely as "any applicable bonus," a few
product-line-specific fields for a named product variant, and an explicit
"detailed status" field superseding a deprecated simple status field.

This is exactly the gap Contour's paper predicts (§6, §8.2): "the record specifies
logical content, not physical shape." The record correctly identifies *that* this Data
Object owns status/stake/redemption-code/etc.; it does not, and by design does not, pin
down the exact wire shape. Resolution: use the real external schema as the authoritative
DTO shape for the new service's API and events, since Contour's `schema` field is
explicitly meant to point at an existing spec rather than restate it (§3.3).

### 2. A downstream validation dependency's transport — record says "uses an Interface," the derived plan guessed one mechanism, the real mechanism was different

The Contour record only records that the "submit" Function uses an Interface exposed by
a validation-service Component (mechanism-agnostic, per principle 3). A companion
extraction-plan document's dependency table assumed a synchronous REST call for this
integration. A line-referenced read of the actual legacy source showed the real
transport was a binary RPC protocol with a schema-defined request/response contract —
not REST. Resolution: build the client using the real mechanism found in source, not the
mechanism guessed by the plan. This is evidence for Contour's own claim that mechanism
belongs in the record's `schema`/Interface tier, not the Component-level `depends-on`
edge — and evidence that a design document derived from the record, without checking
source, can get the mechanism wrong even when the logical edge itself is correctly
identified.

### 3. Status-enum scope — a real external schema is a superset of the record's own owned lifecycle

A real external status enum (from the schema registry) listed roughly 19 values,
including several (a "pending" state, an "open" state, a "closed" state, a "voided"
state) that do not appear in the legacy source's own status
constants or in any Contour Function's documented steps as a status this Component
itself assigns. Decision: model the new service's status enum scoped to exactly what the
Contour record's Functions transition *into* (verified against the legacy source), not
the full external superset. Rationale: Contour design principle 4 ("data has a home") —
this Component owns the record and is the sole writer of its status; the extra external
values look like they belong to a downstream reporting/feed projection's own broader
union type, not to this Component's own state machine. This is a judgment call the
record doesn't make on its own — flagged as exactly the kind of choice Contour leaves to
the builder rather than the spec.

### 4. A pricing/valuation dependency — no standalone real contract found in the schema registry

Searched the internal schema registry for a standalone contract covering the early-exit
valuation pricing dependency; none existed as its own spec (only downstream consumer
shapes referenced valuation fields loosely, embedded inside adjacent schemas). Per
Contour principle 6 (the record holds the truth when a design document and a spec
disagree — extended here to "when no external spec exists at all"), the client boundary
interface for this dependency was built entirely from the Contour record's documented
steps, Requirement (an anonymous-customer gating rule on one channel), and Guardrail
(the valuation call must never move money or change status) — no real-schema fallback
was available. This is a case where "real schemas are acceptable" (per the experiment's
explicit permission) had nothing real to fall back to, so the record was the sole spec —
a genuine test of the build-from-record claim rather than a build-from-real-schema
exercise.

### 5. An anonymous-customer gating rule — legacy feature flag not carried forward

The Contour record's Requirement gating a valuation feature for anonymous customers on
one channel states the *rule* ("gated behind a feature flag") but the flag's current
on/off state is a monolith runtime config value, not part of the record. Per the plan's
own guidance ("extract only the target path; drop dead legacy branches"), and absent any
instruction to query live production feature-flag config for this experiment, a
conservative fixed behavior was chosen (one channel always gates anonymous customers;
others never do) rather than modeling a runtime-configurable flag with no config source
in the new service. This is a case where the record names a Requirement whose exact
enforcement depends on config state Contour intentionally doesn't model (an
infrastructure/deployment concern, explicitly out of scope per §6) — flagged as expected
Contour-scope behavior, not a gap.

### 6. A money-movement dependency — a companion plan's "gated migration" framing doesn't apply to a from-scratch build

The companion plan is emphatic that migrating one leg of money movement (the
customer-funds leg) to an already-extracted downstream service is a *deliberate,
separately-gated cutover*, "not an automatic re-point of the existing in-process call" —
because the plan is written for the scenario where the legacy monolith is being
strangled incrementally and something is already running in production. This build is a
from-scratch new service with no production traffic yet, so there is no "existing
in-process call" to gate away from — the plan's own caution is about protecting a live
cutover, and a brand-new Component has nothing live to protect. Decision: the
money-movement client interface targets the already-extracted downstream service
directly, since building the legacy in-process-equivalent path first and migrating later
would be manufacturing exactly the coupling this whole extraction exists to remove.
Flagged as a plan-interpretation judgment call, not a record ambiguity — the Contour
record's own `depends-on` edge to the accounting/wallet Component doesn't distinguish
today-vs-planned integration at all (that distinction lives entirely in the companion
plan, one tier below the record).

### 7. Primary key type mismatch — new UUID-based key vs. real schemas' integer-typed identifier

A real external event schema typed the order identifier as an integer (matching the
legacy numeric primary-key generation scheme), and the main external order schema typed
its own "uuid"-named field as a numeric string with an explicit note that the field is
misnamed — it is not actually a UUID, just a legacy numeric id under a confusing name.
This service uses a genuine UUID-typed primary key for its core record (a deliberate
target-architecture choice — no legacy sequence-table contention, no cross-service
numeric-id collisions), which does not fit into an integer-typed field. The event
publisher for one downstream event uses a placeholder numeric projection derived from
the UUID's bit pattern — a real adaptation gap between "the target service's chosen
physical id strategy" and "an existing consumer's real wire schema" that neither the
Contour record nor the plan resolves (both are silent on primary key *type*, only on
ownership). Flagged as unresolved: if this event has a real external consumer expecting
a legacy-compatible integer id, the placeholder is wrong and needs a real id-mapping
strategy — a decision for whoever owns the downstream consumer, not something inferable
from the record alone.

### 8. A "cannot be filed as pending" rule enforced structurally, not by an explicit guard clause

One Contour Requirement states that a particular category of time-sensitive submission
can never be filed merely as a pending request — it must resolve immediately, either
accepted or rejected. This is enforced in the new service by control flow, not a
dedicated guard-clause exception: the code branch that files a submission as "pending"
is only reachable for the non-time-sensitive category in the first place. This satisfies
the Requirement (the time-sensitive category cannot reach the pending-transition branch
at all) but means there is no single line of code that "is" the Requirement — a reviewer
checking Requirement-compliance has to read the branch structure, not grep for an
exception class. Noted because Contour's own §3.6 says Requirements should be checked "by
a test asserting the rule directly" — a direct behavioral test (assert the time-sensitive
category never produces a "pending" outcome) is the right verification method here,
precisely because there's no dedicated guard to unit-test in isolation.

### 9. Recursive cancellation — a framework self-invocation limitation is implementation detail, not a Contour concern

The Contour record's cancellation Function's steps list a plain, unordered "calls itself
recursively, for each dependent order." Implementing that recursion correctly inside one
transaction ran into a real framework-specific pitfall in the chosen web framework
(self-invocation bypasses the transactional-proxy mechanism, so a naive recursive public
method wouldn't reliably get new-transaction semantics per recursive call in all cases).
This is squarely "physical realization," exactly the tier Contour declines to model
(§3.3: a Function's documented steps record logical calls, not framework mechanics) —
correctly resolved with ordinary framework knowledge, not something the record could or
should have flagged.

### 10. Fail-open vs. fail-closed on integration client errors — record is silent

Several integration clients need a decision for "what happens if the downstream call
itself fails" (timeout, server error, network partition) — distinct from "what happens
if the downstream call succeeds and says no." Neither the Contour record nor the
companion plan states this per-dependency; the mechanical deep-dive document notes one
dependency uses "a bounded thread pool" but doesn't document its failure-mode semantics
either. Decision made here: a secondary compliance-cooldown check fails open (an outage
doesn't block the primary flow) since it's a soft check layered on top of the primary
validation gate, whereas the primary validation dependency and a risk-reservation
dependency are treated as fail-closed (a client exception propagates and aborts the
flow) since they are named Requirements/Guardrails the Contour record treats as hard
gates. This per-dependency fail-open/closed policy is exactly the kind of cross-cutting
decision the record doesn't carry — logged here rather than buried silently in each
client's error handling.

### 11. A consumed settlement event — real schema's operational-metadata field dropped as out-of-scope

A real external event schema for settlement notifications (found in the schema registry)
includes a metadata object purely for internal KPI/processing-time-log purposes. The
corresponding internal event type in this build omits it deliberately — it's
observability plumbing for the *producing* side's own pipeline, not something this
Component's settlement-handling behavior (per the Contour record) reads or acts on.
Consistent with Contour principle 2 (fixed, minimal vocabulary) applied to a payload:
model exactly what the consuming Function needs, not the full producer wire shape, while
still keeping field names aligned with the real schema for the fields actually used.

### 12. A named Requirement pointing at a real downstream call that was not wired

The settlement-handling Function's Contour record behavior includes updating a
customer's aggregate risk/exposure figures if the settlement amount actually changed. A
real external API spec (found in the schema registry) has an exact real endpoint for
this, with a well-defined request body shape (a delta object keyed by a small set of
named attributes). This was *not* wired into the corresponding service in this build —
logged as deferred rather than implemented, because the relevant client interface
doesn't yet expose a matching method, and adding one without also deciding which
attribute(s) map to a settlement's transaction delta would be inventing product-level
behavior (which attribute increments on a win vs. a loss vs. a refund) that neither the
Contour record nor the plan specifies precisely enough to implement confidently. Flagged
as a genuine open gap in this build, not a silent omission — the real API contract
exists and is known; the domain mapping from "this settlement happened with this delta"
to "which attributes change by how much" is the missing piece, and that mapping lives in
business knowledge the Contour record doesn't carry (it names the *obligation* — "update
these figures" — not the mapping rule). This is a clean example of Contour correctly
identifying a Requirement while leaving its exact computation to domain expertise the
record-writer evidently didn't have or state.

### 13. An own-transaction failure-recording Guardrail — one write needed a dedicated bean, another needed no special handling

Two related but distinct physical-realization decisions, neither named by the record:
(a) a durable failure-record write needed genuine "run in a new, independent transaction"
propagation, which in the chosen framework only reliably applies through the framework's
own proxy mechanism — hence a dedicated bean/component specifically for that write rather
than a same-class self-call (mirrors finding #9's self-invocation lesson); (b) an
associated event-bus publish sitting in the same failure-handling code path needed no
special transactional handling to survive the caller's rollback, because the event
publishing mechanism used here is not enlisted in the database transaction by default —
it fires independently of whether the surrounding transactional method commits or rolls
back. This is a case where the *same Guardrail* ("must run independently of the caller's
rollback") has two different correct implementations depending on which underlying
technology carries the write — worth noting because a less careful implementation might
have wrapped the event publish in unnecessary extra-transaction handling out of caution
(harmless but unnecessary), or might have missed that the database write needed it and
the event publish didn't (a real bug, but only for the database write).

### 14. Testability gap surfaced by unit testing — a database-generated identifier unusable in pure unit tests

Writing behavioral tests for the Requirements (per Contour §3.6's own prescription)
surfaced a concrete implementation gap the record obviously wouldn't flag: the core
entity's identifier is database-generated, so a bare, newly-constructed instance in a
mock-based unit test (no real persistence context) has a null identifier, which silently
degrades any test that needs to assert identity-based behavior (a lock acquired for
*this specific* record's id, an event published *about* this record) into something
weaker. A narrowly-scoped test-support helper was added to assign a stable identifier in
unit tests without opening up identifier-mutability in production code paths. This is
ordinary unit-testing hygiene, not something either the Contour record or the plan could
have anticipated — but it's a good illustration of Contour's own point (§8.2) that the
record's logical content ("this Data Object owns a status/amount/etc.") doesn't
determine implementation-level testability concerns like primary-key generation strategy
interacting with unit-test isolation.

### 15. Real bug caught by behavioral testing — a status-classification conflict between two Requirements' precise wording

A unit test written specifically to verify the Contour record's own documented behavior
for the settlement-commit Function ("any other starting status is left unchanged by this
step") failed against the first implementation attempt, which reused a single shared
"terminal status" set — mirroring a legacy source-code array grouping several statuses
together as final — as the guard for a *different* Requirement ("cannot re-settle a
record already in a final state"). But the record's own text spells out that second
Requirement's scope explicitly and more narrowly: only four specific named statuses
cannot be settled again. One status that the legacy source's own array groups with the
"final" statuses elsewhere is *not* in that narrower list. This is a genuine internal
tension in the source material: the legacy code groups that one status with the
truly-final statuses for some purposes (a different Function's Requirement — "cannot
cancel an already-evaluated or paid-out record" — correctly treats it as final, since its
outcome has already been evaluated), but the settlement-commit Function's specific
Requirement wording pointedly excludes it, matching that Function's own behavior prose
("any other starting status is left unchanged... a caller is expected to have completed
the preceding staging step first" — this status is a valid entry point for a
booking-only commit, e.g. crediting a consolation/void amount, not a "this is already
settled" state).

This is exactly the kind of defect Contour's own §3.6 promises a Requirement-compliance
test will catch ("enforced, not declarative... a failed check isn't a documentation gap;
it's a failed test") — and it did, on the first implementation attempt, before any manual
review caught it. The fix was to give the settlement-commit Function its own
precisely-scoped exclusion set rather than reusing the general-purpose "terminal status"
set, which stays correct for the other Function's different Requirement. This is a
strong point in favor of the paper's central claim: writing the test *from the record's
stated Requirement text*, not from the implementation, is what caught a real behavioral
bug that would otherwise have silently rejected a legitimate consolation transaction.

### 16. Correction — two reference-entity identifiers were wrongly typed as UUID; the real schema says integer

A post-hoc review against the real external order schema caught a modeling error in the
initial domain entity: the channel identifier and the till/terminal identifier (and their
transaction-side counterparts) had been typed as UUID, by analogy with the customer
identifier. The real schema is explicit that the channel and till/terminal identifiers
are both integer-typed, while only the terminal-operator identifier (the operator/user
placing the order at that terminal) is genuinely UUID-typed. So these two reference
identifiers point at legacy numeric channel/till entities, not new UUID-keyed aggregates
— the same category of mismatch as finding #7 (primary-key type), but this time caught by
re-checking the schema rather than by a downstream consumer failure. Fixed by retyping
the relevant entity fields and propagating the change through the request DTO, two
application services, the schema migration, and the REST controller parameters; rebuilt
and reran the full test suite (all tests still passed after updating two tests that had
been passing a random UUID for these fields).

This reinforces findings #1 and #7: the record is silent on *any* identifier's physical
type (UUID vs. integer vs. something else) for fields it doesn't even name explicitly —
the record's core Data Object description doesn't call out "channel/till" as a
separately typed field at all, only as prose ("links to the customer... channel/till,
transaction id"). Both the initial mistake and its correction came entirely from checking
the real schema field-by-field rather than from anything in the Contour record or the
plan — a second, concrete data point (alongside finding #7) that "real schemas" and "the
record" are complementary checks, and that skipping a careful pass over the real schema
when one exists is where implementation errors slip in, not a failure of the record
itself.

### 17. Real bug caught by direct source comparison — a "forced" override flag was implemented as an unconditional widening instead of the legacy catch-and-substitute pattern

A second-pass comparison against the real legacy source (verified directly at specific
line numbers, not via a sub-agent's summary — see the methodology note below) found that
the first implementation of the cancellation Function's "forced" override modeled it
incorrectly: it unconditionally widened the allowed-starting-status set whenever the
override flag was set, and always re-ran a set of validity checks (evaluated / blocked /
already-paid-out) regardless of the flag. The real legacy structure is a narrower
try/catch-and-substitute: the narrow status check plus the validity checks run *first*,
unconditionally, regardless of the override; only if that whole block fails AND the
override flag is set does legacy swallow the failure and retry with a different, wider,
specific status set — critically, that retry does **not** re-run the validity checks at
all. The first implementation's widened status set was also itself wrong for this
purpose: it wrongly included one status that shouldn't be there and omitted two that
should.

Fixed by adding a distinct, purpose-specific status-set constant (kept separate from the
general-purpose payable-status set, which remains correct for its own, different,
callers) and rewriting the cancellation service to match the legacy structure exactly: a
helper that *returns* (rather than throws) a validation failure, called once before any
status check, with the narrow-vs-forced status set chosen only for the *initial* check and
the validity checks never re-run on the forced retry path. Added four regression tests
directly encoding this distinction (a forced cancel is rejected if the starting status
isn't in the forced-specific set even though it's otherwise payable; a forced cancel
bypasses the validity re-check; a forced cancel still respects the already-paid-out guard;
a non-forced cancel rejects an already-paid-out record).

This is a materially more serious bug than a schema mismatch: the wrong version would
have allowed cancelling records legacy would refuse, or refused to cancel ones legacy
would allow forced through, and the "always re-run" behavior could have double-run
compensating side effects (reversal booking, incentive rollback) that legacy runs exactly
once. It was only found by re-reading the real method body directly at specific line
numbers, after a sub-agent's earlier natural-language summary of the same method's
forced-override behavior had been imprecise enough to miss this distinction —
reinforcing that for behaviorally load-bearing control flow, a sub-agent's paraphrase is
not a substitute for reading the actual source.

### 18. Missing audit journal entry on cancellation — no equivalent existed at all

Legacy's cancellation method calls an audit-journal side effect on every successful
cancellation (behind a feature flag), recording who cancelled the record and from what
channel. No equivalent existed anywhere in the new service — this wasn't a wrong
implementation, it was a completely absent one, and the Contour record's cancellation
Function `steps` don't name a journal/audit-log side effect at all (the record's own
`depends-on` map has no edge to an audit-journal Component, matching the plan's explicit
note that this dependency was earmarked for event-decoupling rather than a synchronous
in-process call). Fixed by adding a cancellation-journal-entry event (record id,
reason/note, and a source enum mirroring legacy's caller-role classification, derived
from the caller's role in a new controller-layer helper method) rather than a synchronous
call, per the extraction plan's own stated preference for decoupling this particular
dependency. This is a case where the record's silence on a side effect was not "the
record correctly leaves this to a lower tier" (as with e.g. a framework self-invocation
detail elsewhere in this log) but a genuine gap: the record's own dependency map doesn't
list the audit-journal Component as a dependency of the cancellation Function at all, yet
the real legacy method unconditionally calls it. Flagging as a case where the record's
dependency map itself, not just its Function `steps`, needed a source-level correction.

### 19. The settlement-commit Function's final-state check was a bare status check, not the real timestamp-plus-grace-period logic

Direct verification of the real legacy final-state helper — after a sub-agent had
reported uncertainty about this method's real body — showed the real guard is
status-in-terminal-set (which does include the status this experiment's finding #15
discusses) **AND** a settlement timestamp already being set **AND** that timestamp plus a
grace period having already elapsed. The first implementation used a bare four-status
membership check (excluding the finding-#15 status, and with no timestamp/grace-period
dimension at all) as an oversimplified proxy. A record in a final status that has never
actually been settled (no settlement timestamp yet) is NOT blocked by real legacy; the
first implementation would have wrongly permitted or wrongly blocked several cases
depending on which final status was involved. Fixed via a dedicated final-state check plus
a new configurable grace-period setting (mirroring a legacy time-to-live helper). Regression
tests added: a record with no settlement timestamp is not blocked; one with a timestamp
older than the grace period is blocked; one within the grace period (a same-day
correction) is not blocked. This is the case where a sub-agent explicitly flagged its own
uncertainty rather than guessing — exactly the right sub-agent behavior — and independent
direct verification supplied the missing precision.

### 20. The approval-confirmation Function conflated two distinct time-window checks into one

Direct verification of the real legacy delivery-confirmation method found that legacy runs
two separate time-window checks that the first implementation had merged into a single
comparison measured from the approval timestamp: (1) a request-age check (a configurable
number of minutes, default 90) measured from the record's original delivery/request
timestamp, throwing if exceeded; (2) a distinct short quote-freeze window (a few minutes)
measured from the *approval* timestamp, which only gates whether market pricing gets
re-checked at all and is not the same exception path. Fixed the request-age check to
measure from the record's original delivery/request timestamp rather than its approval
timestamp against the 90-minute window; the existing quote-freeze-window logic elsewhere
in the same service was already correct on its own and was left alone. This also
surfaced a second, dependent bug: the delivery service was only setting the
delivery/request timestamp on one of its two filing paths, not the other, which would
have made the fixed approval-window check always throw for any record that started on the
other path — fixed by setting the timestamp on both paths. Two existing tests had to be
updated in lockstep, since they only set the approval timestamp and not the
delivery/request timestamp — a good illustration of how fixing a real bug against the
legacy source can break tests that were written against the (wrong) first implementation
rather than against the record's own Requirement text.

### 21. The approval-confirmation Function had no compensation/rollback path on failure at all

Legacy's delivery-confirmation method's catch block unconditionally rolls back a reserved
incentive/bonus offer and clears its approval-tracking state on failure, unless the call
is a dry-run or the failure is specifically a pricing-changed exception. The first
implementation had no catch block around the incentive-redeem-then-book sequence at all —
a failure partway through would leave a reserved incentive un-released and the approval
timestamp still set. Fixed by wrapping the sequence in try/catch: on failure, cancel the
incentive reservation (if one had been redeemed) and clear the approval timestamp,
skipping both for dry-run calls and for the pricing-changed exception. This is a
straightforward missing-behavior gap, not a misreading of the record — the Contour
record's approval-confirmation Function doesn't name a failure/compensation path
explicitly in its `steps` prose (which describes the happy path), and this was only
caught by direct legacy source comparison, not by anything inferable from the record
alone.

### 22. The settlement-transaction Function had an absolute-value bug and was missing the incentive-release category gate

Two related bugs in the same method, both found via direct comparison against the real
legacy transaction-settlement method: (a) the first implementation used a plain
greater-or-equal comparison against a positive minimum-transaction threshold, which misses
negative correction/clawback amounts (a transaction going *down* by more than the minimum
threshold should still trigger booking, but a plain comparison against a positive
threshold silently ignores negative deltas); legacy uses an absolute-value comparison
against the same threshold. Fixed to compare the absolute value. (b) the first
implementation released a reserved incentive offer on any payback-status record that had
an incentive reference at all; legacy gates this release on exactly three incentive
categories (two named bonus types and a boosted-pricing flag). Fixed by adding two new
boolean fields to the funds-tracking Data Object (alongside a pre-existing one for the
third category) and to the incentive-reservation client's result type, wiring them
through from both the delivery and approval-confirmation services' incentive-redemption
code, and gating the release with a category-eligibility check. Neither bug is something
the Contour record's prose ("if the transaction amount actually changed... releases any
applicable incentive reservation") could have prevented on its own — the record correctly
names both obligations; the *exact* numeric comparison and the *exact* category gate are
precision-level implementation detail that only the real legacy source (not the record,
and not a sub-agent's paraphrase of it) could supply correctly.

### Methodology note: sub-agent claims about legacy source must be independently re-verified

While reviewing findings #17-#22, a general lesson from this second comparison pass is
worth recording explicitly: several of the findings above (#17, #19, #20) originated from
a sub-agent's comparison report, but in more than one case the sub-agent's
natural-language summary of a legacy method's behavior was imprecise or, in one case
(#19), the sub-agent explicitly said it could not locate/verify a method body precisely.
Direct source reads (via shell commands piping real text-search/line-range extraction on
the actual legacy repository — outside this service's own workspace root, so the
workspace-scoped search/read tools could not reach it — into a temp file, then reading
that temp file) both confirmed the sub-agent's *direction* was usually right (something
was wrong; roughly the right method) and supplied the *precision* the sub-agent's
paraphrase lacked or got subtly wrong (exact status sets, exact field names, the exact
structural shape of the forced-cancel catch-and-substitute logic). The practical rule
this confirms: treat a sub-agent's description of legacy control flow as a lead to
verify, not as ground truth to implement against directly, especially for anything with
more than one conditional branch.

---

## Conclusion

**Claim under test:** a Contour record, together with the legacy source it was built
from, is sufficient to correctly build a new, standalone Component from scratch (Contour
§7 item 6, extending the build-from-spec claim of §8 Experiment 1 to a real, undocumented
legacy subsystem rather than a small self-describing reference codebase).

**Result: the claim held, with the same category of caveats the paper's own §8.2 predicts.**

A full microservice was built end to end on a modern application-framework stack — around
eight REST endpoints plus an event-consumer for one internalized Function, a relational
domain model with versioned schema migrations, eight integration client boundaries, a
distributed-cache-backed state layer for the concurrency/idempotency concerns the legacy
system had solved with single-process in-memory state, event production/consumption on a
message broker, framework-level role-based access control, and a mapped exception
hierarchy — directly from the Contour record's Functions/Data Objects/Events/
Requirements/Guardrails, using a companion extraction-plan document for
physical-realization choices the record deliberately leaves open (technology stack,
resource shape, per-dependency integration mechanism), the legacy source and a mechanical
deep-dive document to ground and correct the plan's own inferences, and real schemas from
an internal registry where they existed, per explicit permission. It compiled cleanly,
packaged cleanly, and roughly two dozen tests written directly from the record's own
Requirement text passed — including one that caught a real bug (finding #15) before any
manual review did.

**What proved the approach (mirrors Contour §8.1):**
- The record's Functions, Requirements, and Guardrails translated directly into working
  code and, more importantly, into *tests that catch real bugs* — finding #15 is the
  clearest evidence: a test written from the record's own Requirement wording failed
  against an implementation that had instead reused a broader, legacy-sourced status
  grouping, revealing that one status does not belong in this particular Requirement's
  scope even though it's grouped with the "final" statuses elsewhere in the same legacy
  source. The record's own words were more precise than the legacy code's own status
  grouping, and precise enough that a naive implementation visibly failed a direct test
  — exactly the outcome Contour §3.6 predicts for a properly enforced Requirement.
- The dependency map's already-decomposed/hybrid/in-monolith/not-a-dependency
  classification (richer than the paper's simpler reference-codebase record) was directly
  actionable: every "call directly" verdict became a real client interface, and every
  "moves into the Component" verdict became Component-internal logic rather than an
  external call, with no ambiguity about which was which.
- Guardrails shaped the code's structure, not just its behavior: a "booking logic stays
  in the booking helper" Guardrail produced a distinct booking-orchestration seam rather
  than inline balance math; a "must run independently of the caller's rollback" Guardrail
  produced a dedicated component specifically so the framework's new-transaction
  propagation would actually apply.

**What challenged the approach (mirrors Contour §8.2, extended with legacy-specific findings):**
- **Physical schema gaps, confirmed at real scale.** Finding #1 is the clearest case: the
  record's Data Object entries are prose-only; the real external schema is an order of
  magnitude richer (minor-unit money convention, a large structured validation-failure
  taxonomy, a unified incentive/promotion model, product-line-specific fields). This is
  the same gap Contour's Experiment 1 found on a toy schema, reproduced faithfully at
  real-system scale — and resolved the same way the paper prescribes: point the record's
  `schema` field at the real external spec rather than re-deriving it from prose.
- **Mechanism guesses can be wrong even when the logical edge is right (new finding, not
  in the original paper).** A companion plan document — itself derived from the Contour
  record — guessed a synchronous REST call for one dependency; the actual mechanism,
  confirmed only by reading real legacy source, was a different RPC protocol entirely.
  Contour's principle 3 (mechanism-agnostic relations) is exactly why the record didn't
  carry this detail — but it also means a design document one layer above the record can
  silently get the mechanism wrong without the record itself being at fault. This
  suggests a real practice requirement for legacy-extraction work: mechanism claims made
  *about* a Contour record's edges still need source verification, even when the record
  itself is trusted.
- **Internal tension between a Requirement's precise wording and the legacy source's own
  groupings (new finding).** Finding #15 (detailed above) is subtler than a
  record/schema gap: the record is *internally* precise but a naive implementer
  (including the person running this experiment, on the first pass) can still reach for a
  broader legacy-sourced convenience grouping instead of the Requirement's own narrower,
  explicitly-stated list. The record was right; the first draft wasn't; the
  record-derived test caught it.
- **Primary-key and identity strategy is unaddressed by both record and plan (new
  finding).** Finding #7: choosing a modern surrogate-key strategy (a legitimate,
  arguably better target choice) breaks a real downstream event schema that expects a
  legacy-compatible numeric identifier. Neither Contour nor the plan discusses identity
  strategy at all — it's a layer beneath what either claims to specify, and the mismatch
  only surfaces when a real external consumer schema is checked, reinforcing that "real
  schemas" and "the record" are complementary checks, not substitutes for each other.
- **Some named Requirements point at real downstream systems the record doesn't fully
  wire (new finding).** Finding #12: an obligation to update aggregate customer
  risk/exposure figures is a genuine Requirement with a real, discoverable target
  endpoint — but the *mapping* from a settlement's transaction delta to that endpoint's
  specific attribute deltas is domain knowledge neither the record nor the plan states
  precisely enough to implement with confidence. This is Contour correctly naming an
  obligation while leaving its exact computation to domain expertise the record-writer
  evidently didn't have or record — arguably the right call (per Contour's own guidance
  not to over-specify), but it means "record + legacy source" was *not* sufficient here
  without a human filling the domain-knowledge gap.

**Net read for this experiment:** on a real, ~2,900-line, undocumented legacy component
with a mature multi-tier extraction plan already written against it, a Contour record
plus its legacy source (and, per explicit permission, real external schemas where they
existed) was sufficient to build a substantially complete, compiling, tested new
Component — matching Contour's own §8.3 conclusion that the metamodel holds at the level
of core behavior, with divergences concentrated exactly where Contour says they'll be:
physical schema, mechanism choice, and identity/infrastructure strategy. The one
qualitatively new finding beyond the original paper is that *precision failures aren't
only "the record says too little"* — on a real legacy system, they also show up as "a
design document built on top of the record guessed wrong" (finding #2) and "the record is
right but a legacy-sourced shortcut is wrong" (finding #15), both of which a from-record
test caught. That is a positive result for the record-first workflow, not a negative
one: the record was the thing that was right.

## Update after a second, deeper verification pass (findings #16-#22)

A second comparison round — this time doing a systematic line-by-line pass over the real
legacy source rather than relying solely on the first pass's sub-agent summary, and
independently re-verifying every sub-agent claim by reading the actual method bodies at
cited line numbers — surfaced **six additional real behavioral bugs** (findings #17-#22)
plus one real schema-typing correction (finding #16) that the original
record-plus-legacy-source build had gotten wrong or omitted entirely: the "forced"
override flag's catch-and-substitute structure (#17), a completely missing audit-journal
side effect (#18), the settlement-commit final-state check's missing
timestamp-plus-grace-period dimension (#19), two conflated approval-window time checks
(#20), a missing failure-compensation path (#21), and an absolute-value/incentive-category
gate bug in settlement transaction (#22).

This materially changes the balance of evidence from the original conclusion above. The
first build pass, using the Contour record plus a single sub-agent-assisted comparison
pass against the legacy source, missed six real bugs that a second, more rigorous,
directly-source-verified pass caught. Two things are true at once, and both matter for
the paper's claim:

1. **The record itself was not the source of any of these six bugs.** In every case, the
   Contour record's Function `steps`/Requirements/Guardrails either said nothing about
   the specific mechanism that was wrong (findings #17, #19, #20's exact time-window
   arithmetic, #21, #22's exact numeric comparison) or — in one case (#18) — the record's
   own `depends-on` map was silent about a dependency the real legacy method
   unconditionally exercises. None of the six bugs came from the record asserting
   something false; they came from gaps the record leaves open (correctly, per its own
   scope) that the first build pass filled with a plausible-looking but wrong guess
   instead of a source-verified one.
2. **"Record + legacy source" was sufficient in principle, but not sufficient in the
   first pass's actual execution.** The legacy source contains everything needed to get
   all six right — every fix in this update cites specific real line numbers that were
   available from the start. The gap was in *verification rigor*, not in what the legacy
   source exposed: the first pass trusted a sub-agent's natural-language paraphrase of
   control flow with more than one conditional branch (findings #17, #20, and part of
   #19) rather than reading the cited method bodies directly, and in at least one case
   (#19) the sub-agent explicitly flagged its own uncertainty and that flag was not
   followed up on with a direct read before this second pass. This is a process finding
   about how the record-plus-source method needs to be *executed* (independently
   re-verify any sub-agent's control-flow claims against actual source, especially for
   anything with branching logic or more than one caller-visible condition), not a
   finding that the record or the source were themselves insufficient.

Net effect on the original claim: the claim ("a Contour record, together with the legacy
source it was built from, is sufficient to correctly build a new Component from scratch")
still holds, but this update tightens it — it is sufficient *only if* the legacy source
is actually read directly for every behaviorally load-bearing branch, not summarized by
an intermediary. Six real bugs slipping through a first pass that used a sub-agent's
summary as its primary source of legacy-behavior truth is strong evidence that this
caveat is not academic: it is where a real extraction project would actually lose
correctness.
