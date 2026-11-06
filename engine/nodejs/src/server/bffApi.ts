// The Console (Web UI) binding transport, folded into the engine.
//
// This is NOT a modeled Interface and NOT a public REST API — it is the
// transport of the built-in Console (the Meanings UI, now the engine's own
// Console) over the one core (core/service). It calls exactly the same engine
// Functions the MCP Server and the old /ui-api binding call, in-process. There
// is no service hop: the Console's Functions (Explore Models, Open Model, Read
// Element, Save Element, Check Model in View, Define Requirement or Guardrail)
// are performed here, each calling the core Functions directly.
//
// The route shapes and error contract match what the Console UI (src/ui/api.js)
// expects: 404 -> NotFound, 422 { violations } -> Rejected, 503 -> Catalog
// Unavailable (an in-process core has no "unreachable", so 503 is effectively
// unreachable here and kept only for transport parity).
import type { FastifyInstance, FastifyReply } from "fastify";
import * as svc from "../core/service.js";
import { checkModel } from "../core/checkModel.js";
import { exportGraph } from "../core/render.js";
import {
  ElementRejected, InvalidDefinition, NameTaken, NotFound,
} from "../core/errors.js";
import type { ElementRow, DefinitionRow, RelationshipRow, RecordRow } from "../core/service.js";

const el = (e: ElementRow) => ({
  id: e.id, name: e.name, version: e.version, systemId: e.system_id, elementType: e.element_type,
});
const rel = (r: RelationshipRow) => ({
  id: r.id, fromElementId: r.from_element_id, toElementId: r.to_element_id, verb: r.verb,
  from: { id: r.from_element_id, name: r.from_name, elementType: r.from_type, systemId: r.from_system_id },
  to: { id: r.to_element_id, name: r.to_name, elementType: r.to_type, systemId: r.to_system_id },
});
const def = (d: DefinitionRow) => ({ id: d.id, name: d.name, description: d.description, version: d.version });
const recordDto = (record: RecordRow | null) =>
  record ? { id: record.id, elementId: record.element_id, body: record.body } : null;

// Translate a core failure into the HTTP shape the Console UI expects.
function fail(reply: FastifyReply, e: unknown) {
  if (e instanceof NotFound) return reply.code(404).send({ outcome: "Not Found" });
  if (e instanceof ElementRejected) return reply.code(422).send({ outcome: "Rejected", violations: e.violations });
  if (e instanceof InvalidDefinition) return reply.code(422).send({ outcome: "Rejected", violations: [e.message] });
  if (e instanceof NameTaken) return reply.code(422).send({ outcome: "Rejected", violations: [e.message] });
  throw e;
}

