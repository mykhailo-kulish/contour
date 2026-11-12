// The center pane: dispatches to the right body for the selected element's kind
// and owns the local editing buffer + Save. The buffer is seeded from the loaded
// element and patched as the user types; Save serializes it to a Store Element
// request and hands it to useModel (which calls the BFF -> Contour). Nothing is
// persisted locally.
import { useEffect, useState } from "react";
import { C } from "../theme.js";
import { EditorHeader, DescriptionField, descLabel } from "./EditorHeader.jsx";
import { FunctionEditor } from "./FunctionEditor.jsx";
import { InterfaceEditor } from "./InterfaceEditor.jsx";
import { SchemaEditor } from "./SchemaEditor.jsx";
import { ReqGuardPanel } from "./ReqGuardPanel.jsx";
import { DiagramView } from "./DiagramView.jsx";
import { AddButton } from "./primitives.jsx";
import { writeSteps, writeAlternatives, writeSchema, writeBinding, writeExposes, fmtType } from "../model.js";

const isDef = (k) => k === "Requirement" || k === "Guardrail";

// Build the Store Element record body from the editing buffer, by kind.
function buildRecord(buf, world) {
  const body = {};
  if (buf.description && buf.description.trim()) body.description = buf.description.trim();
  if (buf.kind === "Function") {
    const steps = writeSteps(buf.steps);
    if (steps.length) body.steps = steps;
    if (String(buf.result || "").trim()) body.result = buf.result.trim();
    const alts = writeAlternatives(buf.alts);
    if (Object.keys(alts).length) body.alternatives = alts;
    if (String(buf.behavior || "").trim()) body.behavior = buf.behavior.trim();
  }
  if (buf.kind === "Actor" && buf.uses.length) body.uses = buf.uses;
  // A Component's allocation (performs/owns/produces) and rationale are not
  // edited in this form yet; carry the stored values through untouched so
  // saving a Component's description or attachments never drops its edges.
  if (buf.kind === "Component") {
    const src = buf.body || {};
    for (const k of ["performs", "owns", "produces", "rationale"]) {
      if (src[k] !== undefined) body[k] = src[k];
    }
  }
  if ((buf.kind === "DataObject" || buf.kind === "Event") && buf.schema) {
    const schema = writeSchema(buf.schema, (f) => fmtType(f, buf.id, world || {}));
    if (schema !== undefined) body.schema = schema;
  }
  // An Interface's channel record (contour.md §3.3): who it serves, its binding,
  // and the Functions it exposes with their operation/request/responses. The
  // Component it sits on is derived from `exposes`, never stored here.
  if (buf.kind === "Interface") {
    if (String(buf.serves || "").trim()) body.serves = buf.serves.trim();
    const binding = writeBinding(buf.binding);
    if (binding !== undefined) body.binding = binding;
    const exposes = writeExposes(buf.exposes, (f) => fmtType(f, buf.id, world || {}));
    if (exposes !== undefined) body.exposes = exposes;
    // Carry a stored rationale through untouched (not edited in this form yet).
    const src = buf.body || {};
    if (src.rationale !== undefined) body.rationale = src.rationale;
  }
  if (buf.requirements && buf.requirements.length) body.requirements = buf.requirements;
  if (buf.guardrails && buf.guardrails.length) body.guardrails = buf.guardrails;
  return body;
}

function Counts({ counts }) {
  const Card = ({ n, label }) => (
    <div style={{ flex: "1 1 140px", background: C.panel, border: `1px solid ${C.line}`, borderRadius: 4, padding: "16px 18px" }}>
      <div style={{ fontSize: 28, fontWeight: 500 }}>{n}</div>
      <div style={{ fontSize: 13, color: C.textDim }}>{label}</div>
    </div>
  );
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
      <Card n={counts.actors} label="Actors" />
      <Card n={counts.functions} label="Functions" />
      <Card n={counts.data} label="Data Objects" />
      <Card n={counts.events} label="Events" />
    </div>
  );
}

function UsesList({ uses, elementsById, status, onOpen, onNewFunction }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <span style={{ fontSize: 13, fontWeight: 500, color: C.text }}>Uses</span>
      {uses.map((name) => {
        const fn = Object.values(elementsById || {}).find((e) => e.kind === "Function" && e.name === name);
        const dot = fn ? ({ wrong: C.red, gaps: C.amber, complete: C.green }[status(fn)]) : C.amber;
        return (
          <button key={name} onClick={() => fn && onOpen(fn.id)}
            style={{ textAlign: "left", display: "flex", alignItems: "center", gap: 12, background: C.panel, border: `1px solid ${C.line}`, borderRadius: 4, padding: "12px 16px", color: C.text, cursor: "pointer", minHeight: 52 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: dot, flex: "none" }} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 15, fontWeight: 500 }}>{name}</span>
              <span style={{ display: "block", fontSize: 13, color: C.textDim, marginTop: 2 }}>{fn?.description || "—"}</span>
            </span>
            <span style={{ color: C.textDim, fontSize: 18 }} aria-hidden="true">›</span>
          </button>
        );
      })}
      {uses.length === 0 && <span style={{ fontSize: 13, color: C.textDim }}>No Functions yet.</span>}
      <AddButton size="lg" onClick={onNewFunction}>+ New Function for this Actor</AddButton>
    </div>
  );
}

