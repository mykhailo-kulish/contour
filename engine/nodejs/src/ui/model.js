// The Modeler's model logic, ported from the template mockup (Main.dc.html
// DCLogic) and adapted to operate on real Contour records loaded from the BFF.
//
// Nothing here stores or validates on the server's behalf — Contour remains the
// authority (Check Model). These are the *local*, instant read-outs the mockup
// shows while editing: the shape of a record, the schema type notation, and the
// "still to fill in" (gaps) / "contradicts the model" (wrong) hints per element.

// ---- record body shapes -------------------------------------------------

// A Function's steps are stored as ordered single-verb objects: { verb: target }
// optionally carrying a `becomes` map { calleeOutcome: thisOutcome }. Normalize
// to { verb, target, becomes } for editing.
export function readSteps(steps) {
  if (!Array.isArray(steps)) return [];
  return steps.map((s) => {
    if (!s || typeof s !== "object") return { verb: "", target: "", becomes: {} };
    const becomes = s.becomes && typeof s.becomes === "object" ? { ...s.becomes } : {};
    const entry = Object.entries(s).find(([k]) => k !== "becomes");
    return entry ? { verb: entry[0], target: String(entry[1] ?? ""), becomes } : { verb: "", target: "", becomes };
  });
}

// Serialize back to the stored shape.
export function writeSteps(steps) {
  return steps
    .filter((s) => s.verb && String(s.target).trim())
    .map((s) => {
      const out = { [s.verb]: String(s.target).trim() };
      const becomes = Object.fromEntries(Object.entries(s.becomes || {}).filter(([, v]) => v));
      if (Object.keys(becomes).length) out.becomes = becomes;
      return out;
    });
}

// Alternatives are stored as { name: descriptionOrObject }. The template model
// carries `when` (plain-language trigger) and `effects` ([{verb,target}]); we
// store an object { when, effects } per alternative, but also read a plain
// string description (what the engine Console writes) as `when`.
export function readAlternatives(alts) {
  if (!alts || typeof alts !== "object") return [];
  return Object.entries(alts).map(([name, v]) => {
    if (typeof v === "string") return { name, when: v, effects: [] };
    const when = typeof v?.when === "string" ? v.when : typeof v?.description === "string" ? v.description : "";
    const effects = Array.isArray(v?.effects)
      ? v.effects.map((e) => {
          if (!e || typeof e !== "object") return { verb: "", target: "" };
          const entry = Object.entries(e).find(([k]) => k !== "becomes");
          return entry ? { verb: entry[0], target: String(entry[1] ?? "") } : { verb: "", target: "" };
        })
      : [];
    return { name, when, effects };
  });
}

export function writeAlternatives(alts) {
  const out = {};
  alts
    .filter((a) => String(a.name).trim())
    .forEach((a) => {
      const effects = (a.effects || [])
        .filter((e) => e.verb && String(e.target).trim())
        .map((e) => ({ [e.verb]: String(e.target).trim() }));
      out[a.name.trim()] = { when: a.when || "", effects };
    });
  return out;
}

// ---- Interface channel (contour.md §3.3) --------------------------------

// Serialize the editing binding model ({ style, keys:[{k,v}] }) back to the
// stored block: a flat object with `style` first, then each non-empty key/value
// row (value kept verbatim as its written text). Returns undefined when empty.
export function writeBinding(binding) {
  if (!binding) return undefined;
  const out = {};
  if (String(binding.style || "").trim()) out.style = binding.style.trim();
  (binding.keys || []).forEach(({ k, v }) => {
    const key = String(k || "").trim();
    if (key) out[key] = String(v ?? "").trim();
  });
  return Object.keys(out).length ? out : undefined;
}

// Serialize the editing exposes model ([{ fn, operation, request, responses }])
// back to the stored form. `request` is a shape editor model (or null) and each
// `responses` value is a { code, body } editing model; both serialize to the
// universal structured store form via writeShape/writeResponse (`fmt` is a
// world-bound fmtType). A row with no operation, request or responses writes as
// a bare name; otherwise it writes an { operation?, request?, responses? } block
// keyed by the Function name. When every row is bare, the whole `exposes` is a
// name list; otherwise it is an object keyed by name. Returns undefined when
// nothing is exposed.
export function writeExposes(exposes, fmt) {
  const f = fmt || ((x) => fmtBare(x));
  const rows = (exposes || []).filter((r) => String(r.fn || "").trim());
  if (!rows.length) return undefined;
  const block = (r) => {
    const b = {};
    if (String(r.operation || "").trim()) b.operation = r.operation.trim();
    const request = r.request ? writeShape(r.request, f) : undefined;
    if (request !== undefined && request !== null) b.request = request;
    const responses = {};
    Object.entries(r.responses || {}).forEach(([k, v]) => {
      const name = String(k || "").trim();
      if (!name) return;
      const out = writeResponse(v, f);
      if (out !== undefined && out !== "") responses[name] = out;
    });
    if (Object.keys(responses).length) b.responses = responses;
    return b;
  };
  const blocks = rows.map((r) => ({ fn: r.fn.trim(), b: block(r) }));
  const anyDetail = blocks.some((x) => Object.keys(x.b).length);
  if (!anyDetail) return blocks.map((x) => x.fn);
  const out = {};
  blocks.forEach((x) => { out[x.fn] = x.b; });
  return out;
}

