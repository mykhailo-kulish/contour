// Contour MCP Server — Model Context Protocol access for AI Agents, reading and
// storing Contour specifications as tools. Serves the AI Agent. Same engine
// Functions (core/service) as the Console — one core for every actor.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as svc from "../core/service.js";
import { checkModel } from "../core/checkModel.js";
import { exportGraph } from "../core/render.js";
import {
  ElementRejected, InvalidDefinition, NameTaken, NoSuchRevision, NotFound, StillReferenced,
} from "../core/errors.js";
import type { ElementRow, DefinitionRow, RelationshipRow } from "../core/service.js";

const el = (e: ElementRow) => ({
  id: e.id, name: e.name, version: e.version, systemId: e.system_id, elementType: e.element_type,
});
const rel = (r: RelationshipRow) => ({
  id: r.id, fromElementId: r.from_element_id, toElementId: r.to_element_id, verb: r.verb,
  from: { id: r.from_element_id, name: r.from_name, elementType: r.from_type, systemId: r.from_system_id },
  to: { id: r.to_element_id, name: r.to_name, elementType: r.to_type, systemId: r.to_system_id },
});
const def = (d: DefinitionRow) => ({ id: d.id, name: d.name, description: d.description, version: d.version });
const text = (obj: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(obj, null, 2) }] });

