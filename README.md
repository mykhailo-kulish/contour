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

`contour-engine.yaml` is a Contour spec, not documentation of existing
code — it's meant to be built from directly by an LLM agent, the way
Section 8's experiments did it. The workflow:

1. **Put the framework paper in the agent's context.** Load
   [`contour.md`](contour.md) into your LLM agent's context — as a file
   reference, a pasted-in doc, or a skill (e.g. a Kiro skill, a Claude
   Code skill, a system prompt attachment) — so the agent knows how to
   read a Contour record before it sees the spec itself.
2. **Prompt it to generate the system from the spec**, naming the
   application framework you want it built in, e.g.:

   > Generate the Contour system from specification `contour-engine.yaml`
   > using Spring Boot.

   or, for a second independent build to compare against:

   > Generate the Contour system from specification `contour-engine.yaml`
   > using Python/FastAPI.

3. **Let the record drive the build.** With `contour.md` in context, the
   agent should read `contour-engine.yaml` top-down — the `System`
   groups two `Component`s (`contour-engine`, the backend, and
   `contour-engine-ui`, the console); each Component's `functions`,
   `interfaces`, `dataObjects`, and `events` are what to build; a
   Function's `steps` give its ordered behavior — and treat the
   top-level `requirements` and `guardrails` as enforceable obligations,
   not prose (e.g. `contour-engine`'s **Interfaces Share One Core**
   guardrail means the REST and MCP interfaces must be two thin surfaces
   over one shared service layer, not independent implementations).
4. **Expect physical-shape decisions the record won't make for you.**
   The record specifies logical content (e.g. that search must be
   full-text and indexed) but not implementation shape (e.g. a
   functional index vs. a generated column) — two independent builds
   from the same record are free to diverge here, which was the one
   reproducible failure in Section 8.2's experiment.
5. **Verify behaviorally**, by exercising the built REST/MCP interfaces
   live and checking Guardrails as direct runtime assertions, rather
   than relying on unit tests alone to define correctness.

See [Section 8](contour.md#8-preliminary-experiment-results) of
`contour.md` for the full account of building `contour-engine` (Java/
Spring Boot) and a second, independent `contour-engine-py` (Python/
FastAPI) from this same record, and what diverged between them.

## Status

This is a personal working paper (current version noted in `contour.md`),
not a finished standard. The goal is to pressure-test whether a model
this small still says enough to guide a change into code correctly.
