// Schema editor for Data Objects and Events — Contour's core type notation
// (contour.md §3.3). Fields carry a kind (basic / enum / Data Object ref /
// nested type / projection / inline shape), a list suffix and optional flag;
// Data Objects may also define nested types. A live "As written in Contour"
// preview renders the notation. Binds to el.schema; every edit calls onChange.
import { C, MONO, smallInputStyle, smallSelectStyle } from "../theme.js";
import { AddButton, Field, IconBtn, Muted } from "./primitives.jsx";
import { F, PRIMS, fieldIssue, fmtType, listVals, parseInlineMembers, schemaPreview, writeInlineMembers } from "../model.js";

const KINDS = [
  { v: "", l: "Choose a type…" },
  { v: "prim", l: "Basic type" },
  { v: "enum", l: "One of a fixed set · enum" },
  { v: "ref", l: "Data Object" },
  { v: "nested", l: "Nested type · Owner.Type" },
  { v: "proj", l: "Part of a Data Object · { }" },
  { v: "inline", l: "Inline shape · { }" },
  { v: "embed", l: "Embedded shape · { }" },
  { v: "raw", l: "Type notation · as written" },
];
const LISTS = [
  { v: "", l: "Single value" },
  { v: "[]", l: "List · []" },
  { v: "[1..]", l: "List, at least one · [1..]" },
];

// Options of other Data Objects and every nested type across the System.
function refOptions(kind, world, ownerId) {
  const dataIds = Object.keys(world).filter((id) => world[id].kind === "DataObject");
  const dataOpts = dataIds.map((id) => ({ v: id, l: world[id].name }));
  const nestOpts = [];
  dataIds.forEach((id) => (world[id].schema.nested || []).forEach((nt) =>
    nestOpts.push({ v: id + "#" + nt.id, l: id === ownerId ? nt.n : world[id].name + "." + nt.n })));
  if (kind === "ref") return [{ v: "", l: "Choose a Data Object…" }, ...dataOpts];
  if (kind === "nested") return [{ v: "", l: "Choose a nested type…" }, ...nestOpts];
  return [{ v: "", l: "Choose what to take part of…" }, ...dataOpts, ...nestOpts];
}

function FieldRow({ f, ownerId, world, onField, onKind, onDel }) {
  const iss = fieldIssue(f, ownerId, world);
  const problem = iss.c.length ? iss.c[0] : iss.g.length ? iss.g[0] : "";
  const showPrim = f.k === "prim";
  const showRef = f.k === "ref" || f.k === "nested" || f.k === "proj";
  const showText = f.k === "enum" || f.k === "proj" || f.k === "raw";
  const showInlineNote = f.k === "inline" || f.k === "embed";
  const textHint = f.k === "enum" ? "values, comma-separated" : f.k === "proj" ? "fields to take: id, status" : f.k === "raw" ? "e.g. Order, Order.Line Item, Order { id, status }" : "name: type, name: type";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <input aria-label="Field name" placeholder="field name" value={f.n} onChange={(e) => onField("n", e.target.value)}
          style={{ ...smallInputStyle, flex: "0 1 150px" }} />
        <select aria-label="Kind of type" value={f.k} onChange={(e) => onKind(e.target.value)}
          style={{ ...smallSelectStyle, flex: "0 1 230px" }}>
          {KINDS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
        </select>
        {showPrim && (
          <select aria-label="Basic type" value={f.a} onChange={(e) => onField("a", e.target.value)} style={{ ...smallSelectStyle, flex: "0 1 140px" }}>
            <option value="">Choose…</option>
            {PRIMS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        )}
        {showRef && (
          <select aria-label="Refers to" value={f.a} onChange={(e) => onField("a", e.target.value)} style={{ ...smallSelectStyle, flex: "0 1 200px" }}>
            {refOptions(f.k, world, ownerId).map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
          </select>
        )}
        {showText && (
          <input aria-label="Type details" placeholder={textHint} value={f.b} onChange={(e) => onField("b", e.target.value)}
            style={{ ...smallInputStyle, flex: "1 1 200px" }} />
        )}
        {showInlineNote && (
          <span style={{ flex: "1 1 200px", fontSize: 13, color: C.textDim, fontStyle: "italic", lineHeight: "36px" }}>
            Shape described in its own block below.
          </span>
        )}
        <select aria-label="Single value or list" value={f.list} onChange={(e) => onField("list", e.target.value)} style={{ ...smallSelectStyle, flex: "0 1 170px" }}>
          {LISTS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
        </select>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: C.text, minHeight: 36 }}>
          <input type="checkbox" checked={f.opt} onChange={(e) => onField("opt", e.target.checked)} style={{ width: 18, height: 18, accentColor: C.accent }} />
          Optional
        </label>
        <code style={{ fontFamily: MONO, fontSize: 12, color: C.accent, background: C.code, borderRadius: 4, padding: "4px 8px" }}>
          {fmtType(f, ownerId, world) || "…"}
        </code>
        <IconBtn onClick={onDel} title="Remove field">✕</IconBtn>
      </div>
      {problem && <span style={{ fontSize: 12, color: iss.c.length ? C.red : C.amber, paddingLeft: 2 }}>{problem}</span>}
    </div>
  );
}

function Group({ title, isNested, isInline, name, refName, fields, ownerId, world, onFieldChange, onKindChange, onDelField, onAddField, onName, onDelGroup }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, background: C.panel, border: `1px solid ${C.line}`, borderRadius: 4, padding: "14px 14px 12px" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 12px" }}>
        {!isNested && !isInline && <span style={{ fontSize: 12, letterSpacing: "0.96px", textTransform: "uppercase", color: C.textDim }}>{title}</span>}
        {isInline && (
          <>
            <span style={{ fontSize: 14, fontWeight: 500, color: C.text }}>{name || "(unnamed)"}</span>
            <Muted>Embedded shape on {refName} — described here, kept inline in the schema.</Muted>
            <div style={{ flex: 1 }} />
            {onDelGroup && <IconBtn onClick={onDelGroup} title="Remove this embedded shape">✕</IconBtn>}
          </>
        )}
        {isNested && (
          <>
            <Field label="Nested type" bg={C.panel} flex="0 1 260px">
              <input aria-label="Nested type name" placeholder="e.g. Line Item" value={name} onChange={(e) => onName(e.target.value)}
                style={{ ...smallInputStyle, height: 40, fontSize: 14, fontWeight: 500 }} />
            </Field>
            <Muted>Defined once, here; other schemas refer to it as {refName}.</Muted>
            <div style={{ flex: 1 }} />
            <IconBtn onClick={onDelGroup} title="Remove nested type">✕</IconBtn>
          </>
        )}
      </div>
      {fields.map((f, fi) => (
        <FieldRow
          key={fi}
          f={f}
          ownerId={ownerId}
          world={world}
          onField={(prop, val) => onFieldChange(fi, prop, val)}
          onKind={(val) => onKindChange(fi, val)}
          onDel={() => onDelField(fi)}
        />
      ))}
      <AddButton size="sm" onClick={onAddField}>+ Add field</AddButton>
    </div>
  );
}