export function buildMcpServer(): McpServer {
  const mcp = new McpServer({ name: "contour-engine", version: "0.5.0" });

  mcp.tool("store_element",
    "Store one Contour element — its record and the relationships where it is the 'from' side. Every element but a System names its System (systemId); names are unique within a System. Record references (groups, performs, owns, produces, exposes, an Actor's uses, a Function's steps) and outgoing edges are reconciled both ways. Validates, persists, announces.",
    {
      name: z.string(), elementType: z.string(),
      record: z.record(z.any()).optional(), relationships: z.array(z.record(z.any())).optional(),
      id: z.string().optional(), systemId: z.string().optional(),
      changeNote: z.string().optional(),
    },
    async (a) => {
      try {
        const el2 = await svc.storeElement({
          element: { id: a.id, name: a.name, elementType: a.elementType as never, systemId: a.systemId },
          record: a.record ?? {}, relationships: (a.relationships ?? []) as never,
          changeNote: a.changeNote, changedBy: "Contour MCP Server",
        });
        return text({ outcome: "Stored", element: el(el2) });
      } catch (e) {
        if (e instanceof ElementRejected) return text({ outcome: "Rejected", violations: e.violations });
        throw e;
      }
    });

  mcp.tool("delete_element", "Remove one stored element, its record and every relationship referencing it.",
    { id: z.string() },
    async (a) => text({ outcome: (await svc.deleteElement(a.id)) ? "Deleted" : "Already Absent" }));

  mcp.tool("retrieve_element", "Return one stored element by id — its record plus immediate relationships.",
    { id: z.string() },
    async (a) => {
      try {
        const { element, record, relationships } = await svc.retrieveElement(a.id);
        return text({
          outcome: "Found", element: el(element),
          record: record ? { id: record.id, elementId: record.element_id, body: record.body } : null,
          relationships: relationships.map(rel),
        });
      } catch (e) {
        if (e instanceof NotFound) return text({ outcome: "Not Found", detail: String(e.message) });
        throw e;
      }
    });

  mcp.tool("retrieve_elements",
    "Return the full records of a set of elements by id in a bounded number of queries (not one per element): each found element with its record and immediate relationships. Ids with no element are simply absent.",
    { ids: z.array(z.string()) },
    async (a) => {
      const got = await svc.retrieveElements(a.ids);
      return text({
        outcome: "Found",
        items: got.map((g) => ({
          element: el(g.element),
          record: g.record ? { id: g.record.id, elementId: g.record.element_id, body: g.record.body } : null,
          relationships: g.relationships.map(rel),
        })),
      });
    });

  mcp.tool("retrieve_system_scope",
    "Return a light, batch index of one System's scope — the System and every element in it — for building the System's tree. Each entry carries only the summary (id, name, elementType) and the record's reference lists the tree nests by (uses, requirements, guardrails); no full record body and no relationships (fetch those per element with retrieve_element). Read in a bounded number of queries, not one per element.",
    { systemId: z.string() },
    async (a) => {
      try { return text({ outcome: "Retrieved", ...(await svc.retrieveSystemScope(a.systemId)) }); }
      catch (e) { if (e instanceof NotFound) return text({ outcome: "System Not Found", detail: String(e.message) }); throw e; }
    });

  mcp.tool("check_model_tool", "Check one stored System — everything scoped to it: contradictions and gaps, separately.",
    { systemId: z.string() },
    async (a) => {
      if (!(await svc.systemExists(a.systemId))) return text({ outcome: "System Not Found" });
      const { contradictions, gaps } = await checkModel(a.systemId);
      return text({ outcome: "Checked", contradictions, gaps });
    });

  mcp.tool("diff_element",
    "Compare two stored revisions of one element (a System included) and return a typed, field-keyed delta — what changed in the record keyed by its own fields and relationship verbs, each change carrying a code implication — plus the from/to bodies. Read-only; use the version integers from an element's history.",
    { id: z.string(), fromVersion: z.number(), toVersion: z.number() },
    async (a) => {
      try {
        const d = await svc.diffElement(a.id, a.fromVersion, a.toVersion);
        return text({ outcome: "Diffed", ...d });
      } catch (e) {
        if (e instanceof NotFound) return text({ outcome: "Not Found", detail: e.message });
        if (e instanceof NoSuchRevision) return text({ outcome: "No Such Revision", detail: e.message });
        throw e;
      }
    });

  mcp.tool("store_requirement", "Store one Requirement definition — id, name, description.",
    { id: z.string(), name: z.string(), description: z.string() },
    async (a) => {
      try { return text({ outcome: "Stored", requirement: def(await svc.storeRequirement(a.id, a.name, a.description)) }); }
      catch (e) {
        if (e instanceof InvalidDefinition) return text({ outcome: "Invalid", detail: e.message });
        if (e instanceof NameTaken) return text({ outcome: "Name Taken", detail: e.message });
        throw e;
      }
    });

  mcp.tool("retrieve_requirement", "Return one Requirement definition by name.",
    { name: z.string() },
    async (a) => {
      try { return text({ outcome: "Found", requirement: def(await svc.retrieveRequirement(a.name)) }); }
      catch (e) { if (e instanceof NotFound) return text({ outcome: "Not Found", detail: e.message }); throw e; }
    });

  mcp.tool("delete_requirement", "Remove one Requirement definition.",
    { name: z.string() },
    async (a) => {
      try { return text({ outcome: (await svc.deleteRequirement(a.name)) ? "Deleted" : "Already Absent" }); }
      catch (e) { if (e instanceof StillReferenced) return text({ outcome: "Still Referenced", detail: e.message }); throw e; }
    });

  mcp.tool("store_guardrail", "Store one Guardrail definition — id, name, description.",
    { id: z.string(), name: z.string(), description: z.string() },
    async (a) => {
      try { return text({ outcome: "Stored", guardrail: def(await svc.storeGuardrail(a.id, a.name, a.description)) }); }
      catch (e) {
        if (e instanceof InvalidDefinition) return text({ outcome: "Invalid", detail: e.message });
        if (e instanceof NameTaken) return text({ outcome: "Name Taken", detail: e.message });
        throw e;
      }
    });

  mcp.tool("retrieve_guardrail", "Return one Guardrail definition by name.",
    { name: z.string() },
    async (a) => {
      try { return text({ outcome: "Found", guardrail: def(await svc.retrieveGuardrail(a.name)) }); }
      catch (e) { if (e instanceof NotFound) return text({ outcome: "Not Found", detail: e.message }); throw e; }
    });

  mcp.tool("delete_guardrail", "Remove one Guardrail definition.",
    { name: z.string() },
    async (a) => {
      try { return text({ outcome: (await svc.deleteGuardrail(a.name)) ? "Deleted" : "Already Absent" }); }
      catch (e) { if (e instanceof StillReferenced) return text({ outcome: "Still Referenced", detail: e.message }); throw e; }
    });

  mcp.tool("search_specifications", "Find stored elements by free text and structural filters, one page at a time.",
    {
      query: z.string().optional(), elementType: z.string().optional(), name: z.string().optional(),
      exactName: z.string().optional(),
      systemId: z.string().optional(), componentId: z.string().optional(),
      page: z.number().optional(), pageSize: z.number().optional(),
    },
    async (a) => text({ outcome: "Found", ...(await svc.searchSpecifications(a)) }));

  mcp.tool("search_requirements", "Find Requirement definitions by free text.",
    { query: z.string() },
    async (a) => text({ outcome: "Found", items: (await svc.searchRequirements(a.query)).map(def) }));

  mcp.tool("search_guardrails", "Find Guardrail definitions by free text.",
    { query: z.string() },
    async (a) => text({ outcome: "Found", items: (await svc.searchGuardrails(a.query)).map(def) }));

  mcp.tool("resolve_requirements", "Resolve Requirement definitions by an exact set of names in one query (not one lookup per name). Names with no match are simply absent.",
    { names: z.array(z.string()) },
    async (a) => text({ outcome: "Resolved", items: (await svc.resolveRequirements(a.names)).map(def) }));

  mcp.tool("resolve_guardrails", "Resolve Guardrail definitions by an exact set of names in one query (not one lookup per name). Names with no match are simply absent.",
    { names: z.array(z.string()) },
    async (a) => text({ outcome: "Resolved", items: (await svc.resolveGuardrails(a.names)).map(def) }));

  mcp.tool("export_graph", "Export one stored element as a neutral graph (nodes + edges in Contour's own vocabulary, no notation): a System id yields the whole-System graph, any other element id yields a graph scoped to that element and its relationships. One-way and lossy (Contour §4) — a consumer turns the graph into views; the engine draws nothing.",
    { id: z.string() },
    async (a) => {
      try { return text({ outcome: "Exported", graph: await exportGraph(a.id) }); }
      catch (e) { if (e instanceof NotFound) return text({ outcome: "Not Found" }); throw e; }
    });

  return mcp;
}
