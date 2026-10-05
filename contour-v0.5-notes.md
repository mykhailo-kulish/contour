# Contour v0.5 — working notes: one model, two directions

Status: working draft. These notes test the v0.5 idea on a real model before
the paper (`contour.md`) is rewritten. The paper on this branch is still v0.4.

## The idea

A Contour model is **one model at one level**. Its elements — System, Actor,
Function, Data Object, Event, Component, Interface — are peers; none is a
layer above or below another. What varies is **where you start filling it
in**:

| | Top-down | Bottom-up |
|---|---|---|
| Starts from | Business needs | Source code |
| Filled in first | Actors and the Functions they need, Data Objects, Events, Requirements, Guardrails | Components (deployables), Interfaces (entry points), Functions (handlers), Data Objects (stores) |
| Recovered later | Components and Interfaces — how the System is split and reached | Actors' needs, and the Requirements and Guardrails that explain the code's shape |
| Typical use | Building a new System from a specification | Documenting or changing an existing one; legacy extraction |

Both directions arrive at the same model. A model in progress is simply
incomplete from one side, and the checker says what is missing and what the
next step is from either direction.

This fits the paper's claims. Building from a specification is the top-down
direction run to completion; propagating a change into an existing codebase
starts bottom-up (recover the model) and continues top-down (change the
needs, then the code).

## What v0.5 adds to v0.4

- **An Actor declares the Functions it `needs`.** This is the record of the
  Actor → Function `uses` edge. Where an Interface exists, the edge is
  refined as Actor → Interface → Function — the same rollup as principle 5.
  ```yaml
  Actor: Modeler
    needs: [Search Specifications, Retrieve Element, Store Element, …]
    requirements: [Works In A Browser, Listings Are Paginated]
  ```
- **Interfaces belong to the System and are allocated to a Component**, not
  owned by one by definition: an Interface names the Component that
  `implementedBy`, and the Component lists it in `implements`. When the
  Component implementing an Interface isn't the one performing its
  Functions, the Interface names the internal Interface it goes `through`.
- **Components and Interfaces carry a `rationale`**: the Actor needs,
  Requirements, Guardrails, principles or allocation that explain why they
  exist. Top-down, it records why something was derived; bottom-up, it
  records the reason recovered for what the code already has.
- **Components are optional.** A model with none says what the System does,
  not yet how it is split. `performs`, `owns` and `produces` are read as
  allocation of the System's Functions, Data Objects and Events.

## contour-engine as one model

`contour-engine.yaml` on this branch is the v0.5 model:

- **System** Contour: 15 Functions, 5 Data Objects, 6 Events.
- **Actors:** Modeler (needs 14 Functions; *Works In A Browser*) and AI Agent
  (needs the same 14; *Reaches The System As Tools*).
- **Components:**
  - **contour-engine** performs every Function and owns all data —
    rationale: *One Core For Every Actor*, principle 4.
  - **contour-engine-ui** performs nothing and implements the Console —
    rationale: *Console Released Independently*, *Works In A Browser*.
- **Interfaces:**
  - **Contour Console** serves the Modeler (Web UI), implemented by
    contour-engine-ui, through the Contour REST API.
  - **Contour MCP Server** serves the AI Agent (MCP), implemented by
    contour-engine.
  - **Contour REST API** serves Components (OpenAPI), implemented by
    contour-engine — rationale: the allocation that puts the Console apart
    from the Functions it presents.

```mermaid
graph LR
    Modeler([Actor: Modeler])
    Agent([Actor: AI Agent])
    subgraph Contour [System: Contour]
        subgraph UI [Component: contour-engine-ui]
            Console(("Contour Console"))
        end
        subgraph Engine [Component: contour-engine]
            REST(("Contour REST API"))
            MCP(("Contour MCP Server"))
            Fns["14 exposed Functions<br/>+ Validate Element"]
            Data[(5 Data Objects)]
        end
    end
    Modeler -->|uses| Console
    Agent -->|uses| MCP
    Console -->|through| REST
    REST -->|exposes| Fns
    MCP -->|exposes| Fns
    Fns -->|reads / modifies| Data
```

Compared with the v0.4 model of the same system, it has 15 Functions where
v0.4 had 29: the Console's 14 Functions (List Components, View Element, Find
Requirements, …) were presentation of capabilities the System already has.
The Console's description now says how its views combine them.

## Completing a model in each direction

Rules for moving from what a model has to what it lacks. An implementer or an
LLM applies them; the checker reports what's left.

**Top-down** — from needs to structure:

1. **One Interface per Actor and channel.** The Actor's channel Requirement
   (*Works In A Browser*, *Reaches The System As Tools*) picks the binding;
   the Interface `serves` the Actor and `exposes` exactly its `needs`.
2. **Components come from Requirements and Guardrails.** A Requirement that
   something changes, scales, fails or is released on its own separates a
   Component; a Guardrail that things stay together, and principle 4 (one
   home per Data Object), keep them in one.