export async function registerBffApi(app: FastifyInstance): Promise<void> {
  // --- Explore Models -> Search Specifications ---
  app.get("/bff/explore", async (req, reply) => {
    try {
      const q = req.query as Record<string, string>;
      const { items, total } = await svc.searchSpecifications({
        query: q.query, elementType: q.elementType, name: q.name, systemId: q.systemId,
        page: q.page ? Number(q.page) : 1, pageSize: q.pageSize ? Number(q.pageSize) : 20,
      });
      return { items, total };
    } catch (e) {
      return fail(reply, e);
    }
  });

  // --- Open Model -> Retrieve System Scope ---
  // The System plus a light index of every element in its scope (summary + the
  // uses/requirements/guardrails reference lists the tree nests by; no bodies,
  // no relationships). Tree Loads Without Per-Element Fetches.
  app.get("/bff/model/:systemId", async (req, reply) => {
    try {
      const { system, elements } = await svc.retrieveSystemScope((req.params as { systemId: string }).systemId);
      return { system, elements };
    } catch (e) {
      return fail(reply, e);
    }
  });

  // --- Read Element -> Retrieve Element ---
  // One element's full record and relationships, to populate the editor form.
  app.get("/bff/elements/:id", async (req, reply) => {
    try {
      const { element, record, relationships } = await svc.retrieveElement((req.params as { id: string }).id);
      return { element: el(element), record: recordDto(record), relationships: relationships.map(rel) };
    } catch (e) {
      return fail(reply, e);
    }
  });

  // --- Read Element -> Retrieve Elements (cross-reference hydration) ---
  // The full records of a set of elements in one batch call, to hydrate an
  // opened element's cross-reference set for the inspector (Elements Load In
  // Bounded Queries) — not one request per neighbour.
  app.post("/bff/elements/batch", async (req, reply) => {
    try {
      const ids = ((req.body as { ids?: string[] })?.ids) || [];
      const got = await svc.retrieveElements(ids);
      return got.map((g) => ({
        element: el(g.element), record: recordDto(g.record), relationships: g.relationships.map(rel),
      }));
    } catch (e) {
      return fail(reply, e);
    }
  });

  // --- Read Element -> Export Graph (Diagram View) ---
  // The neutral node/edge graph for one element; a Function yields the
  // step-ordered, depth-resolved Function View. The Console draws it with Mermaid.
  app.get("/bff/graph/:id", async (req, reply) => {
    try {
      return { graph: await exportGraph((req.params as { id: string }).id) };
    } catch (e) {
      return fail(reply, e);
    }
  });

  // --- Search Requirements / Search Guardrails ---
  app.get("/bff/requirements", async (req, reply) => {
    try {
      const q = req.query as Record<string, string>;
      return (await svc.searchRequirements(q.query || "")).map(def);
    } catch (e) {
      return fail(reply, e);
    }
  });
  app.get("/bff/guardrails", async (req, reply) => {
    try {
      const q = req.query as Record<string, string>;
      return (await svc.searchGuardrails(q.query || "")).map(def);
    } catch (e) {
      return fail(reply, e);
    }
  });

  // --- Open Model -> Resolve Requirements / Resolve Guardrails ---
  // Batch-resolve the definitions the tree references by exact name, in one
  // query each (Definitions Resolve In One Query) — so opening a model issues a
  // fixed, small number of requests instead of one Search per distinct name.
  app.post("/bff/requirements/resolve", async (req, reply) => {
    try {
      const names = ((req.body as { names?: string[] })?.names) || [];
      return (await svc.resolveRequirements(names)).map(def);
    } catch (e) {
      return fail(reply, e);
    }
  });
  app.post("/bff/guardrails/resolve", async (req, reply) => {
    try {
      const names = ((req.body as { names?: string[] })?.names) || [];
      return (await svc.resolveGuardrails(names)).map(def);
    } catch (e) {
      return fail(reply, e);
    }
  });

  // --- Save Element -> Store Element (create; a new element has no id) ---
  app.post("/bff/elements", async (req, reply) => {
    try {
      const stored = await svc.storeElement({ ...(req.body as object), changedBy: "Contour Console" } as never);
      return { outcome: "Saved", element: el(stored) };
    } catch (e) {
      return fail(reply, e);
    }
  });

  // --- Save Element -> Store Element (update: body carries element.id) ---
  app.post("/bff/elements/:id", async (req, reply) => {
    try {
      const stored = await svc.storeElement({ ...(req.body as object), changedBy: "Contour Console" } as never);
      return { outcome: "Saved", element: el(stored) };
    } catch (e) {
      return fail(reply, e);
    }
  });

  // --- Check Model in View -> Check Model ---
  app.get("/bff/check/:systemId", async (req, reply) => {
    try {
      const systemId = (req.params as { systemId: string }).systemId;
      if (!(await svc.systemExists(systemId))) return reply.code(404).send({ outcome: "No Such System" });
      return await checkModel(systemId);
    } catch (e) {
      return fail(reply, e);
    }
  });

  // --- Define Requirement or Guardrail -> Store Requirement / Store Guardrail ---
  app.put("/bff/requirements/:id", async (req, reply) => {
    try {
      const body = req.body as { name: string; description: string };
      const r = await svc.storeRequirement((req.params as { id: string }).id, body.name, body.description);
      return { outcome: "Defined", definition: def(r) };
    } catch (e) {
      return fail(reply, e);
    }
  });
  app.put("/bff/guardrails/:id", async (req, reply) => {
    try {
      const body = req.body as { name: string; description: string };
      const g = await svc.storeGuardrail((req.params as { id: string }).id, body.name, body.description);
      return { outcome: "Defined", definition: def(g) };
    } catch (e) {
      return fail(reply, e);
    }
  });
}
