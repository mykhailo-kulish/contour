// The Interface editor (contour.md §3.3): a channel that serves one caller,
// carries a binding (style + free-form keys that style interprets), and exposes
// a set of the System's Functions, each with an operation, a request shape and
// a per-outcome responses map. The Component the Interface sits on is derived
// from what it exposes (never chosen here), so it is shown read-only.
//
// Mirrors the Meanings UI record: `serves` is chosen from the System's Actors
// plus the reserved word `System`; the responses editor offers each exposed
// Function's real outcomes (result + alternatives) as the rows to fill in, so
// responses stay aligned with the Function. Binds to the editing buffer and
// reports changes up through onPatch.
import { C } from "../theme.js";
import { selectStyle, inputStyle, smallInputStyle, smallSelectStyle } from "../theme.js";
import { AddButton, Block, Field, IconBtn, Muted, SectionHead } from "./primitives.jsx";
import { ShapeEditor } from "./ShapeEditor.jsx";
import { readShape } from "../model.js";

// The binding styles Contour names (contour.md §3.3). A free-typed value is
// still allowed — the list is a convenience, not a constraint.
const STYLES = ["OpenAPI", "gRPC", "MCP", "AsyncAPI", "Web UI"];

// The outcomes a Function can end in (its result + alternatives), read from the
// hydrated world by name within the same System — so the responses editor lists
// exactly the outcomes a caller must be given something back for.
function outcomesOf(fnName, systemId, world) {
  const hit = Object.values(world || {}).find(
    (w) => w.kind === "Function" && w.name === fnName && (systemId == null || w.systemId === systemId),
  );
  if (!hit) return null;
  const out = [];
  if (hit.result) out.push(hit.result);
  (hit.altNames || []).forEach((a) => { if (out.indexOf(a) < 0) out.push(a); });
  return out;
}

