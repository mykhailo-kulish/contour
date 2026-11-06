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
verbs, across two levels of detail, with a structured record under each
element for behavior, schemas and contracts. Diagrams are generated or
exported, not part of the model.

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
engine/                     the contour-engine model and its implementations (see engine/README.md)
example/                    worked examples and their companion walkthrough
experiments/                evidence log, roadmap and experiment notes
skills/                     the checker and agent skills that apply Contour
```

### The framework

- [`contour.md`](contour.md) — the specification: motivation, design
  principles, metamodel, interoperability (C4 / LikeC4, ArchiMate), a worked example, limitations and
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
  Actors from the same runtime: the Modeler through **Meanings**, the
  engine's built-in browser Console — a form-based Web UI with a model
  tree, a per-element-type editor, and an inspector of what is wrong and
  what is still to fill in, with a Form/Diagram toggle that shows each
  element's generated diagram — and the AI Agent through the **Contour
  MCP Server**, as tools. It is meant to be **built from** — see
  [`engine/README.md`](engine/README.md) for how to build it, run it
  locally, and connect an agent, plus the NodeJS implementation under
  [`engine/nodejs/`](engine/nodejs/).
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

Two agent skills and one hook, in two editions with the same
instructions — one for **Kiro**, one for **Claude Code**:

- **`contour-reverse`** — reverse-engineers a Contour record from a
  codebase (the bottom-up direction), writing it to a local YAML model
  or into a running contour-engine through its MCP tools.
- **`contour-verify`** — verifies a codebase against an existing record:
  structure, behavior, and every referenced Requirement and Guardrail.
- **autoload hook** — loads `contour.md` into the agent's context, once
  per session, when a prompt asks to model or verify with Contour.

| | Kiro | Claude Code |
|---|---|---|
| `contour-reverse` | [`skills/.kiro/skills/contour-reverse`](skills/.kiro/skills/contour-reverse/SKILL.md) | [`skills/.claude/skills/contour-reverse`](skills/.claude/skills/contour-reverse/SKILL.md) |
| `contour-verify` | [`skills/.kiro/skills/contour-verify`](skills/.kiro/skills/contour-verify/SKILL.md) | [`skills/.claude/skills/contour-verify`](skills/.claude/skills/contour-verify/SKILL.md) |
| autoload hook | [`skills/.kiro/hooks/contour-autoload-spec.json`](skills/.kiro/hooks/contour-autoload-spec.json) | [`skills/.claude/settings.json`](skills/.claude/settings.json) → [`hooks/contour-autoload-spec.py`](skills/.claude/hooks/contour-autoload-spec.py) |
| install | copy `skills/.kiro` into the workspace's `.kiro` folder | copy `skills/.claude` into the project's `.claude` folder, merging `settings.json` if one exists |

The Claude Code skills are the Kiro skills with the engine's MCP tool
names in Claude Code's form (`mcp__contour-engine__…` instead of
`mcp_contour_engine_…`). In Claude Code they run when a request matches
their description, or directly as `/contour-reverse` and
`/contour-verify`. Both hooks expect `contour.md` at the project root.

## The contour-engine

`engine/contour-engine.yaml` is a Contour spec meant to be **built from**, not
documentation of existing code. The [`engine/`](engine/) folder holds that
implementation-agnostic model and one or more concrete implementations of it
(currently a NodeJS one under [`engine/nodejs/`](engine/nodejs/)).

See [`engine/README.md`](engine/README.md) for how to build the engine from the
model with an LLM agent, run it locally (`docker compose up --build` from
`engine/`), and connect Kiro or Claude Code to its MCP Server. The build account
for earlier, independent Java/Spring Boot and Python/FastAPI builds is in
[`experiments/contour-experiments.md`](experiments/contour-experiments.md).

Before building, the model itself should check clean:
`python3 skills/contour-check.py engine/contour-engine.yaml` reports
0 contradictions and 0 gaps.

## Status

This is a personal working paper (current version: **v0.6**, noted in
`contour.md`), not a finished standard. The goal is to pressure-test
whether a model this small still says enough to guide a change into
code correctly.
