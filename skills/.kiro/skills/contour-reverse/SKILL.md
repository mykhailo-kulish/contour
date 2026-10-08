---
name: contour-reverse
description: >
  Reverse-engineer a Contour architecture record from a codebase. Performs a
  deep source-code investigation of a Component (or System), reconstructs its
  seven Contour elements and nine relationships, and writes the structured
  record — either to a local Contour YAML file or into the contour-engine via
  its MCP tools. Before investigating, it asks the user for any available
  documentation (design docs, READMEs, API specs, tickets, diagrams) to ground
  the reconstruction. Every branch in business-related logic is accounted for:
  business decision points become named Requirements and boundary-crossing
  branches become named Guardrails; every way a Function can end becomes a named
  outcome (result or alternative); and cyclomatic complexity is measured and
  documented so no "if" in business functionality is left undescribed. Use when
  asked to model, document, extract, reverse-engineer, or "contour" a
  system/service/repo, or to update an existing Contour record after code
  changes.
---

# Contour Reverse

You reconstruct a **Contour** record from source code. Contour is the framework
in `contour.md`; the record shape is `contour.schema.json` (local YAML) or the
`contour-engine` MCP tools (`mcp_contour_engine_*`). Read those before starting
if they are not already in context — the framework's vocabulary (seven elements,
nine relationship verbs, two zoom levels, outcomes, bindings) and the schema's
field names are normative and this skill assumes them.

The output of Reverse is a **record change**: a new or updated Contour record
that faithfully describes the code as it actually is, with every business
decision captured as a Requirement, every responsibility boundary captured as a
Guardrail, and every way each Function can end captured as a named outcome.
Reverse never invents behavior the code does not have. Where code and any prior
record disagree, the code is the source of truth for Reverse (the record is
being derived *from* it).

**The record is the authority; an interface spec is an output.** An existing
OpenAPI/AsyncAPI/protobuf file is an *import source* for the record, never
something the record links to as truth (`contour.md` §3.3). Extract its content
into the Interface's `binding`/`exposes`, don't reference the file as the
contract.

---

## 0. Ask for documentation first

Before scoping or reading code, **ask the user for any documentation that
describes the system** — this grounds the reconstruction and prevents you from
guessing intent that a document already states. Request (and accept whatever is
offered — do not block if none exists):

- Design docs, architecture notes, RFCs, or ADRs.
- READMEs, wikis, or Confluence pages for the service/repo.
- API specifications (OpenAPI/AsyncAPI/Swagger, gRPC protos, GraphQL schemas) —
  these are import sources for Interface bindings, not the record's authority.
- Data models, ER diagrams, migration histories.
- Tickets, epics, or requirements sources (Jira, issues) describing intended
  behavior.
- Any existing diagrams (sequence, context, C4) or a prior Contour record.

Use the documentation as **context and corroboration only** — the code remains
the source of truth (see the framing above). Where a document and the code
disagree, model what the code does and note the discrepancy in the report (§8).
If the user has no documentation, say so and proceed from code alone. Prefer the
right tool to fetch what the user points at (Confluence, API-spec files in the
repo, Jira) rather than asking the user to paste large documents.

---

## 1. Decide the output target

Ask (or infer from the request) **where the record goes**, because it changes
how you write, not what you find:

- **Local YAML** (`--target local`, the default when a `*.yaml`/`contour.yaml`
  path is named or the MCP tools are unavailable): produce a single YAML document
  that validates against `contour.schema.json` — nested ownership
  (Components under `System.groups`; functions/interfaces/dataObjects/events
  under their Component; Actors and Requirement/Guardrail definitions top-level),
  camelCase fields, relationships inline by name, no IDs. Prefer editing the
  existing file in place when updating.
- **MCP / contour-engine** (`--target mcp`): write through the
  `mcp_contour_engine_*` tools. There is no whole-model submit — the engine works
  **one element at a time**, and **every element named by a relationship must
  already exist before you reference it**, and **every Requirement/Guardrail must
  be stored before any element references it**. See §7 for the ordering.

If the target is ambiguous and both are available, ask once; otherwise default to
local YAML and say so.

---

## 2. Scope the analysis

