// Backfill: re-store every element through Store Element, unchanged, so the engine reconciles each
// record's references with its outgoing edges (Requirement: Ownership Relations Are Stored) —
// record name-lists filled in from edges, and edges derived from record names and Function steps.
// Goes through the Console's Web UI binding (/ui-api), i.e. the same engine Functions; nothing is
// written that Validate Element would not accept. Elements it rejects are reported and left as they are.
//
// Usage: node scripts/backfill.mjs [http://localhost:8000]
const BASE = (process.argv[2] || "http://localhost:8000").replace(/\/$/, "") + "/ui-api";

// Targets before the elements that name them; Interfaces before Functions so a "uses: Interface /
// Function" step resolves through the Interface's exposes edges.
const ORDER = ["System", "Component", "DataObject", "Event", "Interface", "Actor", "Function"];

async function call(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  return { status: res.status, data };
}

async function allOfType(elementType) {
  const items = [];
  for (let page = 1; ; page++) {
    const { data } = await call("GET", `/elements?elementType=${elementType}&pageSize=200&page=${page}`);
    items.push(...data.items);
    if (items.length >= data.total || !data.items.length) return items;
  }
}

const edgeKeys = (rels, id) => new Set(rels.filter((r) => r.fromElementId === id).map((r) => `${r.verb}:${r.toElementId}`));

let stored = 0, changed = 0;
const rejected = [];
for (const type of ORDER) {
  for (const item of await allOfType(type)) {
    const before = (await call("GET", `/elements/${item.id}`)).data;
    const { element, record, relationships } = before;
    const payload = {
      element: { id: element.id, name: element.name, elementType: element.elementType, systemId: element.systemId },
      record: record ? record.body : {},
      relationships: relationships.filter((r) => r.fromElementId === element.id)
        .map((r) => ({ verb: r.verb, toElementId: r.toElementId })),
    };
    const out = await call("POST", "/elements", payload);
    if (out.status !== 200) {
      rejected.push({ type, name: element.name, id: element.id, violations: out.data?.violations ?? out.data });
      continue;
    }
    stored++;
    const after = (await call("GET", `/elements/${item.id}`)).data;
    const e0 = edgeKeys(relationships, element.id), e1 = edgeKeys(after.relationships, element.id);
    const addedEdges = [...e1].filter((k) => !e0.has(k));
    const recordChanged = JSON.stringify(record?.body ?? {}) !== JSON.stringify(after.record?.body ?? {});
    if (addedEdges.length || recordChanged) {
      changed++;
      const names = Object.fromEntries(after.relationships.map((r) => [`${r.verb}:${r.toElementId}`, r.to.name]));
      console.log(`~ ${type} ${element.name}: ${recordChanged ? "record lists filled from edges; " : ""}`
        + `${addedEdges.length} edge(s) added${addedEdges.length ? " — " + addedEdges.map((k) => `${k.split(":")[0]} ${names[k]}`).join(", ") : ""}`);
    }
  }
}

console.log(`\nre-stored ${stored} element(s), ${changed} changed, ${rejected.length} rejected`);
for (const r of rejected) console.log(`! ${r.type} ${r.name} (${r.id}): ${JSON.stringify(r.violations)}`);
process.exit(rejected.length ? 1 : 0);
