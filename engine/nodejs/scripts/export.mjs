// Export a stored Contour System from a running contour-engine (via its MCP
// server) back into the authoring YAML schema that scripts/ingest.mjs consumes.
// The inverse of ingest.mjs: read the System's scope and every element's full
// record, then emit the nested System document (components/functions/dataObjects/
// events/interfaces under the System; Actor/Requirement/Guardrail at top level).
//
// Usage:
//   node scripts/export.mjs <System name> <outFile> [http://localhost:8000/mcp]
// e.g.
//   node scripts/export.mjs Contour ../contour-engine.yaml http://localhost:8000/mcp
//   (run from engine/nodejs; the record lives one level up at engine/contour-engine.yaml)
import { writeFileSync } from "node:fs";

const SYSTEM_NAME = process.argv[2];
const OUT = process.argv[3];
const MCP_URL = process.argv[4] || "http://localhost:8000/mcp";

if (!SYSTEM_NAME || !OUT) {
  console.error("Usage: node scripts/export.mjs <System name> <outFile> [mcpUrl]");
  process.exit(1);
}

let stringifyYaml;
try {
  ({ stringify: stringifyYaml } = await import("yaml"));
} catch {
  console.error("Please `npm i -D yaml` to run the export script.");
  process.exit(1);
}

let rpcId = 0;
async function call(tool, args) {
  rpcId += 1;
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: rpcId, method: "tools/call", params: { name: tool, arguments: args } }),
  });
  const text = await res.text();
  let msg;
  if (text.startsWith("event:") || text.includes("\ndata:") || text.startsWith("data:")) {
    const line = text.split("\n").find((l) => l.startsWith("data:"));
    msg = JSON.parse(line.slice(5).trim());
  } else {
    msg = JSON.parse(text);
  }
  if (msg.error) throw new Error(`${tool}: ${JSON.stringify(msg.error)}`);
  return JSON.parse(msg.result.content[0].text);
}

async function initialize() {
  rpcId += 1;
  await fetch(MCP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: rpcId, method: "initialize",
      params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "export", version: "1" } },
    }),
  });
}

// Reorder an object so `name` is first and `description` second, matching the
// hand-authored file's conventions; the rest follow in a stable, readable order.
function orderRecord(name, body, order) {
  const out = { name };
  for (const k of order) if (body[k] !== undefined) out[k] = body[k];
  // carry any remaining keys we didn't explicitly order
  for (const k of Object.keys(body)) if (!(k in out)) out[k] = body[k];
  return out;
}

await initialize();
console.error(`connected to MCP at ${MCP_URL}`);

// 1) Find the System element.
const sysSearch = await call("search_specifications", { name: SYSTEM_NAME, elementType: "System", pageSize: 50 });
const sysItem = (sysSearch.items || []).find((it) => it.name === SYSTEM_NAME && it.elementType === "System");
if (!sysItem) { console.error(`No System named "${SYSTEM_NAME}"`); process.exit(1); }
const systemId = sysItem.id;

// 2) The System's whole scope (light index), then the full record of each element.
const scope = await call("retrieve_system_scope", { systemId });
const summaries = [sysItem, ...scope.elements.filter((e) => e.id !== systemId)];

// Fetch every element's full record (one call each; the model is small).
const full = new Map(); // id -> { element, record, relationships }
for (const s of summaries) {
  const r = await call("retrieve_element", { id: s.id });
  full.set(s.id, r);
}
console.error(`read ${full.size} element records`);

// 3) Collect the Requirement/Guardrail definition names referenced anywhere, and
//    resolve each definition's description.
const reqNames = new Set();
const grNames = new Set();
for (const { record } of full.values()) {
  for (const n of record.body.requirements || []) reqNames.add(n);
  for (const n of record.body.guardrails || []) grNames.add(n);
}
async function resolveReq(name) { const r = await call("retrieve_requirement", { name }); return r.outcome === "Found" ? r.requirement : null; }
async function resolveGr(name) { const r = await call("retrieve_guardrail", { name }); return r.outcome === "Found" ? r.guardrail : null; }

const reqDefs = [];
for (const name of [...reqNames].sort()) { const d = await resolveReq(name); if (d) reqDefs.push({ name: d.name, description: d.description }); }
const grDefs = [];
for (const name of [...grNames].sort()) { const d = await resolveGr(name); if (d) grDefs.push({ name: d.name, description: d.description }); }
console.error(`resolved ${reqDefs.length} requirement + ${grDefs.length} guardrail definitions`);

// 4) Partition elements by type.
const byType = (t) => summaries.filter((s) => s.elementType === t).map((s) => full.get(s.id));
const bodyOf = (r) => r.record.body;

const sys = full.get(systemId);
const System = orderRecord(SYSTEM_NAME, bodyOf(sys), ["description", "requirements", "guardrails"]);
// `groups` is the System record's name-list of its Components; in the authoring
// schema the grouping is expressed by the nested `components`, so drop the
// redundant flat list to keep the file faithful to ingest.mjs's input shape.
delete System.groups;

// Components (groups), nested under the System.
System.components = byType("Component").map((r) =>
  orderRecord(r.element.name, bodyOf(r), ["description", "rationale", "performs", "owns", "produces"]));

// Interfaces, nested under the System.
System.interfaces = byType("Interface").map((r) =>
  orderRecord(r.element.name, bodyOf(r), ["description", "serves", "binding", "exposes", "rationale"]));

// Functions, nested under the System.
System.functions = byType("Function").map((r) =>
  orderRecord(r.element.name, bodyOf(r), ["description", "steps", "result", "alternatives", "behavior", "requirements", "guardrails"]));

// Data Objects and Events, nested under the System.
System.dataObjects = byType("DataObject").map((r) =>
  orderRecord(r.element.name, bodyOf(r), ["description", "schema", "requirements", "guardrails"]));
System.events = byType("Event").map((r) =>
  orderRecord(r.element.name, bodyOf(r), ["description", "schema", "requirements", "guardrails"]));

// Actors, Requirement and Guardrail definitions at the top level.
const Actor = byType("Actor").map((r) =>
  orderRecord(r.element.name, bodyOf(r), ["description", "uses", "requirements", "guardrails"]));

const doc = { System, Actor, Requirement: reqDefs, Guardrail: grDefs };

const header = `# Contour — ${SYSTEM_NAME} System record\n` +
  `# Exported from the live contour-engine (scripts/export.mjs).\n` +
  `# Authoring schema consumed by scripts/ingest.mjs.\n\n`;

const yaml = stringifyYaml(doc, { lineWidth: 100 });
writeFileSync(OUT, header + yaml, "utf8");
console.error(`wrote ${OUT}`);
console.error(`  System "${SYSTEM_NAME}" (${systemId})`);
console.error(`  ${System.components.length} components, ${System.interfaces.length} interfaces, ` +
  `${System.functions.length} functions, ${System.dataObjects.length} data objects, ` +
  `${System.events.length} events, ${Actor.length} actors`);
console.error(`  ${reqDefs.length} requirements, ${grDefs.length} guardrails`);