export function asList(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v.map(String) : [String(v)];
}

// ---- schema (core type notation, contour.md §3.3) -----------------------

export const PRIMS = ["string", "integer", "decimal", "boolean", "uuid", "date-time"];

// One schema field: n(ame) k(ind) a(primary ref) b(secondary text) list opt.
//   kinds: prim | enum | ref | nested | proj | inline | raw
// `raw` holds an exact type-notation string in `b` — used when a field's type
// is a Data Object reference / nested type / projection we round-trip verbatim
// (so nothing is lost and the preview matches what the engine stored).
export const F = (n, k, a, b, list, opt) => ({ n, k, a: a || "", b: b || "", list: list || "", opt: !!opt });

// Split a type string into { base, list, opt } by peeling the `?` and list
// suffix (`[]` / `[1..]`).
function peelType(s) {
  let t = String(s || "").trim();
  let opt = false;
  let list = "";
  if (t.endsWith("?")) { opt = true; t = t.slice(0, -1).trim(); }
  if (t.endsWith("[1..]")) { list = "[1..]"; t = t.slice(0, -5).trim(); }
  else if (t.endsWith("[]")) { list = "[]"; t = t.slice(0, -2).trim(); }
  return { base: t, list, opt };
}

// Classify a single type string into the editor's field model (reverse of
// fmtType). Structural only — it does not resolve names against the model, so a
// Data Object reference / nested type / projection is kept as a `raw` string
// that round-trips verbatim.
export function parseType(name, typeStr) {
  const { base, list, opt } = peelType(typeStr);
  if (!base) return F(name, "", "", "", list, opt);
  if (PRIMS.indexOf(base) >= 0) return F(name, "prim", base, "", list, opt);
  const em = base.match(/^enum\((.*)\)$/s);
  if (em) return F(name, "enum", "", em[1].trim(), list, opt);
  // Inline shape: { a: T, b: U }
  if (base.startsWith("{") && base.endsWith("}")) return F(name, "inline", "", base.slice(1, -1).trim(), list, opt);
  // Anything else (Order, Order.Line Item, Order { id, status }) round-trips raw.
  return F(name, "raw", "", base, list, opt);
}

// Render an object value as an inline-shape string ("{ a: T, b: U }"), for the
// uncommon case of an object nested directly inside another object value.
function objToInline(v) {
  if (v && typeof v === "object") {
    return "{ " + Object.entries(v).map(([k, t]) => k + ": " + (typeof t === "string" ? t : objToInline(t))).join(", ") + " }";
  }
  return String(v);
}

// A Data Object / Event record stores `schema` in one of three canonical forms
// (contour.md §3.3, and the engine's stored records):
//   • an object mapping fieldName -> type-notation string (the common case)
//   • a plain string / link to an external spec (AsyncAPI, JSON Schema, …)
//   • (legacy Meanings) the structured { mode, fields, nested, seq } form
// Normalize any of them to the editor model
//   { mode: "fields"|"link", link, fields:[F], nested:[{id,n,fields:[F]}], seq }.
export function readSchema(body) {
  const s = body ? body.schema : undefined;
  const empty = { mode: "fields", link: "", seq: 1, fields: [], nested: [] };
  if (s == null) return empty;

  // A string schema is a link/reference to an external spec.
  if (typeof s === "string") return { mode: "link", link: s, seq: 1, fields: [], nested: [] };

  if (typeof s === "object") {
    // Legacy structured form.
    if (s.mode === "link" || Array.isArray(s.fields) || Array.isArray(s.nested)) {
      return {
        mode: s.mode === "link" ? "link" : "fields",
        link: typeof s.link === "string" ? s.link : "",
        seq: typeof s.seq === "number" ? s.seq : (Array.isArray(s.nested) ? s.nested.length + 1 : 1),
        fields: Array.isArray(s.fields) ? s.fields.map((f) => F(f.n, f.k, f.a, f.b, f.list, f.opt)) : [],
        nested: Array.isArray(s.nested)
          ? s.nested.map((nt, i) => ({ id: nt.id || "n" + (i + 1), n: nt.n || "", fields: (nt.fields || []).map((f) => F(f.n, f.k, f.a, f.b, f.list, f.opt)) }))
          : [],
      };
    }
    // An explicit external-spec object: { $ref } or { link }/{ schema }.
    const link = s.$ref || s.link || s.ref;
    if (typeof link === "string" && Object.keys(s).length <= 2) {
      return { mode: "link", link, seq: 1, fields: [], nested: [] };
    }
    // The canonical case: fieldName -> type-notation string, where a value may
    // itself be an object (an embedded shape). We distinguish two uses of an
    // object-valued entry so both round-trip and both render as their own block:
    //   • a *named nested type* — its name is used as a type by some other field
    //     (e.g. body.data: "Activity Totals"). It is a top-level definition,
    //     referenced by name; it stays out of the field list and lives in
    //     `nested`, serialised back as its own top-level object entry.
    //   • an *embedded field* — nothing references its name (e.g. body). It is a
    //     real field of its owner whose type is an inline object; it stays in the
    //     field list as an `embed` field pointing at its block, and serialises
    //     back as a nested object at its own position.
    const entries = Object.entries(s);
    // Names referenced as a type by any string value anywhere in the schema
    // (top level or inside a nested object), peeling list/`?` and projections.
    const referenced = new Set();
    const noteRef = (v) => {
      const { base } = peelType(v);
      const nm = base.replace(/\s*\{[^}]*\}\s*$/, "").trim();
      if (nm) referenced.add(nm);
    };
    const scanRefs = (obj) => Object.values(obj).forEach((v) => {
      if (typeof v === "string") noteRef(v);
      else if (v && typeof v === "object") scanRefs(v);
    });
    scanRefs(s);
    const fields = [];
    const nested = [];
    const order = [];
    let seq = 1;
    const blockFields = (v) => Object.entries(v).map(([k, t]) =>
      parseType(k, typeof t === "string" ? t : objToInline(t)));
    entries.forEach(([fieldName, v]) => {
      order.push(fieldName);
      if (typeof v === "string") { fields.push(parseType(fieldName, v)); return; }
      if (v && typeof v === "object") {
        const id = "n" + seq;
        seq += 1;
        nested.push({ id, n: fieldName, fields: blockFields(v), embedded: !referenced.has(fieldName) });
        if (!referenced.has(fieldName)) {
          // Embedded field: keep a field at this position, pointing at its block.
          fields.push({ ...F(fieldName, "embed", id, "", "", false) });
        }
        return;
      }
      fields.push(F(fieldName, "", "", "", "", false));
    });
    return { mode: "fields", link: "", seq, fields, nested, order };
  }

  return empty;
}