3. **Allocate everything exactly once** — each Function to one performer,
   each Data Object to one owner, each Event to the Component performing the
   Function that produces it.
4. **A split allocation derives an internal Interface.** When an Interface is
   implemented by a Component that doesn't perform its Functions, an
   Interface serving `Components` is added on the performing Component and
   named in `through`. This is where the Contour REST API comes from.

**Bottom-up** — from code to needs:

1. **Deployables become Components; entry points become Interfaces;**
   handlers become Functions; stores become Data Objects.
2. **An Interface's caller becomes an Actor**, unless the caller is another
   Component — then the Interface serves `Components`.
3. **An Actor's `needs` are what the Interfaces serving it expose**, reviewed
   for anything exposed by accident.
4. **Rationale is recovered, not invented.** Each Component and Interface
   gets the Requirement or Guardrail that explains why the code has it. One
   that can't be explained is a finding in itself: either a missing
   Requirement or a design worth questioning.

## Checks (`contour-check.py`)

The checker reads one model and reports two kinds of finding.

**Contradictions** — wrong however the model was started; exit status 1:

- **R1–R6** every reference resolves: Actor needs, steps, `becomes`,
  Interfaces (callers, exposed Functions, implementers, `through`),
  Component allocations, Requirements, Guardrails, rationale
- **R3** response maps cover exactly each exposed Function's outcomes
- **R1, R3** no Actor needs, and no Interface exposes, an Event-triggered Function
- **A1** nothing allocated to two Components
- **A3** `reads`/`modifies` stay with the owner (principle 4); an Event is
  produced where its Function runs; a `calls` edge isn't split across
  Components
- **A5** an internal Interface named in `through` serves `Components` and
  exposes the Functions from their performer

**Gaps** — not filled in yet; each comes with a top-down and a bottom-up next
step:

- **A0** no Components at all
- **A2** a Function, Data Object or Event not yet allocated
- **A4** an Interface not yet allocated to a Component
- **A5** an Interface presenting Functions performed elsewhere, with no internal Interface
- **N1** an Actor with Interfaces but no stated needs
- **N2** an Actor with needs but no Interface
- **N3** a need no Interface exposes
- **N4** an exposed Function the Actor isn't recorded as needing
- **W1** a Component or Interface without rationale

A gap reads like this:

```
GAP [N3] Actor AI Agent needs Render Diagram, but no Interface serving it exposes it
      top-down:  expose Render Diagram on an Interface serving AI Agent
      bottom-up: check whether AI Agent really needs it; if not, drop it from `needs`
```

Results on contour-engine:

| Model state | Contradictions | Gaps |
|---|---|---|
| Complete (`contour-engine.yaml`) | 0 | 0 |
| Started top-down: no Components or Interfaces yet | 0 | 3 — A0, and N2 for each Actor |
| Started bottom-up: no needs, no rationale yet | 0 | 7 — N1 for each Actor, W1 for each Component and Interface |
| A Data Object given a second owner | 8 | 0 |
| Validate Element moved to the UI Component | 4 | 0 |
| An MCP response map missing an outcome | 1 | 0 |
| The Console without its internal REST API | 0 | 1 — A5 |

## Open decisions

1. **A `calls` edge split by allocation.** `Store Element calls Validate
   Element`; if an allocation ever put them in different Components, the edge
   would cross a boundary. Today that's a contradiction (A3). The
   alternative is to let the allocation refine `calls` into
   `uses: Interface / Function`, the way rule 4 adds an internal Interface.
2. **A call into another System,** when the model starts top-down and has no
   Interfaces yet: does a step name `System / Function`, refined to
   `Interface / Function` once the other System's Interface is known? Not
   exercised by contour-engine, which depends on no other System.
3. **`needs` or `uses`.** `needs` reads better for business authors; `uses`
   reuses the relation's name.
4. **Channel requirements are a convention.** Top-down rule 1 relies on an
   Actor having a Requirement that names its channel; nothing yet checks
   that an Interface's binding matches it.
5. **Is the `needs` ↔ `exposes` redundancy worth keeping in a complete
   model?** It's what lets the two directions meet and be checked against
   each other (N3, N4); the cost is that a complete model states the same
   set twice.
6. **Diagrams.** The figure above draws the System with Components inside it.
   How the v0.4 one-page diagram, the half-open neighbours and the
   drill-downs carry over is still to be decided.
7. **Schema.** `contour.schema.json` on this branch is still v0.4; it needs
   System-level Interfaces, `implements`, `through`, `rationale` and Actor
   `needs`.

## Next steps

1. Settle the open decisions.
2. Model the paper's Order Service example as a v0.5 model, including a call
   into another System (open decision 2), and run it both from a top-down
   start and a bottom-up start.
3. Update the schema.
4. Rewrite the paper around one model and two directions.