// One Function the Interface exposes: its name (chosen from the System's
// Functions), an operation string, a request shape, and a responses map keyed
// by the Function's outcomes. The request and each response body are edited with
// the universal ShapeEditor; references are scoped to the owning Component's
// Data Objects (contour.md §3.3 check 4) via refScopeIds.
function ExposeRow({ row, i, world, selfId, selfSystemId, functionOptions, refScopeIds, onChange, onDel, onOpen }) {
  const outcomes = outcomesOf(row.fn, selfSystemId, world);
  const fnEl = Object.values(world || {}).find((w) => w.kind === "Function" && w.name === row.fn && (selfSystemId == null || w.systemId === selfSystemId));
  const setResponse = (outcome, resp) => {
    const responses = { ...(row.responses || {}) };
    responses[outcome] = resp;
    onChange({ responses });
  };
  const clearResponse = (outcome) => {
    const responses = { ...(row.responses || {}) };
    delete responses[outcome];
    onChange({ responses });
  };
  // Any response keys the Function no longer has an outcome for (stale) are
  // still shown so nothing is silently dropped while editing.
  const stale = Object.keys(row.responses || {}).filter((k) => !outcomes || outcomes.indexOf(k) < 0);

  const responseRow = (o, isStale) => {
    const resp = row.responses?.[o] || { code: "", body: null };
    return (
      <div key={o} style={{ display: "flex", flexDirection: "column", gap: 8, background: C.panel, border: `1px solid ${C.line}`, borderRadius: 4, padding: "10px 12px" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 10px", alignItems: "center" }}>
          <span style={{ flex: "0 1 180px", fontSize: 13, color: isStale ? C.amber : C.text, fontWeight: 500 }}>
            {o}{isStale ? " (no such outcome)" : ""}
          </span>
          <span style={{ color: C.textDim }} aria-hidden="true">→</span>
          <input aria-label={`Code for ${o}`} placeholder="e.g. 200, 404, OK, NOT_FOUND"
            value={resp.code || ""} onChange={(e) => setResponse(o, { ...resp, code: e.target.value })}
            style={{ ...smallInputStyle, flex: "0 1 200px" }} />
          {resp.body
            ? <button type="button" onClick={() => setResponse(o, { ...resp, body: null })} title="Remove the body shape"
                style={{ background: "transparent", border: `1px solid ${C.lineStrong}`, color: C.textDim, borderRadius: 4, height: 36, padding: "0 10px", fontSize: 12, cursor: "pointer" }}>Remove body</button>
            : <button type="button" onClick={() => setResponse(o, { ...resp, body: readShape(null) })} title="Add a body shape"
                style={{ background: "transparent", border: `1px solid ${C.accentLine}`, color: C.accent, borderRadius: 4, height: 36, padding: "0 10px", fontSize: 12, cursor: "pointer" }}>+ Body</button>}
          <IconBtn onClick={() => clearResponse(o)} title="Clear this response">✕</IconBtn>
        </div>
        {resp.body && (
          <div style={{ marginLeft: 8, borderLeft: `2px solid ${C.line}`, paddingLeft: 12 }}>
            <ShapeEditor
              schema={resp.body}
              ownerId={selfId}
              world={world}
              onChange={(body) => setResponse(o, { ...resp, body })}
              title="Body"
              fieldsTitle="Body fields"
              refScopeIds={refScopeIds}
              notationHint={false}
            />
          </div>
        )}
      </div>
    );
  };

  return (
    <Block>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 10px", alignItems: "flex-end" }}>
        <Field label="Function" bg={C.panel} flex="1 1 220px">
          <select aria-label="Exposed Function" value={row.fn} onChange={(e) => onChange({ fn: e.target.value })} style={selectStyle}>
            <option value="">{row.fn && !functionOptions.some((o) => o.v === row.fn) ? row.fn : "Choose a Function…"}</option>
            {functionOptions.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
          </select>
        </Field>
        {row.fn && fnEl && (
          <button type="button" onClick={() => onOpen(fnEl.id)} title="Open this Function"
            style={{ background: "transparent", border: `1px solid ${C.accentLine}`, color: C.accent, borderRadius: 4, height: 40, padding: "0 12px", fontSize: 13, cursor: "pointer" }}>
            Open ›
          </button>
        )}
        <IconBtn size={40} onClick={onDel} title="Remove from exposes">✕</IconBtn>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 10px" }}>
        <Field label="Operation" bg={C.panel} flex="1 1 200px" hint="In the style’s own terms (e.g. GET /{id}, GetOrder).">
          <input aria-label="Operation" placeholder="e.g. GET /{id}" value={row.operation} onChange={(e) => onChange({ operation: e.target.value })} style={inputStyle} />
        </Field>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginLeft: 4, borderLeft: `2px solid ${C.line}`, paddingLeft: 14 }}>
        <Muted>Request: what the caller sends.</Muted>
        <ShapeEditor
          schema={row.request || readShape(null)}
          ownerId={selfId}
          world={world}
          onChange={(request) => onChange({ request })}
          title=""
          fieldsTitle="Request fields"
          refScopeIds={refScopeIds}
        />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginLeft: 4, borderLeft: `2px solid ${C.line}`, paddingLeft: 14 }}>
        <Muted>Responses: what the caller gets back for each outcome.</Muted>
        {outcomes && outcomes.length === 0 && <Muted style={{ color: C.amber }}>This Function has no outcomes yet.</Muted>}
        {!outcomes && row.fn && <Muted style={{ color: C.amber }}>“{row.fn}” isn’t a Function of this System.</Muted>}
        {(outcomes || []).map((o) => responseRow(o, false))}
        {stale.map((o) => responseRow(o, true))}
      </div>
    </Block>
  );
}