export const listVals = (s) => String(s || "").split(",").map((x) => x.trim()).filter((x) => x);

// Split an inline shape's inner text ("a: string, b: T?, c") into member rows,
// honouring nested braces so `a: { x: int }, b: string` splits into two, not
// four. Each member is `name` or `name: type`; parsed with parseType so a
// member's own type (primitive, enum, ref, even a further inline shape) is
// modelled. Used to render an inline `{ … }` shape as its own block.
export function parseInlineMembers(text) {
  const t = String(text || "").trim();
  if (!t) return [];
  const parts = [];
  let depth = 0;
  let cur = "";
  for (const ch of t) {
    if (ch === "{" || ch === "(" || ch === "[") depth += 1;
    else if (ch === "}" || ch === ")" || ch === "]") depth -= 1;
    if (ch === "," && depth === 0) { parts.push(cur); cur = ""; } else cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts.map((p) => {
    const seg = p.trim();
    const colon = splitMemberColon(seg);
    if (colon < 0) {
      // Bare member: just a name, maybe with a trailing `?` (optional). No type.
      let nm = seg;
      let opt = false;
      if (nm.endsWith("?")) { opt = true; nm = nm.slice(0, -1).trim(); }
      return F(nm, "", "", "", "", opt);
    }
    return parseType(seg.slice(0, colon).trim(), seg.slice(colon + 1).trim());
  }).filter((f) => f.n !== "" || f.k !== "");
}

// Index of the member-separating colon at brace/paren depth 0 (so `a: enum(x:y)`
// or `a: { b: c }` split on the first top-level colon only). -1 when none.
function splitMemberColon(seg) {
  let depth = 0;
  for (let i = 0; i < seg.length; i += 1) {
    const ch = seg[i];
    if (ch === "{" || ch === "(" || ch === "[") depth += 1;
    else if (ch === "}" || ch === ")" || ch === "]") depth -= 1;
    else if (ch === ":" && depth === 0) return i;
  }
  return -1;
}

// Serialize inline-shape member rows back to the inner text form, the reverse of
// parseInlineMembers. A member with a type renders `name: type`; a bare member
// (no type) renders just its name — so a shorthand like `identity?` round-trips
// verbatim. `fmt` formats one member (pass a world-bound fmtType).
export function writeInlineMembers(fields, fmt) {
  return (fields || [])
    .map((f) => {
      const name = String(f.n || "").trim();
      const type = fmt(f);
      if (!name) return "";
      // A bare name carries its optional `?` on the name itself (no type).
      if (!type && !f.k) return name + (f.opt ? "?" : "");
      return type ? name + ": " + type : name;
    })
    .filter(Boolean)
    .join(", ");
}

// Resolve a field's ref target `a` ("elementId" or "elementId#nestedId") to a
// display name + its field names, within a map of { elementId: {name, schema} }.
export function resolveType(a, ownerId, world) {
  if (!a) return null;
  if (a.indexOf("#") >= 0) {
    const [eid, nid] = a.split("#");
    const owner = world[eid];
    if (!owner) return null;
    const nt = (owner.schema.nested || []).find((x) => x.id === nid);
    if (!nt) return null;
    return { name: eid === ownerId ? nt.n : owner.name + "." + nt.n, fields: nt.fields.map((x) => x.n) };
  }
  const owner = world[a];
  if (!owner) return null;
  return { name: owner.name, fields: owner.schema.mode === "fields" ? owner.schema.fields.map((x) => x.n) : [] };
}

// Format one field as Contour notation: base + list suffix + optional `?`.
export function fmtType(f, ownerId, world) {
  let base = "";
  if (f.k === "prim") base = f.a;
  else if (f.k === "enum") base = listVals(f.b).length ? "enum(" + listVals(f.b).join(", ") + ")" : "";
  else if (f.k === "embed") base = "{ … }"; // an embedded object shape, shown as its own block
  else if (f.k === "ref" || f.k === "nested") {
    const r = resolveType(f.a, ownerId, world);
    base = r ? r.name : "";
  } else if (f.k === "proj") {
    const r = resolveType(f.a, ownerId, world);
    base = r && listVals(f.b).length ? r.name + " { " + listVals(f.b).join(", ") + " }" : "";
  } else if (f.k === "inline") base = f.b.trim() ? "{ " + f.b.trim() + " }" : "";
  else if (f.k === "raw") base = String(f.b || "").trim();
  if (!base) return "";
  return base + f.list + (f.opt ? "?" : "");
}

// Serialize the editor schema model back to the canonical stored form
// (contour.md §3.3): link mode -> the link string; fields mode -> an object
// mapping fieldName -> type-notation string. An `embed` field writes back as a
// nested object at its own position (its shape stays embedded on that field). A
// *named* nested type (not embedded) is emitted as its own top-level
// object-valued entry so other fields can refer to it by name. Both keep each
// shape a separate block across a save/reload. `fmt` formats a field (pass a
// world-bound fmtType).
export function writeSchema(schema, fmt) {
  if (!schema) return undefined;
  if (schema.mode === "link") return schema.link && schema.link.trim() ? schema.link.trim() : undefined;
  const nestedById = {};
  (schema.nested || []).forEach((nt) => { nestedById[nt.id] = nt; });
  const blockObj = (nt) => {
    const block = {};
    (nt.fields || []).forEach((x) => {
      const fn = String(x.n || "").trim();
      if (fn) block[fn] = x.k === "embed" && nestedById[x.a] ? blockObj(nestedById[x.a]) : (fmt(x) || "");
    });
    return block;
  };
  // Value for one top-level entry, by its name: a field (incl. embed) or a
  // named nested type.
  const fieldByName = {};
  (schema.fields || []).forEach((f) => { const n = String(f.n || "").trim(); if (n) fieldByName[n] = f; });
  const namedByName = {};
  (schema.nested || []).forEach((nt) => { if (!nt.embedded) { const n = String(nt.n || "").trim(); if (n) namedByName[n] = nt; } });
  const emit = (out, name) => {
    if (fieldByName[name]) {
      const f = fieldByName[name];
      out[name] = f.k === "embed" && nestedById[f.a] ? blockObj(nestedById[f.a]) : (fmt(f) || "");
    } else if (namedByName[name]) {
      out[name] = blockObj(namedByName[name]);
    }
  };
  const out = {};
  const done = new Set();
  // 1) Preserve original key order where known.
  (schema.order || []).forEach((name) => {
    const n = String(name || "").trim();
    if (n && !done.has(n) && (fieldByName[n] || namedByName[n])) { emit(out, n); done.add(n); }
  });
  // 2) Append anything new (editor-added fields/types not in the original order).
  (schema.fields || []).forEach((f) => { const n = String(f.n || "").trim(); if (n && !done.has(n)) { emit(out, n); done.add(n); } });
  (schema.nested || []).forEach((nt) => { if (!nt.embedded) { const n = String(nt.n || "").trim(); if (n && !done.has(n)) { emit(out, n); done.add(n); } } });
  return Object.keys(out).length ? out : undefined;
}


// The multi-line "As written in Contour" preview for a schema. The root shape
// comes first, then each nested type and each embedded (inline) shape as its
// own separate block, mirroring how the editor and viewer render each shape as
// its own block.
export function schemaPreview(schema, ownerId, world) {
  if (schema.mode === "link") return "schema: " + (schema.link.trim() || "(no link yet)");
  const ownerName = (world[ownerId] && world[ownerId].name) || "";
  const fieldLine = (x) => (x.n.trim() || "?") + ": " + (fmtType(x, ownerId, world) || "?");
  const blockOf = (fields) => fields.length
    ? "{\n" + fields.map((x) => "  " + fieldLine(x)).join("\n") + "\n}"
    : "{ }";
  const blocks = [blockOf(schema.fields)];
  schema.nested.forEach((nt) => {
    // A named nested type reads as Owner.Type; an embedded shape reads as its
    // field name (it has no independent type name).
    const title = nt.embedded
      ? (nt.n.trim() || "?")
      : (ownerName ? ownerName + "." : "") + (nt.n.trim() || "?");
    blocks.push(title + " " + blockOf(nt.fields));
  });
  // Each embedded inline-*string* shape (kind "inline") as its own block too.
  const emitInline = (fields) => fields.forEach((f) => {
    if (f.k === "inline") {
      const members = parseInlineMembers(f.b);
      blocks.push((f.n.trim() || "?") + " " + blockOf(members));
    }
  });
  emitInline(schema.fields);
  schema.nested.forEach((nt) => emitInline(nt.fields));
  return blocks.join("\n\n");
}

// ---- universal shape (Data Object / Event schema; Interface request &
//      response body), one structured store form -------------------------
//
// A "shape" is the same editor model readSchema/writeSchema use
// ({ mode, fields, nested, ... }). These helpers let an Interface request and
// response body be read and written with the exact same machinery as a Data
// Object's fields, and they normalize the store form so a shape is always a
// structured object (fieldName -> type-notation string, with every inline
// `{ … }` extracted into a real nested object) rather than an opaque string.

// Read a shape value into the editor model. Accepts the structured object form
// (the new store form, and a Data Object's own schema shape) OR a legacy
// notation STRING — a request stored as "{ id: uuid }", or a body stored as
// "Order { id, status }" / "Order". A string is parsed: an outer `{ … }`
// becomes the shape's fields (its members), and a bare ref/projection becomes a
// single unnamed field carrying that notation (round-trips verbatim).
export function readShape(value) {
  if (value == null) return readSchema({});
  if (typeof value === "object" && !Array.isArray(value)) {
    // Already structured: reuse the schema reader (handles nested objects,
    // embedded shapes and key order), but a shape never links to an external
    // spec, so a { $ref }/string is treated as a body below, not here.
    return readSchema({ schema: value });
  }
  const text = String(value).trim();
  if (!text) return readSchema({});
  // An outer inline object "{ a: T, b: U }" → the shape's own members.
  if (text.startsWith("{") && text.endsWith("}")) {
    const members = parseInlineMembers(text.slice(1, -1));
    const obj = {};
    members.forEach((m) => { const n = String(m.n || "").trim(); if (n) obj[n] = fmtBare(m); });
    return readSchema({ schema: obj });
  }
  // A bare ref / projection ("Order", "Order { id, status }") → one field with
  // no name, carrying the notation verbatim. The body still reads as a shape so
  // the editor shows a single row; it serializes back to the same string.
  return readSchema({ schema: { "": text } });
}

// Format one editor field to its notation string WITHOUT a world (so a `raw`
// member of a parsed inline shape round-trips; ref/proj by id aren't produced
// by the parser, only by the editor's dropdowns, which do have a world).
function fmtBare(f) {
  const base = f.k === "prim" ? f.a
    : f.k === "enum" ? (listVals(f.b).length ? "enum(" + listVals(f.b).join(", ") + ")" : "")
    : f.k === "inline" ? (f.b.trim() ? "{ " + f.b.trim() + " }" : "")
    : f.k === "raw" ? String(f.b || "").trim()
    : "";
  if (!base) return "";
  return base + (f.list || "") + (f.opt ? "?" : "");
}

// Serialize a shape editor model to the universal store form: a structured
// object mapping each field name to its type-notation string, with every inline
// `{ … }` extracted into a real nested object (never left as a string). Built on
// writeSchema with inline extraction turned on. Returns undefined when empty.
// A single unnamed field (a bare body like "Order { id, status }") serializes
// to that notation string, since it has no field name to key an object by.
export function writeShape(schema, fmt) {
  if (!schema) return undefined;
  const realFields = (schema.fields || []).filter((f) => String(f.n || "").trim() || f.k);
  // A lone unnamed field is a bare body (a ref/projection/inline with no field
  // name): emit its notation string, not an object.
  if (realFields.length === 1 && !String(realFields[0].n || "").trim()) {
    const s = fmt(realFields[0]);
    return s ? s : undefined;
  }
  return writeSchema(extractInline(schema, fmt), fmt);
}

// Return a copy of the schema with every inline `{ … }` field (kind "inline")
// promoted to an embedded nested object, so writeSchema emits it as a real
// nested object rather than a string. Idempotent for schemas with no inline
// fields.
function extractInline(schema, fmt) {
  if (!schema || !Array.isArray(schema.fields)) return schema;
  const hasInline = (fs) => (fs || []).some((f) => f.k === "inline");
  if (!hasInline(schema.fields) && !(schema.nested || []).some((nt) => hasInline(nt.fields))) return schema;
  const next = JSON.parse(JSON.stringify(schema));
  let seq = next.seq || (next.nested ? next.nested.length + 1 : 1);
  const promote = (fields) => {
    fields.forEach((f) => {
      if (f.k === "inline") {
        const members = parseInlineMembers(f.b);
        const id = "n" + seq;
        seq += 1;
        next.nested = next.nested || [];
        next.nested.push({ id, n: f.n || ("shape" + seq), fields: members, embedded: true });
        f.k = "embed";
        f.a = id;
        f.b = "";
      }
    });
  };
  promote(next.fields);
  (next.nested || []).forEach((nt) => promote(nt.fields));
  next.seq = seq;
  return next;
}

// Read a response value into { code, body } where body is a shape editor model
// (or null when there is no body). Accepts: a bare code (number/string like 404
// or "NOT_FOUND"); a structured { code, body }; or a legacy string such as
// "200 { body: Order }", "201", or "Order" (a lone body). The body, when
// present, is read with readShape so it edits like any other shape.
export function readResponse(value) {
  const empty = { code: "", body: null };
  if (value == null) return empty;
  if (typeof value === "number") return { code: String(value), body: null };
  if (typeof value === "object" && !Array.isArray(value)) {
    const code = value.code == null ? "" : String(value.code);
    const body = value.body == null || value.body === "" ? null : readShape(value.body);
    return { code, body };
  }
  const text = String(value).trim();
  if (!text) return empty;
  // "CODE { body: SHAPE }" or "CODE { members }" or "CODE SHAPE" or just "CODE".
  // A projection body ("Order { id, status }") has no code — its head is a ref
  // name, not a status code. A real code is numeric or an ALL_CAPS/underscore
  // token (200, 404, OK, NOT_FOUND).
  const braceAt = text.indexOf("{");
  const looksLikeCode = (s) => /^\d+$/.test(s) || /^[A-Z][A-Z0-9_]*$/.test(s);
  if (braceAt >= 0) {
    const head = text.slice(0, braceAt).trim();
    if (!looksLikeCode(head)) {
      // No code — the whole thing is a bare body (ref + projection).
      return { code: "", body: readShape(text) };
    }
    const rest = text.slice(braceAt).trim();
    const inner = rest.startsWith("{") && rest.endsWith("}") ? rest.slice(1, -1).trim() : rest;
    const bodyText = inner.replace(/^body\s*:/i, "").trim();
    if (!bodyText) return { code: head, body: null };
    // The body may be a bare ref/projection ("Order", "Order { id, status }"),
    // an already-brace-wrapped shape ("{ id: uuid }"), or a bare member list
    // ("id: uuid, note: string"). Read a ref/wrapped form directly; wrap a bare
    // member list so readShape sees it as a shape object.
    const bareBody = (/^[A-Za-z]/.test(bodyText) && bodyText.indexOf(":") < 0)
      || (bodyText.startsWith("{") && bodyText.endsWith("}"));
    return { code: head, body: readShape(bareBody ? bodyText : "{ " + bodyText + " }") };
  }
  // No braces: "201", "NOT_FOUND", or a bare body like "Order".
  const codeLike = /^[A-Za-z0-9_]+$/.test(text) && /\d|^[A-Z_]+$/.test(text);
  if (codeLike) return { code: text, body: null };
  return { code: "", body: readShape(text) };
}

// Serialize { code, body } back to the store form: a bare code string when
// there is no body; otherwise a structured { code, body } where body is the
// universal shape object. Returns undefined when empty.
export function writeResponse(resp, fmt) {
  if (!resp) return undefined;
  const codeStr = String(resp.code || "").trim();
  // Keep an all-numeric code numeric (as stored), otherwise a string token.
  const code = codeStr === "" ? undefined : (/^\d+$/.test(codeStr) ? Number(codeStr) : codeStr);
  const body = resp.body ? writeShape(resp.body, fmt) : undefined;
  if (body === undefined || body === null) return code === undefined ? undefined : code;
  return { code, body };
}

// Per-field issues (contradictions `c`, gaps `g`) used for inline hints.
export function fieldIssue(f, ownerId, world) {
  const c = [];
  const g = [];
  const nm = f.n.trim() ? "“" + f.n.trim() + "”" : "A field";
  if (!f.n.trim()) g.push("A field has no name yet.");
  if (!f.k) { g.push(nm + " has no type yet."); return { c, g }; }
  if (f.k === "prim" && !f.a) g.push(nm + " has no basic type yet.");
  if (f.k === "enum") {
    const v = listVals(f.b);
    if (!v.length) g.push(nm + ": the enum has no values yet.");
    else if (v.some((x, i) => v.indexOf(x) !== i)) c.push(nm + ": the enum lists a value twice.");
  }
  if (f.k === "ref" || f.k === "nested" || f.k === "proj") {
    if (!f.a) g.push(nm + " does not say what it refers to yet.");
    else if (!resolveType(f.a, ownerId, world)) c.push(nm + " refers to something that no longer exists.");
  }
  if (f.k === "proj") {
    const r = resolveType(f.a, ownerId, world);
    const v = listVals(f.b);
    if (!v.length) g.push(nm + ": name the fields to take.");
    else if (r) v.forEach((x) => { if (r.fields.indexOf(x) < 0) c.push(nm + ": " + r.name + " has no field “" + x + "”."); });
  }
  if (f.k === "inline" && !f.b.trim()) g.push(nm + ": the inline shape has no fields yet.");
  if (f.k === "raw" && !f.b.trim()) g.push(nm + " has no type yet.");
  return { c, g };
}

function schemaIssues(schema, ownerId, kind, world) {
  const c = [];
  const g = [];
  if (schema.mode === "link") {
    if (!schema.link.trim()) g.push("The link to the existing schema is empty.");
    return { c, g };
  }
  if (!schema.fields.length && !schema.nested.length) {
    g.push("No schema yet: say " + (kind === "DataObject" ? "what fields it holds." : "what the event carries."));
  }
  const typeNames = schema.nested.map((nt) => nt.n.trim());
  schema.nested.forEach((nt, i) => {
    if (!nt.n.trim()) g.push("A nested type has no name yet.");
    else if (typeNames.indexOf(nt.n.trim()) !== i) c.push("Two nested types are both named “" + nt.n.trim() + "”.");
  });
  const groups = [{ title: "", fields: schema.fields }].concat(schema.nested.map((nt) => ({ title: nt.n, fields: nt.fields })));
  groups.forEach((gr, gi) => {
    const pre = gr.title ? gr.title + ": " : "";
    const names = gr.fields.map((f) => f.n.trim());
    gr.fields.forEach((f, i) => {
      if (f.n.trim() && names.indexOf(f.n.trim()) !== i) c.push(pre + "two fields are both named “" + f.n.trim() + "”.");
      if (gi === 0 && f.n.trim() && typeNames.indexOf(f.n.trim()) >= 0) c.push("A field and a nested type are both named “" + f.n.trim() + "”.");
      const x = fieldIssue(f, ownerId, world);
      x.c.forEach((t) => c.push(pre + t));
      x.g.forEach((t) => g.push(pre + t));
    });
  });
  return { c, g };
}

// ---- element issues (gaps + contradictions) ----------------------------
// `el` is the editing-model element: { id, name, kind, body, steps, alts,
// result, behavior, uses, requirements, guardrails, schema }. `world` indexes
// every element by id for cross-references; `defs` = { reqNames:Set, grNames:Set }.
export function issues(el, world, defs) {
  const c = [];
  const g = [];
  const kind = el.kind;

  if (kind === "DataObject" || kind === "Event") {
    const sx = schemaIssues(el.schema, el.id, kind, world);
    sx.c.forEach((t) => c.push(t));
    sx.g.forEach((t) => g.push(t));
  }

  // Referenced definitions must exist (mirrors engine validation).
  (el.requirements || []).forEach((r) => { if (defs && !defs.reqNames.has(r)) c.push('Referenced Requirement “' + r + '” is not defined.'); });
  (el.guardrails || []).forEach((r) => { if (defs && !defs.grNames.has(r)) c.push('Referenced Guardrail “' + r + '” is not defined.'); });

  if (kind === "Event" && el.name.trim() && !isPastTense(el.name)) {
    c.push('Event name “' + el.name.trim() + '” should be past tense (e.g. “Order Placed”).');
  }

  if (kind === "Function") {
    const altNames = (el.alts || []).map((a) => a.n ?? a.name).filter(Boolean);
    // A `becomes` value may map a callee ending onto ANY of this Function's own
    // outcomes — its main result or one of its alternatives (contour.md §3.3).
    const ownOutcomes = [String(el.result || "").trim(), ...altNames].filter(Boolean);
    const steps = el.steps || [];
    if (!steps.length) g.push("No steps yet: the main path is empty.");
    steps.forEach((s, i) => {
      const n = i + 1;
      if (!s.verb) g.push("Step " + n + " is not filled in yet.");
      else if (!s.target) g.push("Step " + n + " (" + s.verb + ") has no target yet.");
      if (s.verb === "consumes" && i > 0) c.push("Step " + n + " consumes an event, but only the first step may.");
      // A becomes value must be one of this Function's own outcomes (result or alternative).
      Object.keys(s.becomes || {}).forEach((k) => {
        if (s.becomes[k] && ownOutcomes.indexOf(s.becomes[k]) < 0) c.push('Step ' + n + ': “' + s.becomes[k] + '” is not one of this Function’s outcomes.');
      });
      // Step rule: when a step calls/uses another Function, that callee's
      // outcomes are listed and mappable. A callee alternative left unmapped is
      // allowed (it "continues the main path"); a `uses` step's built-in
      // Unreachable ending should be mapped (contour.md §3.3 check 7). Both are
      // surfaced as gaps — "still to fill in" — matching how Contour's own Check
      // Model treats not-yet-filled mappings, so a local hint never contradicts
      // the engine's verdict.
      if ((s.verb === "calls" || s.verb === "uses") && s.target) {
        const callee = calleeOutcomes(s, el, world);
        if (callee) {
          callee.alts.forEach((outcome) => {
            if (!(outcome in (s.becomes || {}))) {
              g.push('Step ' + n + ': “' + s.target + '” can end “' + outcome + '” — not mapped yet (it would continue the main path).');
            }
          });
        }
        if (s.verb === "uses" && !(s.becomes && "Unreachable" in s.becomes)) {
          g.push('Step ' + n + ' uses “' + s.target + '” — map what Unreachable becomes (contour.md §3.3).');
        }
      }
    });
    if (!String(el.result || "").trim()) g.push("The main result has no name yet.");
    const names = [el.result].concat(altNames).filter((x) => String(x || "").trim());
    const seen = {};
    names.forEach((x) => { seen[x] = (seen[x] || 0) + 1; });
    Object.keys(seen).forEach((x) => { if (seen[x] > 1) c.push('Two outcomes are both named “' + x + '”.'); });
    (el.alts || []).forEach((a) => {
      const an = a.n ?? a.name;
      if (!String(an || "").trim()) g.push("An alternative has no name yet.");
      else if (!String(a.when || "").trim()) g.push('Alternative “' + an + '” does not say when it happens.');
      (a.effects || []).forEach((e) => { if (!e.verb || !e.target) g.push('Alternative “' + (an || "unnamed") + '” has an effect that is not filled in yet.'); });
    });
    const consumesAny = steps.some((s) => s.verb === "consumes");
    if (consumesAny && el.actorName) {
      c.push("It starts from an event, so no Actor can use it. Remove it from " + el.actorName + ".");
    }
  }

  if (kind === "Requirement" || kind === "Guardrail") {
    if (!el.name.trim()) g.push("It has no name yet.");
    if (!String(el.body?.description || "").trim()) g.push("It has no description yet.");
  }
  return { c, g };
}

export function statusOf(el, world, defs) {
  const x = issues(el, world, defs);
  return x.c.length ? "wrong" : x.g.length ? "gaps" : "complete";
}

const IRREGULAR_PAST = new Set([
  "placed", "sent", "paid", "made", "done", "created", "updated", "deleted",
  "removed", "stored", "found", "shown", "built", "run", "began", "begun",
  "written", "read", "set", "put", "left", "lost", "shipped", "cancelled",
  "canceled", "completed", "reserved", "detected", "issued", "failed",
  "received", "rejected", "accepted",
]);
export function isPastTense(name) {
  const t = (name || "").trim();
  if (!t) return false;
  return t.split(/\s+/).map((w) => w.toLowerCase()).some((w) => w.endsWith("ed") || IRREGULAR_PAST.has(w));
}

// Data a Function touches: targets of reads/modifies steps (+ effects).
export function dataTouched(steps, alts) {
  const seen = [];
  const add = (v, t) => { if ((v === "reads" || v === "modifies") && t && seen.indexOf(t) < 0) seen.push(t); };
  (steps || []).forEach((s) => add(s.verb, s.target));
  (alts || []).forEach((a) => (a.effects || []).forEach((e) => add(e.verb, e.target)));
  return seen;
}

// The outcomes a step's callee can end in, so a caller can offer and check its
// becomes-mappings against the *actual* target Function.
//   `calls` → a Function of the same System (resolved by name).
//   `uses`  → "Interface / Function" of a neighbour System: find the Interface
//             (anywhere it is loaded) whose `exposes` names that Function, then
//             the Function it exposes; fall back to a uniquely-named Function.
// Returns { result, alts, isUses } or null when the callee can't be resolved.
export function calleeOutcomes(step, owner, world) {
  if (!step || !step.target) return null;
  const funcByName = (name, systemId) =>
    Object.values(world || {}).find((w) => w.kind === "Function" && w.name === name && (systemId == null || w.systemId === systemId));

  if (step.verb === "calls") {
    const hit = funcByName(step.target, owner.systemId);
    if (!hit) return null;
    return { result: hit.result || "", alts: (hit.altNames || []).slice(), isUses: false };
  }

  if (step.verb === "uses") {
    const raw = String(step.target);
    const slash = raw.lastIndexOf("/");
    const fnName = (slash >= 0 ? raw.slice(slash + 1) : raw).trim();
    const ifaceName = slash >= 0 ? raw.slice(0, slash).trim() : "";
    let fn = null;
    if (ifaceName) {
      // An Interface of another System (or this one) exposing fnName; resolve
      // the exposed Function within that Interface's System.
      const iface = Object.values(world || {}).find(
        (w) => w.kind === "Interface" && w.name === ifaceName && (w.exposes || []).indexOf(fnName) >= 0,
      );
      if (iface) fn = funcByName(fnName, iface.systemId);
    }
    if (!fn) {
      // Fall back to a uniquely-named Function anywhere (contour.md resolver).
      const matches = Object.values(world || {}).filter((w) => w.kind === "Function" && w.name === fnName);
      if (matches.length === 1) fn = matches[0];
    }
    if (!fn) return { result: "", alts: [], isUses: true }; // resolvable step shape, outcomes unknown
    return { result: fn.result || "", alts: (fn.altNames || []).slice(), isUses: true };
  }

  return null;
}


