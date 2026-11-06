# contour-engine

The **contour-engine** is a Contour System: it stores, validates, checks,
searches and exports Contour specifications and owns all Contour data. It serves
two Actors from the same runtime — the **Modeler** through the **Contour
Console** (a form-based Web UI) and the **AI Agent** through the **Contour MCP
Server** (as tools).

This folder holds the engine's **implementation-agnostic model** and one or more
concrete **implementations** of it:

```
engine/
  contour-engine.yaml    the Contour model of the engine — the thing to build from
  docker-compose.yml     local start composition (engine + PostgreSQL)
  nodejs/                the NodeJS implementation (TypeScript core, Fastify, React Console)
```

The model (`contour-engine.yaml`) is the authority and names no technology; each
subfolder (e.g. [`nodejs/`](nodejs/)) is one way to realize it. Other
implementations can sit beside `nodejs/` without changing the model.

## The model

[`contour-engine.yaml`](contour-engine.yaml) is a Contour spec, not documentation
of existing code — one deployable Component, `contour-engine`, that performs
every Function and owns all data, with two Interfaces (`Contour Console` Web UI,
`Contour MCP Server` tools) over one core. Before building or after changing it,
the model should check clean:

```
python3 ../skills/contour-check.py contour-engine.yaml
```

(0 contradictions and 0 gaps.)

## The Console

The Modeler works in a three-pane, form-based Web UI (dark theme) served at
`/` by the engine itself — no separate front-end product, the same core the MCP
Server uses:

- **Model tree** (left) — every System as a root, expanded into its Actors and
  their Functions plus the System's Data Objects, Events, Requirements and
  Guardrails. Each row shows a status dot: green complete, amber has gaps, red
  contradicts.
- **Editor** (center) — a form shaped per element kind: a Function's ordered
  steps, outcomes and behavior; a Data Object's or Event's schema in Contour
  notation; an Actor's used Functions; name, description and the attached
  Requirements and Guardrails. A **Form / Diagram toggle** switches the center
  pane to a read-only **Diagram View** of the selected element's graph (the
  engine's `Export Graph` rendered with Mermaid): the whole-System graph for a
  System, a step-ordered Function View for a Function. The Diagram View can be
  zoomed, fitted to the frame, panned by dragging, and expanded to full screen;
  clicking a node highlights that node and its **downstream path** — the
  elements it reaches by following relationships in their direction, in full
  depth — leaving the rest as they are.
- **Inspector** (right) — what is *wrong* (contradictions, red) kept separate
  from what is *still to fill in* (gaps, amber), plus a references panel (used
  by / applies to / used by Functions). The top bar's **Check model** button is
  the core's authoritative verdict.

Every edit is written through the core's validated Functions (gaps never block a
save; only a contradiction is refused), so the Console never persists or
validates on its own.

## Running it locally

The local start composition brings up the engine and PostgreSQL. From this
`engine/` folder:

```bash
docker compose up --build
```

- Console (Web UI): http://localhost:8000/
- MCP endpoint (streamable HTTP): http://localhost:8000/mcp
- Health: http://localhost:8000/health

Tear down (and wipe the database volume):

```bash
docker compose down -v
```

The composition builds `./nodejs`; see [`nodejs/`](nodejs/) for that
implementation's own sources, Dockerfile and developer workflow.

## Building contour-engine from the model

`contour-engine.yaml` is meant to be **built from** directly by an LLM agent, the
way the experiments did it. This is the top-down direction run to completion.

1. **Put the framework paper in the agent's context.** Load
   [`../contour.md`](../contour.md) — as a file reference, a pasted-in doc, or a
   skill — so the agent knows how to read a Contour record before it sees the
   spec itself.
2. **Prompt it to generate the System from the spec**, naming the application
   framework you want, e.g.:

   > Generate the Contour system from specification
   > `engine/contour-engine.yaml` using Spring Boot.

   or, for a second independent build to compare against:

   > Generate the Contour system from specification
   > `engine/contour-engine.yaml` using Python/FastAPI.

3. **Let the record drive the build.** The System's Functions are what to build —
   the core (store, retrieve, delete, validate, check, search, render) and, for
   the Console, a view and a create-or-modify Function per element type. The one
   Component, `contour-engine`, performs them all and owns all data; each
   Interface's `binding` and `exposes` say how each caller reaches them — the
   Console as a Web UI, the MCP Server as tools; a Function's `steps` and outcomes
   give its behavior. Requirements and Guardrails are enforceable obligations, not
   prose — e.g. the **One Core For Every Actor** guardrail means the Console and
   the MCP Server are thin channels over one shared service layer, not independent
   implementations; **Ownership Relations Are Stored** means a name in a record
   and its relationship edge never disagree; and **Gaps Never Block A Write**
   means validation rejects a write only for a contradiction.
4. **Expect physical-shape decisions the record won't make for you.** The record
   specifies logical content (e.g. that search must be full-text and indexed) but
   not implementation shape (e.g. a functional index vs. a generated column) — two
   independent builds from the same record are free to diverge here.
5. **Verify behaviorally**, by exercising the built Interfaces live and checking
   Guardrails as direct runtime assertions — the `contour-verify` skill does this
   against the record — rather than relying on unit tests alone to define
   correctness.

See [`../experiments/contour-experiments.md`](../experiments/contour-experiments.md)
for the full account of building `contour-engine` (Java/Spring Boot) and a second,
independent `contour-engine-py` (Python/FastAPI) from an earlier version of this
record, and what diverged between them. The [`nodejs/`](nodejs/) implementation in
this folder is another such build.

## Connecting an agent to the engine

A running contour-engine serves its MCP Server at `http://localhost:8000/mcp`.
The `contour-reverse` and `contour-verify` skills use its tools to read and write
records; register it under the name `contour-engine`, which is the name the
skills' tool references assume. Change the URL if the engine runs on another host
or port.

**Kiro** — add this entry under `mcpServers` in the workspace's MCP configuration
(`.kiro/settings/mcp.json`):

```json
"contour-engine": {
    "disabled": false,
    "command": "npx",
    "args": [
        "mcp-remote", "http://localhost:8000/mcp"
    ]
}
```

`mcp-remote` bridges the engine's streamable-HTTP endpoint to agents that launch
MCP servers as local commands; it needs Node.js for `npx`.

**Claude Code** — connects to HTTP MCP servers directly, so no bridge is needed.
Add it for the project from the command line:

```
claude mcp add --transport http --scope project contour-engine http://localhost:8000/mcp
```

or write the same into `.mcp.json` at the project root:

```json
{
  "mcpServers": {
    "contour-engine": {
      "type": "http",
      "url": "http://localhost:8000/mcp"
    }
  }
}
```

Claude Code asks for approval before first using a project-scoped server. Its
tools then appear as `mcp__contour-engine__store_element`,
`mcp__contour-engine__check_model` and so on.