1. Identify the **Component** boundary — one lifecycle: one deployable/service/
   package built, versioned, released together (see `contour.md` principle 1). A
   repo may hold one Component or several; a monorepo of independently-released
   services is several Components under one System. Confirm the boundary before
   modeling; state your assumption if you must infer it. (Components are
   **optional** in v0.5: a model may legitimately have none and say only what the
   System does, not how it is split — but Reverse works *from code*, so a running
   codebase always has at least one lifecycle unit to model as a Component.)
2. Identify the **System** it belongs to — the business-level application a
   stakeholder would name, defined by **what it offers its Actors**, not by how
   it is built. One System may group several Components. The System performs no
   work of its own: everything it does, one of its Components does
   (`performs`/`owns` are an *allocation* of the System's work to a lifecycle
   unit).
3. Note what is **out of scope**: infrastructure, deployment topology, and
   framework/library internals are never Contour elements (principle 5). A system
   this Component *depends on* is a **neighbouring Component** (drawn half-open),
   reached through that Component's Interface — **not** an Actor. An **Actor** is
   only a one-way originator of use (see §3).

Use a **context-gatherer sub-agent** for the initial sweep of an unfamiliar or
large codebase (entry points, routing/controllers, domain/service layer,
persistence, event publishers/consumers, outbound clients). Treat its output as
your reads. Then read the specific business-logic files yourself — Reverse's
quality depends on actually reading the branching code, not summaries of it.

---

## 3. Map code to the seven elements

Work from the outside in. Record where each element was found (file/class/
method) — you will need it for Verify later — but keep implementation names out
of the **element name** (principle 7: names are plain-language work, not code)
and out of `description`. A Function's **`behavior`** may name the mechanism in
business terms; precise code locations are best carried as a short `sources`
note on the element (see §4) or, for an Interface, inside its `binding`.

| Contour element | Find it in code as | Name it (plain language) |
|---|---|---|
| **System** | the product/capability the repo delivers, defined by what it offers | "Order Management" |
| **Component** | the deployable/service/module (one lifecycle) | the service's business name |
| **Function** | a unit of *business-related work* — a use case, a handler's core operation, a domain service method, an event reaction, a scheduled job | verb + object: "Reserve Stock", "Validate Order" |
| **Interface** | the technical entry surface serving ONE caller: a REST controller/router, a gRPC service, a message-listener binding, a CLI, a scheduled trigger, an MCP server | the channel, as its users name it: "Customer API", "Order gRPC" |
| **Event** | a message/domain-event published or subscribed to (bus, queue, topic, outbox) | past tense: "Order Placed" |
| **Data Object** | a persisted entity/aggregate/table/document this Component **owns and keeps** (state, not a request/response in transit) | the thing: "Order", "Stock" |
| **Actor** | an external **role with distinct access** that initiates use from outside, one-way | "Customer", "Support Staff" |

Rules that decide the tricky cases (all from `contour.md` §3):

- A method is a **Function** only if it is *business-related work*. Pure
  plumbing/parsing/mapping is a **step inside** a Function (and belongs in
  `steps`/`behavior`), not its own Function. `Calculate Total` is a Function;
  `parseRequestBody` is a step.
- A Function is **external iff some Interface `exposes` it**, and private
  otherwise. There is no separate "service" element. A handler reached via a
  route → that route's controller is the Interface, and it `exposes` the
  Function. A Function reached only by same-Component `calls` is private.
- **An Actor is one-way and is a role, not a job title** (principle, §3.5). The
  System never calls an Actor. Two job titles that reach a Component the same way
  are **one** Actor; the difference goes in the Actor's `description`. A
  depended-on external system is **not** an Actor — it is a neighbouring
  Component your Function `uses` through its Interface.
- **Data ownership is single and explicit** (principle 4). A table/entity is
  `owns`ed by exactly one Component. A Function may only `reads`/`modifies` a
  Data Object of **its own** Component. Reaching another Component's data shows up
  as `references` (Context view) resting on a `uses`→`exposes` chain or a
  `consumes` edge — never a direct data link. Data that only crosses a boundary
  (a request, a response) is **not** a Data Object — it is an inline shape in the
  Interface where it crosses (§6).
- An **Event** marks a crossing *between* Components. In-process, same-Component
  invocation is `calls`, not an Event. A publisher's Component `produces` it; a
  subscriber's Component `consumes` it and does not gain a `depends-on` from
  consuming (the Event is the coupling).
- **`uses` crosses an Interface; `calls` does not.** `uses` runs Actor →
  Interface, or Function → Function of **another** Component through an Interface.
  `calls` is Function → Function **within the same** Component, no Interface
  between. A Function never `uses` a Function of its own Component.

