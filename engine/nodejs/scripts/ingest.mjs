// Ingest a Contour YAML record into a running contour-engine via its MCP server
// (stateless streamable HTTP, JSON responses). Drives store_requirement,
// store_guardrail, store_element, check_model_tool.
//
// Usage: node scripts/ingest.mjs ../contour-engine.yaml [http://localhost:8000/mcp]
// (run from engine/nodejs; the record lives one level up at engine/contour-engine.yaml)
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const file = process.argv[2];
const MCP_URL = process.argv[3] || "http://localhost:8000/mcp";

// Minimal YAML? No — reuse a real parser via dynamic import of 'yaml' if present,
// else a tiny shim. We ship no yaml dep in the server, so parse with a child of
// js-yaml if available; otherwise require the user to pass JSON. Simplest: use
// Node's built-in? There is none. We depend on the 'yaml' importability here.
let parseYaml;
try {
  ({ parse: parseYaml } = await import("yaml"));
} catch {
  console.error("Please `npm i -D yaml` to run the ingest script, or feed JSON.");
  process.exit(1);
}

const NS = "c0ffee00-0000-5000-a000-c0570ea50001";
function eid(name) {
  // deterministic uuid v5-ish from name (namespace + name), stable across runs
  const h = createHash("sha1").update(NS + name).digest("hex");
  return [
    h.slice(0, 8), h.slice(8, 12),
    "5" + h.slice(13, 16),
    ((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16) + h.slice(18, 20),
    h.slice(20, 32),
  ].join("-");
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
  // response is JSON (enableJsonResponse) or SSE; handle both
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
      params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "ingest", version: "1" } },
    }),
  });
}

const asList = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

function build(doc) {
  const s = doc.System;
  const sysId = eid(s.name);
  const reqs = (doc.Requirement || []).map((r) => [r.name, r.description || ""]);
  const guards = (doc.Guardrail || []).map((g) => [g.name, g.description || ""]);
  const elements = [];

  const sysRecord = {};
  for (const k of ["description", "requirements", "guardrails"]) if (k in s) sysRecord[k] = s[k];
  const sysRels = (s.components || []).map((c) => ({ verb: "groups", toElementId: eid(c.name) }));
  elements.push([s.name, "System", sysId, null, sysRecord, sysRels]);

  for (const fn of s.functions || []) {
    const body = { ...fn }; delete body.name;
    const rels = [];
    for (const step of fn.steps || []) {
      if (step && typeof step === "object") {
        if ("calls" in step) rels.push({ verb: "calls", toElementId: eid(step.calls) });
        if ("uses" in step) rels.push({ verb: "uses", toElementId: eid(String(step.uses).split("/").pop().trim()) });
        if ("reads" in step) rels.push({ verb: "reads", toElementId: eid(step.reads) });
        if ("modifies" in step) rels.push({ verb: "modifies", toElementId: eid(step.modifies) });
        if ("produces" in step) rels.push({ verb: "produces", toElementId: eid(step.produces) });
        if ("consumes" in step) rels.push({ verb: "consumes", toElementId: eid(step.consumes) });
      }
    }
    elements.push([fn.name, "Function", eid(fn.name), sysId, body, rels]);
  }
  for (const d of s.dataObjects || []) { const b = { ...d }; delete b.name; elements.push([d.name, "DataObject", eid(d.name), sysId, b, []]); }
  for (const e of s.events || []) { const b = { ...e }; delete b.name; elements.push([e.name, "Event", eid(e.name), sysId, b, []]); }

  for (const a of doc.Actor || []) {
    const b = { ...a }; delete b.name;
    const rels = asList(a.uses).map((f) => ({ verb: "uses", toElementId: eid(f) }));
    elements.push([a.name, "Actor", eid(a.name), sysId, b, rels]);
  }
  for (const comp of s.components || []) {
    const b = { ...comp }; delete b.name;
    const rels = [];
    for (const f of asList(comp.performs)) rels.push({ verb: "performs", toElementId: eid(f) });
    for (const d of asList(comp.owns)) rels.push({ verb: "owns", toElementId: eid(d) });
    for (const e of asList(comp.produces)) rels.push({ verb: "produces", toElementId: eid(e) });
    elements.push([comp.name, "Component", eid(comp.name), sysId, b, rels]);
  }
  for (const iface of s.interfaces || []) {
    const b = { ...iface }; delete b.name;
    const rels = [];
    const exp = iface.exposes;
    const names = exp && !Array.isArray(exp) && typeof exp === "object" ? Object.keys(exp) : asList(exp);
    for (const f of names) rels.push({ verb: "exposes", toElementId: eid(f) });
    elements.push([iface.name, "Interface", eid(iface.name), sysId, b, rels]);
  }
  return { sysId, reqs, guards, elements };
}

