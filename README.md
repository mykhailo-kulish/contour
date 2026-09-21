# Contour

**A lightweight framework for modeling software system architecture.**

Contour defines the logical boundary of a software system — what it does,
the data it shares, and the interfaces it exposes and depends on — as a
business-readable structure precise enough to guide a described change
into actual code. It is meant to serve three audiences at once: a
non-developer describing a change in business language, a developer
turning that into a safe change, and an LLM doing the same, using the
model as its specification and its boundary.

The framework models a **System** as one or more **Components**, each
with its own lifecycle, using seven element types and nine relationship
verbs across two levels of detail: a compact diagram for shape, and a
structured record underneath for behavior, schemas, and contracts.

**Author:** Mykhailo Kulish ([LinkedIn](https://www.linkedin.com/in/mkulish/))

## Contents

- [`contour.md`](contour.md) — the framework specification: motivation,
  design principles, metamodel, notation, a worked example, and a
  preliminary experiment applying Contour to propagate a change into code.
- [`contour.schema.json`](contour.schema.json) — the JSON Schema for
  Contour's structured-record style, defining how System, Component,
  Function, Interface, Event, Data Object, Actor, Requirement, and
  Guardrail elements are expressed as data.
- [`contour-engine.yaml`](contour-engine.yaml) — a worked Contour model of
  the `contour-engine` system itself (a backend engine and console UI for
  storing, searching, and managing Contour specifications), used as a
  realistic example of the structured-record format.

## Building contour-engine from the YAML

`contour-engine.yaml` is not documentation of an existing system — it is
a spec meant to be built from directly, the way Section 8's experiments
did it. That "build from spec" workflow:

1. **Validate the record against the schema first.** `contour-engine.yaml`
   should validate against [`contour.schema.json`](contour.schema.json)
   before any code is written from it — any 2020-12 JSON Schema validator
   that accepts YAML input works (e.g. `check-jsonschema`, `ajv`).
2. **Hand the record to a developer or an LLM as the only spec.** Read it
   top-down: the `System` groups two `Component`s (`contour-engine`, the
   backend, and `contour-engine-ui`, the console); each Component's
   `functions`, `interfaces`, `dataObjects`, and `events` are what to
   build; a Function's `steps` (`calls` / `reads` / `modifies` /
   `produces` / `uses`) give its ordered behavior. Nothing outside the
   record should shape the implementation — no pointing at existing code,
   since there isn't any yet.
3. **Treat `requirements` and `guardrails` as enforceable, not prose.**
   Each top-level `Requirement` and `Guardrail` definition is referenced
   by name from the elements it applies to — implement and test against
   them directly (e.g. `contour-engine`'s **Interfaces Share One Core**
   guardrail means the REST and MCP interfaces must be two thin surfaces
   over one shared service layer, not two independent implementations of
   the same Functions).
4. **Expect physical-shape decisions the record won't make for you.**
   The record specifies logical content (e.g. that search must be
   full-text and indexed) but not implementation shape (e.g. a functional
   index vs. a generated column). Pick one consistently and document the
   choice outside the record, since two independent builds from the same
   record are otherwise free to disagree here — this was the one
   reproducible failure in Section 8.2's experiment.
5. **Verify behaviorally, against the record, not just against tests you
   wrote.** Section 8's experiments confirmed a build by exercising it
   live (calling the REST/MCP interfaces, checking cross-Component
   behavior) and by checking Guardrails as direct runtime assertions
   (e.g. that the search Function never modifies a Data Object), rather
   than relying on unit tests alone to define correctness.

See [Section 8](contour.md#8-preliminary-experiment-results) of
`contour.md` for the full account of building `contour-engine` (Java/
Spring Boot) and a second, independent `contour-engine-py` (Python/
FastAPI) from this same record, and what diverged between them.

## Status

This is a personal working paper (current version noted in `contour.md`),
not a finished standard. The goal is to pressure-test whether a model
this small still says enough to guide a change into code correctly.