export function Editor({
  element, world, elementsById, counts, reqOptions, grOptions,
  status, onOpen, onSave, onDefine, onNewFunction, saving, componentOfFunction, systemNameById,
  view: viewProp, onView,
}) {
  const [buf, setBuf] = useState(element);
  const [dirty, setDirty] = useState(false);
  const [viewState, setViewState] = useState("form"); // "form" | "diagram" (fallback when uncontrolled)
  // Controlled by App (for the shareable-view URL) when `onView` is given.
  const view = viewProp != null ? viewProp : viewState;
  const setView = (v) => { if (onView) onView(v); else setViewState(v); };

  // Reseed when the selected element changes (by id) or reloads (by version).
  // Reset to the form view whenever a different element is opened — unless the
  // view is controlled by App (which decides the pane, e.g. from the URL).
  useEffect(() => { setBuf(element); setDirty(false); if (onView == null) setViewState("form"); }, [element.id, element.version]);

  const patch = (p) => { setBuf((b) => ({ ...b, ...p })); setDirty(true); };
  const kind = buf.kind;
  // A diagram exists only for real stored elements (not Requirement/Guardrail
  // definition pseudo-elements, which carry "req:"/"gr:" ids and no graph).
  const hasDiagram = !isDef(kind) && !!buf.id;

  const save = async () => {
    if (isDef(kind)) {
      await onDefine(buf);
      setDirty(false);
      return;
    }
    const payload = {
      element: { id: buf.id || undefined, name: buf.name, elementType: kind, systemId: kind === "System" ? null : buf.systemId },
      record: buildRecord(buf, world),
      relationships: [], // step/ownership edges are derived from the record on save
    };
    await onSave(payload);
    setDirty(false);
  };

  return (
    <main style={{ flex: "1 1 480px", minWidth: 0, boxSizing: "border-box", padding: "28px 32px", display: "flex", flexDirection: "column", gap: 22, overflowY: "auto" }}>
      <EditorHeader
        kind={kind}
        sub={buf.sub}
        name={buf.name}
        onName={(v) => patch({ name: v })}
      />

      {hasDiagram && (
        <div style={{ display: "flex", gap: 2, alignSelf: "flex-start", background: C.panel, border: `1px solid ${C.line}`, borderRadius: 4, padding: 2 }}>
          {[["form", "Form"], ["diagram", "Diagram"]].map(([v, label]) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              style={{
                background: view === v ? C.accentBg : "transparent",
                color: view === v ? C.accent : C.textDim,
                border: view === v ? `1px solid ${C.accentLine}` : "1px solid transparent",
                borderRadius: 3, padding: "6px 16px", fontSize: 13, fontWeight: 500, cursor: "pointer",
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {view === "diagram" && hasDiagram && <DiagramView element={buf} />}

      {view === "form" && (
      <>
      <DescriptionField
        label={descLabel(kind)}
        value={buf.description}
        onChange={(v) => patch({ description: v })}
      />

      {kind === "System" && <Counts counts={counts} />}

      {kind === "Actor" && (
        <UsesList uses={buf.uses} elementsById={elementsById} status={status} onOpen={onOpen} onNewFunction={() => onNewFunction(buf)} />
      )}

      {kind === "Function" && (
        <FunctionEditor el={buf} world={world} elementsById={elementsById} componentOfFunction={componentOfFunction} systemNameById={systemNameById} onPatch={patch} onOpen={onOpen} />
      )}

      {kind === "Interface" && (
        <InterfaceEditor el={buf} world={world} elementsById={elementsById} onPatch={patch} onOpen={onOpen} />
      )}

      {(kind === "DataObject" || kind === "Event") && buf.schema && (
        <SchemaEditor kind={kind} schema={buf.schema} ownerId={buf.id} world={world} onChange={(schema) => patch({ schema })} />
      )}

      {!isDef(kind) && (
        <ReqGuardPanel
          requirements={buf.requirements}
          guardrails={buf.guardrails}
          reqOptions={reqOptions}
          grOptions={grOptions}
          onChange={(p) => patch(p)}
          onOpen={() => {}}
          onNewReq={async () => {
            // Define the reusable Requirement, then attach it to the *local*
            // buffer only — the element is written to Contour on Save, never on
            // create ("Nothing is saved until Save button is pressed").
            const name = await onDefine({ __newDef: "Requirement", attachTo: buf });
            if (name && !buf.requirements.includes(name)) patch({ requirements: [...buf.requirements, name] });
          }}
          onNewGr={async () => {
            const name = await onDefine({ __newDef: "Guardrail", attachTo: buf });
            if (name && !buf.guardrails.includes(name)) patch({ guardrails: [...buf.guardrails, name] });
          }}
        />
      )}

      <div style={{ display: "flex", gap: 10, alignItems: "center", paddingTop: 4 }}>
        <button
          onClick={save}
          disabled={saving}
          style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            background: dirty ? C.accent : "transparent",
            color: dirty ? "#0b0b0b" : C.text,
            border: `1px solid ${dirty ? C.accent : C.lineStrong}`,
            borderRadius: 4, padding: "0 18px", height: 40, fontSize: 14, fontWeight: 500,
            textTransform: "uppercase", letterSpacing: "0.4px", cursor: "pointer",
          }}
        >
          {saving ? "Saving…" : dirty ? "Save changes" : "Saved"}
        </button>
        {dirty && <span style={{ fontSize: 13, color: C.textDim }}>Unsaved changes — Contour will validate on save.</span>}
      </div>
      </>
      )}
    </main>
  );
}