const doc = parseYaml(readFileSync(file, "utf8"));
const { sysId, reqs, guards, elements } = build(doc);

await initialize();
console.log(`connected to MCP at ${MCP_URL}`);

for (const [name, description] of reqs) {
  const out = await call("store_requirement", { id: eid(name), name, description });
  if (out.outcome === "Name Taken") {
    // definition exists under a different id — retrieve it, re-store with its own id
    const existing = await call("retrieve_requirement", { name });
    const out2 = await call("store_requirement", { id: existing.requirement.id, name, description });
    if (out2.outcome !== "Stored") { console.error("REQ REJECTED (retry)", name, out2); process.exit(1); }
  } else if (out.outcome !== "Stored") { console.error("REQ REJECTED", name, out); process.exit(1); }
}
console.log(`stored ${reqs.length} requirements`);
for (const [name, description] of guards) {
  const out = await call("store_guardrail", { id: eid(name), name, description });
  if (out.outcome === "Name Taken") {
    const existing = await call("retrieve_guardrail", { name });
    const out2 = await call("store_guardrail", { id: existing.guardrail.id, name, description });
    if (out2.outcome !== "Stored") { console.error("GUARD REJECTED (retry)", name, out2); process.exit(1); }
  } else if (out.outcome !== "Stored") { console.error("GUARD REJECTED", name, out); process.exit(1); }
}
console.log(`stored ${guards.length} guardrails`);

// Resolve existing element ids by name so we upsert with correct ids.
// Elements may already exist with random UUIDs from a prior ingestion.
const idMap = new Map(); // name -> actual id (from engine or deterministic)
const eidToActual = new Map(); // original deterministic eid -> actual id

async function resolveId(name, systemId) {
  if (idMap.has(name)) return idMap.get(name);
  // search by exact name within the system (or across all for a System element)
  const search = await call("search_specifications", { name, ...(systemId ? { systemId } : {}), pageSize: 50 });
  const match = (search.items || []).find((it) => it.name === name);
  const id = match ? match.id : eid(name);
  idMap.set(name, id);
  eidToActual.set(eid(name), id);
  return id;
}

// First pass: resolve the System element id
const sysActualId = await resolveId(doc.System.name, null);

async function storeElement(resolvedId, name, etype, systemId, record, relationships) {
  // remap relationship target ids to actual ids
  const mappedRels = relationships.map((r) => ({
    ...r,
    toElementId: eidToActual.get(r.toElementId) || r.toElementId,
  }));
  const args = { id: resolvedId, name, elementType: etype, record, relationships: mappedRels };
  if (systemId != null) args.systemId = systemId;
  return call("store_element", args);
}

// Resolve all element ids first
for (const el of elements) {
  const [name, , origId, systemId] = el;
  const actualId = await resolveId(name, systemId || sysActualId);
  el[2] = actualId; // overwrite deterministic id with actual
  if (el[3] != null) el[3] = sysActualId; // fix systemId to actual
}
console.log(`resolved ${elements.length} element ids`);

for (const [name, etype, id, systemId, body] of elements) {
  const out = await storeElement(id, name, etype, systemId, body, []);
  if (out.outcome !== "Stored") { console.error("BARE REJECTED", name, out); process.exit(1); }
}
console.log(`stored ${elements.length} elements (bare)`);

let total = 0;
for (const [name, etype, id, systemId, body, rels] of elements) {
  const out = await storeElement(id, name, etype, systemId, body, rels);
  if (out.outcome !== "Stored") { console.error("REL REJECTED", name, out); process.exit(1); }
  total += rels.length;
}
console.log(`re-stored ${elements.length} elements with ${total} relationships`);

const chk = await call("check_model_tool", { systemId: sysActualId });
console.log(`\ncheck_model: ${chk.contradictions.length} contradictions, ${chk.gaps.length} gaps`);
console.log(`system id: ${sysActualId}`);