export function InterfaceEditor({ el, world, elementsById, onPatch, onOpen }) {
  const binding = el.binding || { style: "", keys: [] };
  const exposes = el.exposes || [];

  // serves options: the System's Actors by name, plus the reserved `System`.
  const actorNames = Object.values(elementsById || {})
    .filter((e) => e.kind === "Actor")
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));
  const servesOptions = ["System", ...actorNames];

  // The System's Functions available to expose.
  const functionOptions = Object.values(elementsById || {})
    .filter((e) => e.kind === "Function")
    .map((e) => ({ v: e.name, l: e.name }))
    .sort((a, b) => a.l.localeCompare(b.l));

  // The Component this Interface sits on: whichever performs everything it
  // exposes (derived — contour.md §3.3). Shown read-only, and its owned Data
  // Objects bound what a request/response body may reference (check 4).
  const ownerComponent = (() => {
    const names = exposes.map((r) => r.fn).filter(Boolean);
    if (!names.length) return null;
    return Object.values(elementsById || {}).find(
      (e) => e.kind === "Component" && names.every((n) => (e.performs || []).includes(n)),
    ) || null;
  })();
  const derivedComponent = ownerComponent ? ownerComponent.name : null;

  // The ids of the Data Objects the owning Component owns — the only ones a
  // request or response body may reference (contour.md §3.3 check 4). Null until
  // a Component is derived, meaning "no scope known yet" (offer all), so an
  // Interface whose exposes aren't yet allocated can still be edited.
  const refScopeIds = (() => {
    if (!ownerComponent) return null;
    const owned = new Set(ownerComponent.owns || []);
    if (!owned.size) return new Set(); // owns nothing → reference nothing
    const ids = Object.values(elementsById || {})
      .filter((e) => e.kind === "DataObject" && owned.has(e.name))
      .map((e) => e.id);
    return new Set(ids);
  })();

  const setBinding = (p) => onPatch({ binding: { ...binding, ...p } });
  const setKey = (i, p) => setBinding({ keys: binding.keys.map((k, j) => (j === i ? { ...k, ...p } : k)) });
  const delKey = (i) => setBinding({ keys: binding.keys.filter((_, j) => j !== i) });
  const addKey = () => setBinding({ keys: [...binding.keys, { k: "", v: "" }] });

  const setRow = (i, p) => onPatch({ exposes: exposes.map((r, j) => (j === i ? { ...r, ...p } : r)) });
  const delRow = (i) => onPatch({ exposes: exposes.filter((_, j) => j !== i) });
  const addRow = () => onPatch({ exposes: [...exposes, { fn: "", operation: "", request: "", responses: {} }] });

  const styleKnown = !binding.style || STYLES.indexOf(binding.style) >= 0;

  return (
    <>
      {/* Serves: the one caller this channel is for. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <SectionHead title="Serves: the one caller this channel is for" hint="An Actor of this System, or System for this System’s own Components." />
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 12px" }}>
          <Field label="Serves" flex="0 1 320px">
            <select aria-label="Serves" value={el.serves || ""} onChange={(e) => onPatch({ serves: e.target.value })} style={selectStyle}>
              <option value="">{el.serves && servesOptions.indexOf(el.serves) < 0 ? el.serves : "Choose a caller…"}</option>
              {servesOptions.map((n) => <option key={n} value={n}>{n === "System" ? "System (this System’s own Components)" : n}</option>)}
            </select>
          </Field>
        </div>
      </div>

      {/* Binding: style + the free-form keys that style interprets. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <SectionHead title="Binding: the channel’s technology" hint="style is fixed; every other key is interpreted by that style." />
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 12px" }}>
          <Field label="Style" flex="0 1 320px">
            <input aria-label="Binding style" list="iface-styles" placeholder="e.g. OpenAPI" value={binding.style}
              onChange={(e) => setBinding({ style: e.target.value })} style={inputStyle} />
            <datalist id="iface-styles">{STYLES.map((s) => <option key={s} value={s} />)}</datalist>
          </Field>
        </div>
        {!styleKnown && <Muted>“{binding.style}” isn’t one of the common styles — make sure a binding exists for it.</Muted>}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {binding.keys.map((row, i) => (
            <div key={i} style={{ display: "flex", flexWrap: "wrap", gap: "8px 10px", alignItems: "center" }}>
              <input aria-label="Binding key" placeholder="key (e.g. base, auth, errors)" value={row.k}
                onChange={(e) => setKey(i, { k: e.target.value })} style={{ ...smallInputStyle, flex: "0 1 200px" }} />
              <span style={{ color: C.textDim }} aria-hidden="true">:</span>
              <input aria-label="Binding value" placeholder="value" value={row.v}
                onChange={(e) => setKey(i, { v: e.target.value })} style={{ ...smallInputStyle, flex: "1 1 240px" }} />
              <IconBtn onClick={() => delKey(i)} title="Remove binding key">✕</IconBtn>
            </div>
          ))}
          <AddButton size="sm" onClick={addKey}>+ Add binding key</AddButton>
        </div>
      </div>

      {/* Exposes: the Functions this channel makes reachable. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <SectionHead
          title="Exposes: the Functions it makes reachable"
          hint="Each with its operation, request and per-outcome responses."
          right={derivedComponent ? <Muted>Sits on <span style={{ color: C.text }}>{derivedComponent}</span></Muted> : null}
        />
        {exposes.length === 0 && <Muted style={{ fontSize: 13 }}>Exposes nothing yet.</Muted>}
        {exposes.map((row, i) => (
          <ExposeRow key={i} row={row} i={i} world={world} selfId={el.id} selfSystemId={el.systemId} functionOptions={functionOptions}
            refScopeIds={refScopeIds} onChange={(p) => setRow(i, p)} onDel={() => delRow(i)} onOpen={onOpen} />
        ))}
        <AddButton size="lg" onClick={addRow}>+ Expose a Function</AddButton>
      </div>
    </>
  );
}