---

## 4. Reconstruct each Function's behavior, steps, and outcomes

A **Function's record carries nothing technical** (`contour.md` §3.3): what
happens and how it can end, in business terms. Technology lives in the
Interface's `binding` (§6); mechanism, where it matters, in `behavior` prose.
For every Function, write:

- `description` — one or two **plain-language, non-technical** sentences: what it
  does in business terms, understandable to a stakeholder who does not read code.
  No class/method/table names, no framework or protocol jargon.
- `steps` — the Function's **main path**, an ordered list where each entry is one
  of the relationship verbs. This is the authoritative order; the diagram's edges
  are a derived, unordered summary. The allowed steps:

  | Step | Target | Notes |
  |---|---|---|
  | `consumes` | an Event of **another** Component | **First step only, at most once.** The Function is subscribed to that Event and its arrival starts it. A Function with a `consumes` step is exposed by no Interface |
  | `calls` | a Function of the **same** Component | |
  | `uses` | `Interface / Function` | Names the other Component's Interface the call goes through, then the Function it exposes |
  | `reads` / `modifies` | a Data Object of the **same** Component | |
  | `produces` | an Event of the **same** Component | |

  A `calls` or `uses` step may carry a **`becomes`** map: it maps the callee's
  endings onto this Function's own `alternatives` — `becomes: { Short: Out Of
  Stock }` reads *when the callee ends `Short`, this Function ends `Out Of
  Stock`*. A callee ending that maps to nothing continues the main path. **Every
  `uses` step must map the built-in `Unreachable`** ending (the call couldn't be
  completed) to one of this Function's alternatives. Retries/timeouts are the
  Interface binding's concern, never a step.

- `result` — the **name** of the ending the main path reaches (`Placed`,
  `Found`, `Reserved`). Its effects are exactly the `steps`, so it carries
  nothing else. Name it for the result, not the check (§3.5).
- `alternatives` — **every other way the Function can end**, each named in
  business terms. Short form: `Below Minimum: The order total is under $1.00.`
  Long form, when the ending *does* something, gives `when` plus `effects` (in
  the same step verbs):

  ```yaml
  alternatives:
    Order Missing:
      when: The order no longer exists.
      effects:
        - produces: Invoice Failed
    Deferred: The owner couldn't be reached; the Event is processed again later.
  ```

  An alternative is a *business* ending — a shortage, an already-shipped order.
  Malformed requests and failed authentication are the binding's concern and
  **never** appear as alternatives. A Function started by an Event has no caller
  to answer, so its alternatives say what else it does (often `produces` another
  Event), not what it returns.
- `behavior` — the business rules the steps and outcomes don't already express
  (e.g. "Sum of quantity × unit price per line item; no discounts or tax").
  Business language; it may name a mechanism where that is the business-relevant
  fact, but code identifiers belong in `sources`/`binding`, not here.
- `requirements` / `guardrails` — optional lists of names (§5).

Optionally attach a compact **`sources`** note (code locations: file · symbol ·
lines) so Verify can find the implementation. Keep it out of the element name,
`description`, and `behavior`.

Match steps to the code's real sequence: a repository save is `modifies` its
Data Object; a call to a same-Component service method is `calls`; a publish is
`produces`; an outbound HTTP/gRPC/queue call to another Component is `uses` that
Component's Interface; a read query is `reads`.

---

## 5. Cover every business branch — the core of Reverse

This is the deep-investigation obligation. `steps` is a straight line and cannot
express branching (`contour.md` §6). Every branch instead surfaces as a named
**outcome** (a `result` or an `alternative`, §4), governed by a **Requirement**
or **Guardrail** where it encodes a decision or a boundary. So **every `if`,
`switch`/`case`, guard clause, ternary, early return, loop-with-condition,
`&&`/`||` short-circuit, and exception path in business-related functionality
must be accounted for** — mapped to an outcome and, where it is a decision or
boundary, to an obligation. Do this per Function:

### 5.1 Measure and record cyclomatic complexity

- Compute the Function's **cyclomatic complexity** — count decision points:
  `if`, `else if`, each `case`, `&&`, `||`, `?:`, `catch`, loop conditions, and
  each guard/early-return. CC = decision points + 1 (per connected unit).
- Prefer a tool if the ecosystem has one and it is available (e.g. `radon cc` for
  Python, `gocyclo` for Go, ESLint `complexity` for JS/TS, `lizard` for many
  languages, PMD/checkstyle for Java). Run it read-only; if none is available,
  count by hand from the source you have read. Never invent a number — if you
  could not measure it, say so.
- State the branch count and complexity in the Function's `behavior` (e.g.
  "Cyclomatic complexity 6; five business branches, each an alternative below").
  You may keep the raw measurement alongside the Function's `sources` note. Use
  CC as the **budget**: #named outcomes + non-business branches should account
  for the measured decision points, or the gap is a missed branch.

### 5.2 Map each branch to an outcome, then to a Requirement or Guardrail

Walk each decision point. First give it an **outcome** — the branch either
continues the main path (`result`) or ends the Function in a named
`alternative`, or (for a `uses`/`calls` callee ending) is pulled in by a
`becomes` map. Then classify it:

- **Business-rule branch** — the condition encodes a business decision or an
  invariant the element must uphold (reject order under $1, block if KYC not
  passed, apply discount when tier is gold, retry N times then fail). →
  Create/attach a **Requirement**: a positive obligation, named, with a
  description that states the rule *and its condition and outcome* (so a
  Requirement-derived test can be written from it). Attach it to the Function
  that **owns the decision** (per `contour.md` §3.6: the decision lives with the
  Function responsible for it, e.g. `Place Order`, not the fact-producer
  `Calculate Total`). The branch's outcome is the `alternative` the Requirement
  drives into (e.g. `Below Minimum`).
- **Boundary / responsibility branch** — the branch guards where this
  Component's responsibility ends: delegating to another Component instead of
  reimplementing, treating an external result as opaque, refusing to touch data
  it doesn't own, not bypassing an Interface. → Create/attach a **Guardrail**:
  a boundary the implementation must stay inside, named, described as what must
  **not** be done / must be delegated. Guardrails also hold rules about *how* and
  *where* endings are reached (e.g. an `All Or Nothing` guardrail that says
  nothing is persisted or announced unless every check passed), which keeps the
  Function a simple path and lets an alternative like `Below Minimum` need no
  position in `steps`.
- **Non-business branch** — pure defensive/technical plumbing (null check before
  a library call, framework retry, serialization guard) with no business meaning.
  → Not a Requirement, Guardrail, or alternative; it is a technical detail of a
  step, noted in `behavior`/`sources` if it matters. Malformed-request and
  auth-failure branches are the binding's concern, not alternatives. Do not
  manufacture a Requirement for plumbing — noise weakens the model.

Coverage rule: **every business-rule branch maps to at least one Requirement and
one named outcome; every boundary branch to at least one Guardrail.** In
`behavior`, enumerate the branches, name the outcome each produces, and name
which Requirement/Guardrail each is covered by, so a later reader (or Verify) can
trace branch → outcome → obligation. If a branch is genuinely non-business, say
so explicitly rather than omitting it — an unexplained gap reads as a missed
branch.

Reuse existing definitions by name where the same rule/boundary recurs across
Functions (definitions are defined once and referenced). Do not duplicate a
definition under two names.

### 5.3 Requirement vs Guardrail — write them so they can be checked

Both are enforced, not decorative (`contour.md` §3.6). Write each so Verify can
grade it:

- **Requirement** — a positive, testable obligation. Good: "An order must total
  at least $1.00 before it can be placed; smaller amounts are rejected." Bad:
  "handles small orders."
- **Guardrail** — a boundary about what the code must *not* do or must delegate.
  Good: "Order Service must not compute, authorize, or settle payments; it uses
  Billing's external Functions and treats the result as opaque." Bad: "payments
  are careful."

Either may be attached to **any** element, not only a Function — an Interface can
carry a boundary about what must never be returned through it; a Component-level
Guardrail (`All Or Nothing`) applies to every one of its Functions.

---

## 6. Fill in Interfaces, Data Objects, Events, and shapes

Shapes use the **core type notation** (`contour.md` §3.3), so a shape means the
same thing wherever it appears, independent of the technology that carries it:

| Notation | Meaning |
|---|---|
| `string`, `integer`, `decimal`, `boolean`, `uuid`, `date-time` | Primitives |
| `enum(a, b, c)` | One of a fixed set |
| `T[]`, `T[1..]` | A list; `[1..]` requires at least one |
| `T?` | Optional; fields without `?` are required |
| `Order` | A reference to a Data Object |
| `Order.Line Item` | A type nested in a Data Object's schema (defined once, in its owner) |
| `Order { id, status }` | A projection: only the named fields |
| `{ productId: string, … }` | An inline shape (data with no Data Object of its own) |

- **Interface** — the technical surface, and the **only** place technology
  lives. Its record answers three questions:
  - **`serves`** — exactly **one** caller: a named **Actor**, or the reserved
    word **`System`** (this System's *own* Components reaching one another — a
    Function of one Component reaching a Function of another). A caller that is
    another System is never `System`: it is an Actor, by name. Two Actors with
    identical access are one role; an Actor may use several Interfaces.
  - **`binding`** — the technology in one block, with the core key **`style`**
    (OpenAPI, gRPC, MCP, AsyncAPI, Web UI, …) naming the binding that interprets
    every other key (base address, auth, error envelope, versioning). The keys
    after `style` belong to the style's binding, not to Contour. **Link or import
    an existing spec here** rather than treating the spec file as the contract.
  - **`exposes`** — the Component's **own** Functions this caller can reach, each
    with `operation` (what the caller invokes, in the style's terms),
    `request` (an inline shape, core notation), and `responses` (every outcome of
    the Function mapped to what the caller gets back — a code alone, or a code +
    body). When a binding's conventions cover how Functions are reached and
    outcomes presented (a Web UI, say), `exposes` may list Function names only.

  ```yaml
  Interface: Customer API
    description: Customers placing, tracking and cancelling their own orders.
    serves: Customer
    binding: { style: OpenAPI, base: /v1/orders, auth: customer token, errors: RFC 7807 }
    guardrails: [Own Orders Only]
    exposes:
      Place Order:
        operation: POST /
        request: { items: "Order.Line Item { productId, quantity }[1..]" }
        responses:
          Placed:        { code: 201, body: "Order { id, items, total, status }" }
          Out Of Stock:  { code: 409, body: { shortItems: "{ productId: string, missing: integer }[1..]" } }
          Below Minimum: 422
  ```

  Requests and response bodies may reference the Component's **own** Data
  Objects, their nested types, and projections — never another Component's. Each
  Component describes its own boundary. A Function exposed by several Interfaces
  has the **same** steps and outcomes for every caller; only what each caller
  sends and sees may differ. If the *rules* differ per caller, that is **two
  Functions**, named for whose action they are ("Cancel Own Order", "Cancel Order
  for Customer").

- **Data Object `schema`** — the fields of state the Component **owns and
  keeps**, in the core notation. Prefer linking an existing artifact (an ORM
  entity, a migration, a JSON Schema) by path over re-authoring; inline a compact
  field map when none exists. A nested type is defined once, in its owner.
- **Event `schema`** — payload shape, core notation. Event name **past tense**.
- Component-level Context edges: `owns`, `produces`, `references`, `consumes`,
  `depends-on`. A `references` that rests on a `uses` chain implies a `depends-on`
  to the owner; consuming an Event does **not** create a `depends-on`.

Keep the **`description`** of every element (System, Component, Function,
Interface, Event, Data Object, Actor) in **plain, non-technical business
language** — the kind of sentence a product owner would recognise. Technical
shape and mechanism live only in a Data Object's/Event's `schema`, an Interface's
`binding`/`exposes`, and (in business terms) a Function's `behavior`; plus an
optional `sources` note for code locations. System, Component, Actor, and
Function have **no** `schema`, and a Function has **no** `binding`.

### What a Function can work with

A Function declares no inputs (`contour.md` §3.3); what it works with follows
from how it is started — the `request` of the Interface it was reached through
plus the caller's identity, or the Event's schema, or (for a private Function)
its caller's context — plus its Component's Data Objects. Don't invent an
`inputs`/`params` field; model data where it crosses a boundary (Interfaces,
Event schemas) and let context carry the rest.

### Actor `uses`, rationale, and the Neighbour block (v0.5 recovery)

These three are **recovered**, never invented (`contour.md` §3.7): bottom-up,
you read them off the code's shape and the Interfaces you found.

- **Actor `uses`** — each Actor's record names the Functions it uses. Read it off
  what the Interfaces serving that Actor `exposes`, then review the list for
  anything exposed by accident (an endpoint reachable but never actually used by
  that caller). The invariant is equality: an Actor's `uses` must match exactly
  what its serving Interface(s) expose. For an internal caller, the counterpart
  is the `uses` steps of the Functions calling an Interface that `serves: System`.
- **`rationale`** — every Component and Interface carries one: the Actor uses,
  Requirements, Guardrails, principles, or allocation that explain why this
  lifecycle boundary or this channel exists. Bottom-up you recover it from the
  code's shape (why these Functions are released together; why this caller needs
  this channel). A Component or Interface whose rationale you **cannot** recover
  is itself a finding — a missing Requirement or a design worth questioning —
  not something to invent a plausible reason for.
- **`Neighbour` block** — a System this Component *depends on* is not an Actor and
  not modeled in full: emit a half-open `Neighbour` block holding only what this
  model touches — the neighbour's touched Events, Functions (name + outcomes),
  and the Interface it offers, which `serves` this System as its Actor. This is
  what lets a cross-System `uses` step resolve (a step must never name a System,
  Function, or Interface that doesn't exist). The neighbour's own model holds
  everything else; the two meet at that Interface.

---

## 7. Write the record

### 7.1 Local YAML target

Produce/patch one document conforming to `contour.schema.json`:

- Nest ownership: `System` → `groups` (Components) → each Component's
  `functions` / `interfaces` / `dataObjects` / `events`. `Actor`, `Requirement`,
  `Guardrail` are top-level arrays.
- Cross-boundary edges inline by name: `groups`, `performs`, `exposes`, `uses`,
  `consumes`, `produces`, `references`, `depends-on`, `owns`; Function `steps` as
  ordered `{verb: Target}` entries, with `becomes` maps where a callee's ending
  changes this Function's.
- Each Function carries `result` and `alternatives`; each Interface carries
  `serves`, `binding`, and `exposes`; each Interface declares **no owner**
  (`component:`) — it sits on whichever Component performs the Functions it
  exposes (v0.5). Each Actor carries its `uses` list; each Component and
  Interface carries a `rationale`.
- A System this model depends on goes in a top-level **`Neighbour`** block
  (half-open: its touched Events, Functions, and the Interface serving this
  System), not as a Component or an Actor.
- camelCase field names, no IDs, past-tense Event names, core type notation for
  every shape.
- Every `description` is non-technical business prose (see §6); `behavior` states
  business rules and the branch/complexity account; technical shape stays in
  `schema`/`binding` and code locations in an optional `sources` note.
- When updating an existing file, edit in place and preserve untouched elements;
  don't rewrite the whole file if only a few elements changed.

> **Schema sync note.** If `contour.schema.json` lags the v0.5 vocabulary — e.g.
> it lacks `result`/`alternatives`/`becomes` on a Function, `serves`/
> `binding`/`exposes` on an Interface, `uses` on an Actor, `rationale` on a
> Component/Interface, or a top-level `Neighbour` block; still *requires* a
> `component` owner on an Interface; or still sets `additionalProperties: false`
> where this skill needs a field — treat that as the schema trailing the
> framework spec. Emit the v0.5-correct record, flag the specific field the
> validator rejects in the report (§8), and recommend the schema be extended to
> match `contour.md`; do **not** drop detail the spec calls for. Likewise an
> optional `sources` note for code locations is a convenience this skill uses;
> if a strict validator rejects it, flag it rather than discarding the locations.

Validate before finishing: if a JSON-Schema validator or `yq`/`ajv` is available,
run it against `contour.schema.json`; otherwise self-check the required fields
(`name`, `description` everywhere; `serves`/`binding`/`exposes` on Interfaces;
`result` on Functions; `uses` on Actors; `rationale` on Components and
Interfaces) and run the consistency checks in §7.3.

**Run `contour-check.py` when there is no MCP engine.** The local-YAML path has no
engine to validate against, so the framework's reference checker is the way to
run the §3.3 contradictions and §3.7 gaps over the file:

```
python3 contour-check.py <model>.yaml
```

It prints each **CONTRADICTION** (the model is wrong) and each **GAP** (not filled
in yet, with its top-down and bottom-up next step), and **exits non-zero only on
contradictions** — a model with gaps and no contradictions still exits 0, which is
exactly the v0.5 "incomplete is not invalid" rule. Treat a non-zero exit as a
blocking finding to fix before declaring the record done; report the gaps as
drift-to-fill (§8), not failures. If the checker isn't present in the repo (it
ships as `contour-check.py` alongside `contour.md`), fall back to the hand-run
§7.3 checks and say the automated check was unavailable. Prefer the checker over
a hand pass whenever it is available — it is the same check the contour-engine
runs, so the local and MCP paths agree.

### 7.2 MCP / contour-engine target

Write through `mcp_contour_engine_*` in **dependency order**, because the engine
validates references against already-persisted state:

1. **Definitions first**: `store_requirement` / `store_guardrail` for every
   Requirement/Guardrail you introduced (upsert by name).
2. **Elements in reference order** via `store_element`, each with its
   `elementType`, owning `systemId`/`componentId`, and `record` body:
   System → its Components → each Component's Data Objects and Events (targets of
   `reads`/`modifies`/`produces`/`consumes`) → Interfaces (whose `exposes` names
   Functions) → Functions (whose `steps` reference the above) → Actors. Provide
   an element **before** anything that names it; a target that doesn't exist yet
   yields a validation error. (Interfaces and Functions are mutually referential
   — an Interface `exposes` a Function and a Function `uses` an Interface — so
   create the owning Component's Functions and Interfaces, then confirm the
   `exposes`/`uses` links resolve; follow the engine's reported ordering if it
   requires one before the other.) Resolve the owning `systemId`/`componentId`
   with `owner_candidates` rather than guessing an id. Keep each `description`
   non-technical; put the contract in `schema`/`binding`/`exposes` and the
   outcomes in `result`/`alternatives` inside the `record` body. Carry each
   Actor's `uses` and each Component's/Interface's `rationale` in the `record`
   body too, and store a depended-on System as a `Neighbour` (half-open), not as
   a Component or Actor.
   If the engine rejects a v0.5 field (`result`, `alternatives`, `becomes`,
   `serves`, `binding`, `exposes`, Actor `uses`, `rationale`, `Neighbour`) as
   unknown, that is the engine lagging the spec — flag it in the report (§8) and
   recommend the engine's record schema be extended, rather than discarding the
   detail.
3. Retrieve/confirm with `retrieve_element`, `search_specifications` (pass a
   `query` for free text, or only `elementType`/`systemId` to list; results
   come a page at a time with a `total`),
   `retrieve_requirement`, `retrieve_guardrail`; render with `render_diagram` /
   `render_element_diagram` to sanity-check the shape.
4. If a store is rejected, read the validation problem, fix the offending field
   or ordering, and retry — do not force or skip validation.

Treat MCP writes as medium-risk mutations of a shared store: state what you are
about to create/update before a large batch, and stop on repeated validation
failures to reassess rather than looping.

### 7.3 Consistency checks (run before finishing, either target)

On the **MCP target** the engine runs these for you (a rejected `store_element`
is a failed check); on the **local-YAML target** run `contour-check.py` (see
§7.1) — it is the reference implementation of exactly this list plus the §3.7
gaps. The list below is what to verify by hand when neither is available.

The style-neutral checks from `contour.md` §3.3 — a record that fails one has a
real defect, not a cosmetic one:

1. Every Interface belongs to one Component and `serves` an existing Actor or
   `System`; it `exposes` only Functions that Component performs.
2. Each exposed Function's `responses` cover its `result` and every alternative,
   and only those — unless the binding's conventions cover them and `exposes`
   lists names only.
3. No two Functions share an `operation` within one Interface.
4. Requests and response bodies reference only the Component's own Data Objects,
   their nested types, or projections of them.
5. A `uses` step names an Interface that `serves: System` and `exposes` the
   target Function.
6. `becomes` keys are outcomes of the callee (or `Unreachable` on a `uses`);
   `becomes` values are alternatives of the calling Function.
7. Every `uses` step maps `Unreachable`.
8. `consumes` appears only as the first step, at most once, on an Event another
   Component produces; a Function that has it is exposed by no Interface.
9. A `calls` step stays within one Component — a caller and callee you allocate
   to different Components contradicts the edge; resolve it by redesign (expose
   the callee on an Interface serving `System` and rewrite the step as `uses`,
   deciding what `Unreachable` becomes, or keep both Functions in one Component),
   never a silent cross-Component call (`contour.md` §3.3 check 9 / principle 9).
10. Allocation is single — one performing Component per Function, one owning
    Component per Data Object, one producing Component per Event;
    `reads`/`modifies` stay with the owner, and an Event is produced where its
    Function runs (`contour.md` §3.3 check 10).
11. Each Actor's `uses` equals exactly what the Interface(s) serving it
    `exposes`; for an Interface serving `System`, what it exposes equals what the
    `uses` steps calling it use (`contour.md` §3.7).

---

## 8. Report

End with a concise summary the user can act on:

- Component/System modeled and the boundary you assumed.
- Which documentation the user provided and how it informed the model (and any
  place code and documentation disagreed).
- Counts: Functions, Interfaces (and the caller each `serves`), Events, Data
  Objects, Actors (and the `uses` list recovered for each); Requirements and
  Guardrails created; any `Neighbour` Systems recorded.
- A per-Function **branch-and-outcome** table: Function → cyclomatic complexity →
  #business branches → named outcomes (`result` + `alternatives`) →
  Requirements/Guardrails covering them, flagging any branch you classified as
  non-business.
- Which consistency checks (§7.3) you ran and their result.
- Any Component or Interface whose `rationale` you could **not** recover — called
  out as a finding (a missing Requirement or a design worth questioning,
  `contour.md` §3.7), not papered over with an invented reason.
- Anything you could **not** determine from the code (ambiguous ownership,
  unmeasurable complexity, unclear external boundary, a caller you couldn't
  classify as Actor vs `System`) — stated plainly, not guessed.
- Whether any v0.5 field was rejected by the schema/engine, with a recommendation
  to extend `contour.schema.json` / the contour-engine record schema to match
  `contour.md`.
- Where the record was written (file path, or the engine + element/definition
  names).

---

## Guardrails for this skill

- **Ask for documentation before investigating**, but never block on it — proceed
  from code if none is offered, and always let code override docs.
- **Describe what the code does, not what it should do.** Reverse is extraction;
  do not "improve" behavior into the record.
- **Keep every `description` non-technical.** Business-language descriptions
  only; `behavior` states business rules, outcomes, and the branch/complexity
  account; schemas go in `schema`, technology in the Interface `binding`, code
  identifiers in an optional `sources` note — never in a name or `description`.
- **A Function carries nothing technical.** It has `description`, `steps`,
  `result`, `alternatives`, `behavior` (and `requirements`/`guardrails`) — no
  `binding`, no `schema`, no protocol or path. Technology lives on the Interface.
- **Every Function has outcomes.** Exactly one `result` (the main path's ending)
  and an `alternatives` entry for every other way it can end. Every `uses` step
  maps `Unreachable`.
- **`consumes` is a step** — the first step, at most once, for an Event-triggered
  Function (which is exposed by no Interface).
- **Each Interface serves exactly one caller** — an Actor or `System` — and
  `exposes` only its own Component's Functions. An Interface declares **no owner**
  (`component:`): it sits on whichever Component performs what it exposes (v0.5).
- **Actors are one-way roles.** The System never calls an Actor; a depended-on
  system is a half-open **`Neighbour`** reached via `uses`, not an Actor and not
  a Component of this model. Merge two job titles with identical access into one
  Actor. Recover each Actor's `uses` list from what the Interfaces serving it
  expose, and keep the two equal.
- **Recover rationale, don't invent it.** Every Component and Interface carries a
  `rationale`; one you cannot recover from the code's shape is a finding
  (`contour.md` §3.7), not a reason to make one up.
- **Never leave a business branch undescribed.** Every decision point in business
  logic maps to a named outcome and, where it is a decision or boundary, to a
  Requirement or Guardrail — or is explicitly stated as a non-business branch.
- **Don't invent Requirements/Guardrails for plumbing.** Precision beats volume.
- **Respect data ownership**: one owner per Data Object; cross-Component data is
  `references`/`consumes`, never a direct read. A request/response in transit is
  an inline shape in an Interface, not a Data Object.
- **The record is the authority; a spec is an output.** Import an existing
  OpenAPI/AsyncAPI/protobuf into the binding; never link it as the contract.
- **Run the §7.3 consistency checks** before declaring the record done — via the
  contour-engine on the MCP target, or `contour-check.py` on the local-YAML
  target when no MCP is available (hand-run the list only if neither exists).
- **Don't fabricate metrics**: report measured cyclomatic complexity, or say it
  was estimated/unmeasured.
- **On the MCP target, honour reference ordering and engine validation**; never
  bypass it.
- If the technology stack is in question (e.g. choosing a complexity tool to add
  as a dependency), the ADOIT Technology Radar rules still apply — but read-only
  analysis tooling you invoke ad hoc is fine.