export function SchemaEditor({ kind, schema, ownerId, world, onChange }) {
  // Mutate a deep copy and bubble up.
  const upd = (mut) => {
    const next = JSON.parse(JSON.stringify(schema));
    mut(next);
    onChange(next);
  };
  const arrOf = (s, gi) => (gi === 0 ? s.fields : s.nested[gi - 1].fields);

  const on = schema.mode !== "link";
  const tabBtn = (active, onClick, label, side) => (
    <button
      onClick={onClick}
      style={{
        height: 32,
        padding: "0 14px",
        background: active ? C.accentBg : "transparent",
        color: active ? C.accent : C.textDim,
        border: `1px solid ${active ? C.accentLine : C.lineStrong}`,
        borderLeft: side === "right" ? 0 : undefined,
        borderRadius: side === "left" ? "4px 0 0 4px" : "0 4px 4px 0",
        fontSize: 12,
        fontWeight: 500,
        letterSpacing: "0.4px",
        textTransform: "uppercase",
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );

  const preview = schemaPreview(schema, ownerId, world);

  const ownerName = (world[ownerId] && world[ownerId].name) || "Owner";

  // Locate every inline `{ … }` shape across the root and nested blocks. Each is
  // lifted into its own block (a render-only decomposition: the shape stays
  // stored as the field's inline string, and member edits are serialised back
  // into that same field's `b`). `loc` points at the owning field so edits and
  // the "remove shape" control reach it.
  const fmt1 = (f) => fmtType(f, ownerId, world);
  const inlineBlocks = [];
  const collectInline = (fields, loc) => {
    fields.forEach((f, fi) => {
      if (f.k === "inline") {
        inlineBlocks.push({
          key: loc.key + ":inline:" + fi,
          fieldName: f.n,
          loc: { ...loc, fi },
          members: parseInlineMembers(f.b),
        });
      }
    });
  };
  collectInline(schema.fields, { key: "root", gi: 0 });
  schema.nested.forEach((nt, ni) => collectInline(nt.fields, { key: "n" + ni, gi: ni + 1 }));

  // Write member rows back into the owning field's inline string.
  const writeMembers = (loc, members) => upd((s) => {
    arrOf(s, loc.gi)[loc.fi].b = writeInlineMembers(members, fmt1);
  });

  const groups = [
    { gi: 0, isNested: false, title: kind === "DataObject" ? "Fields" : "Payload fields", fields: schema.fields },
    ...schema.nested.map((nt, ni) => ({
      gi: ni + 1,
      isNested: !nt.embedded,   // a named nested type gets the type-name header
      isEmbed: !!nt.embedded,   // an embedded shape gets the field-name header
      nt,
      ni,
      fields: nt.fields,
    })),
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: "8px 12px" }}>
        <span style={{ fontSize: 13, fontWeight: 500, color: C.text }}>
          {kind === "DataObject" ? "Schema: the fields it holds" : "Schema: what the event carries"}
        </span>
        <div style={{ display: "inline-flex" }}>
          {tabBtn(on, () => upd((s) => { s.mode = "fields"; }), "Describe fields", "left")}
          {tabBtn(!on, () => upd((s) => { s.mode = "link"; }), "Link to an existing spec", "right")}
        </div>
      </div>
      <Muted>
        Core type notation: string · integer · decimal · boolean · uuid · date-time · enum(a, b) · T[] · T[1..] · T? · Order · Order.Line Item · Order {"{ id, status }"}
      </Muted>

      {!on && (
        <Field label="Link to a schema (AsyncAPI, JSON Schema, Avro…)" hint="Use this when the shape already exists elsewhere, instead of describing it again.">
          <input placeholder="https://" value={schema.link} onChange={(e) => upd((s) => { s.link = e.target.value; })}
            style={{ height: 40, boxSizing: "border-box", width: "100%", background: "transparent", border: `1px solid ${C.lineStrong}`, borderRadius: 4, padding: "0 12px", color: C.text, fontSize: 14 }} />
        </Field>
      )}

      {on && (
        <>
          {groups.map((g) => (
            <Group
              key={g.gi}
              title={g.title}
              isNested={g.isNested}
              isInline={g.isEmbed}
              name={g.isNested ? g.nt.n : g.isEmbed ? g.nt.n : ""}
              refName={g.isNested ? `${ownerName}.${g.nt.n || "Type"}` : ownerName}
              fields={g.fields}
              ownerId={ownerId}
              world={world}
              onFieldChange={(fi, prop, val) => upd((s) => { arrOf(s, g.gi)[fi][prop] = val; })}
              onKindChange={(fi, val) => upd((s) => { const r = arrOf(s, g.gi)[fi]; r.k = val; r.a = val === "prim" ? "string" : ""; r.b = ""; })}
              onDelField={(fi) => upd((s) => { arrOf(s, g.gi).splice(fi, 1); })}
              onAddField={() => upd((s) => { arrOf(s, g.gi).push(F("", "", "", "", "", false)); })}
              onName={g.isNested ? (val) => upd((s) => { s.nested[g.ni].n = val; }) : undefined}
              onDelGroup={
                g.isNested
                  ? () => upd((s) => { s.nested.splice(g.ni, 1); })
                  : g.isEmbed
                    ? () => upd((s) => {
                        const blockId = s.nested[g.ni].id;
                        s.nested.splice(g.ni, 1);
                        // Drop the embed field that pointed at this block.
                        s.fields = s.fields.filter((f) => !(f.k === "embed" && f.a === blockId));
                      })
                    : undefined
              }
            />
          ))}
          {inlineBlocks.map((ib) => (
            <Group
              key={ib.key}
              isInline
              name={ib.fieldName || "(unnamed field)"}
              refName={ownerName}
              fields={ib.members}
              ownerId={ownerId}
              world={world}
              onFieldChange={(fi, prop, val) => { const m = ib.members.map((x) => ({ ...x })); m[fi][prop] = val; writeMembers(ib.loc, m); }}
              onKindChange={(fi, val) => { const m = ib.members.map((x) => ({ ...x })); const r = m[fi]; r.k = val; r.a = val === "prim" ? "string" : ""; r.b = ""; writeMembers(ib.loc, m); }}
              onDelField={(fi) => { const m = ib.members.filter((_, i) => i !== fi); writeMembers(ib.loc, m); }}
              onAddField={() => { const m = [...ib.members.map((x) => ({ ...x })), F("", "", "", "", "", false)]; writeMembers(ib.loc, m); }}
              onDelGroup={() => upd((s) => { const r = arrOf(s, ib.loc.gi)[ib.loc.fi]; r.k = ""; r.b = ""; })}
            />
          ))}
          {kind === "DataObject" && (
            <AddButton onClick={() => upd((s) => {
              let name = "New Type";
              let k = 2;
              while (s.nested.some((x) => x.n === name)) { name = "New Type " + k; k += 1; }
              s.nested.push({ id: "n" + s.seq, n: name, fields: [] });
              s.seq += 1;
            })}>+ Add nested type</AddButton>
          )}
        </>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <Muted>As written in Contour</Muted>
        <pre style={{ margin: 0, padding: "12px 14px", background: C.code, borderRadius: 4, fontFamily: MONO, fontSize: 13, lineHeight: 1.6, color: C.text, whiteSpace: "pre-wrap", overflowX: "auto" }}>
          {preview}
        </pre>
      </div>
    </div>
  );
}
