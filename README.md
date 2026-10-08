# Contour

**A lightweight framework for modeling software system architecture.**

Contour defines the logical boundary of a software system — what it does,
the data it shares, and the interfaces it exposes and depends on — as a
business-readable structure precise enough to guide a described change
into actual code. It is meant to serve three audiences at once: a
non-developer describing a change in business language, a developer
turning that into a safe change, and an LLM doing the same, using the
model as its specification and its boundary.

A **System** serves its **Actors** — people, organizations, other
Systems — and each Actor's record names the **Functions** it uses.
**Components** implement the System, grouping its Functions and the data
they keep by lifecycle; **Interfaces** are the channels through which
each caller reaches them. Seven element types and nine relationship
verbs, across two levels of detail: a compact diagram for shape, and a
structured record underneath for behavior, schemas and contracts.

Since v0.5 a model is **one model, completed from either direction**:
**top-down**, from the Actors and the Functions they need, or
**bottom-up**, reverse-engineered from source code. A checker reads the
model either way and reports what is *wrong* (contradictions) separately
from what is *not filled in yet* (gaps), each gap with its next step
from both directions.

**Author:** Mykhailo Kulish ([LinkedIn](https://www.linkedin.com/in/mkulish/))

## Repository layout

```
contour.md                  the framework paper (current version noted inside)
contour.schema.json         JSON Schema for the structured-record style
contour-v0.5-notes.md       working notes and decisions behind v0.5
engine/                     the contour-engine model — a System to build from
example/                    worked examples and their companion walkthrough
experiments/                evidence log, roadmap and experiment notes
skills/                     the checker and agent skills that apply Contour
```

### The framework

- [`contour.md`](contour.md) — the specification: motivation, design
  principles, metamodel, notation, a worked example, limitations and
  conclusion. Section 3.7 describes the two directions and the
  contradiction/gap split.
- [`contour.schema.json`](contour.schema.json) — the JSON Schema for a
  Contour model as YAML/JSON: System, Component, Function, Interface,
  Event, Data Object and Actor, plus Requirement and Guardrail
  definitions and half-open `Neighbour` Systems.
- [`contour-v0.5-notes.md`](contour-v0.5-notes.md) — the working notes
  that led to v0.5: the decisions taken, the rules for completing a
  model in each direction, and the open questions.

### Models

- [`engine/contour-engine.yaml`](engine/contour-engine.yaml) — a Contour
  model of the Contour engine itself: one deployable Component,
  `contour-engine`, that stores, validates, checks, searches and renders
  Contour specifications and owns all Contour data. It serves two
  Actors from the same runtime: the Modeler through the **Contour
  Console**, a Web UI with a view and an editor per element type, and
  the AI Agent through the **Contour MCP Server**, as tools. It is meant
  to be **built from** (see below).
- [`example/order-management.yaml`](example/order-management.yaml) — the
  paper's worked example: three Actors, one of them another System, and
  a neighbour System it depends on.
- [`example/billing.yaml`](example/billing.yaml) — the same dependency
  seen from the other System's side.
- [`example/contour-example.md`](example/contour-example.md) — a
  walkthrough of all three models, with the checker's real output on
  complete, top-down and bottom-up versions of each.

### Evidence

- [`experiments/contour-experiments.md`](experiments/contour-experiments.md)
  — the evidence log and roadmap: preliminary experiments in propagating
  a change into code, building independent implementations from one
  record, and building a new Component from the record of a real legacy
  subsystem; what they prove and challenge, and the next steps.
- [`experiments/EXPERIMENT-NOTES-ANONYMIZED.md`](experiments/EXPERIMENT-NOTES-ANONYMIZED.md)
  — the sanitized live log of the legacy-subsystem build experiment,
  including its second, source-verified comparison pass.
- [`experiments/EXPERIMENT-NOTES-DECOMPOSITION-ANONYMIZED.md`](experiments/EXPERIMENT-NOTES-DECOMPOSITION-ANONYMIZED.md)
  — the sanitized log of a change-propagation experiment on a real
  legacy monolith: using an existing Contour record as the boundary for
  a behavior-preserving decomposition of one of its Components.

### Tools and skills

- [`skills/contour-check.py`](skills/contour-check.py) — the reference
  checker. Reads one model file and reports contradictions and gaps;
  exits non-zero only on contradictions.

  ```
  python3 skills/contour-check.py engine/contour-engine.yaml
  ```

- [`skills/.kiro/skills/contour-reverse`](skills/.kiro/skills/contour-reverse/SKILL.md)
  — an agent skill that reverse-engineers a Contour record from a
  codebase (the bottom-up direction), writing it to a local YAML model
  or into a running contour-engine through its MCP tools.
- [`skills/.kiro/skills/contour-verify`](skills/.kiro/skills/contour-verify/SKILL.md)
  — an agent skill that verifies a codebase against an existing record:
  structure, behavior, and every referenced Requirement and Guardrail.
- [`skills/.kiro/hooks/contour-autoload-spec.json`](skills/.kiro/hooks/contour-autoload-spec.json)
  — a Kiro hook that loads `contour.md` into the agent's context when a
  prompt asks to model or verify with Contour.

The skills are written for Kiro; to use them, copy `skills/.kiro` into
your workspace's `.kiro` folder. Their instructions are plain Markdown
and work as a system prompt or skill in other agents too.

## Building contour-engine from the model

`engine/contour-engine.yaml` is a Contour spec, not documentation of
existing code — it is meant to be built from directly by an LLM agent,
the way the experiments did it. This is the top-down direction run to
completion.

1. **Put the framework paper in the agent's context.** Load
   [`contour.md`](contour.md) — as a file reference, a pasted-in doc, or
   a skill — so the agent knows how to read a Contour record before it
   sees the spec itself.
2. **Prompt it to generate the System from the spec**, naming the
   application framework you want, e.g.:

   > Generate the Contour system from specification
   > `engine/contour-engine.yaml` using Spring Boot.

   or, for a second independent build to compare against:

   > Generate the Contour system from specification
   > `engine/contour-engine.yaml` using Python/FastAPI.

3. **Let the record drive the build.** The System's Functions are what
   to build — the core (store, retrieve, delete, validate, check,
   search, render) and, for the Console, a view and a create-or-modify
   Function per element type. The one Component, `contour-engine`,
   performs them all and owns all data; each Interface's `binding` and
   `exposes` say how each caller reaches them — the Console as a Web
   UI on Material UI, the MCP Server as tools; a Function's `steps` and
   outcomes give its behavior. Requirements and Guardrails are
   enforceable obligations, not prose — e.g. the **One Core For Every
   Actor** guardrail means the Console and the MCP Server are thin
   channels over one shared service layer, not independent
   implementations; **Ownership Relations Are Stored** means a name in
   a record and its relationship edge never disagree; and **Gaps Never
   Block A Write** means validation rejects a write only for a
   contradiction.
4. **Expect physical-shape decisions the record won't make for you.**
   The record specifies logical content (e.g. that search must be
   full-text and indexed) but not implementation shape (e.g. a
   functional index vs. a generated column) — two independent builds
   from the same record are free to diverge here.
5. **Verify behaviorally**, by exercising the built Interfaces live and
   checking Guardrails as direct runtime assertions — the
   `contour-verify` skill does this against the record — rather than
   relying on unit tests alone to define correctness.

Before building, the model itself should check clean:
`python3 skills/contour-check.py engine/contour-engine.yaml` reports
0 contradictions and 0 gaps.

See [`experiments/contour-experiments.md`](experiments/contour-experiments.md)
for the full account of building `contour-engine` (Java/Spring Boot) and
a second, independent `contour-engine-py` (Python/FastAPI) from an
earlier version of this record, and what diverged between them.

## Connecting an agent to the engine

A running contour-engine serves its MCP Server at
`http://localhost:8000/mcp`. To give an agent its tools — which the
`contour-reverse` and `contour-verify` skills use to read and write
records — add this entry under `mcpServers` in the agent's MCP
configuration (for Kiro, `.kiro/settings/mcp.json`):

```json
"contour-engine": {
    "disabled": false,
    "command": "npx",
    "args": [
        "mcp-remote", "http://localhost:8000/mcp"
    ]
}
```

`mcp-remote` bridges the engine's streamable-HTTP endpoint to agents
that launch MCP servers as local commands; it needs Node.js for `npx`.
Change the URL if the engine runs on another host or port.

## Status

This is a personal working paper (current version: **v0.5**, noted in
`contour.md`), not a finished standard. The goal is to pressure-test
whether a model this small still says enough to guide a change into
code correctly.
