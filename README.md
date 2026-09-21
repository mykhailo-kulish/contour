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

## Status

This is a personal working paper (current version noted in `contour.md`),
not a finished standard. The goal is to pressure-test whether a model
this small still says enough to guide a change into code correctly.
