// The Function editor: ordered Steps (each a verb + target, with optional
// step-outcome "becomes" bindings when the step calls/uses another Function),
// Outcomes (the main result and named alternatives with a plain-language
// trigger and their own effects), Business rules, and the Data it touches.
// Mirrors the mockup; binds to the editing element and reports changes up.
import { C } from "../theme.js";
import { STEP_VERBS, EFFECT_VERBS, VERB_TEXT, typeLabel } from "../api.js";
import { AddButton, Block, Field, IconBtn, Muted, SectionHead } from "./primitives.jsx";
import { SearchableSelect } from "./SearchableSelect.jsx";
import { DescriptionField } from "./EditorHeader.jsx";
import { smallSelectStyle, selectStyle, inputStyle } from "../theme.js";
import { dataTouched, calleeOutcomes } from "../model.js";

// Flat target options for a step verb (everything except `uses` and
// `consumes`, which are grouped by System — see usesGroups / eventGroups).
// Scoped per contour.md:
//   reads/modifies → Data Objects of the same System
//   produces → an Event of the same System (you only produce your own Events)
//   calls → Functions of the SAME COMPONENT as the editing Function; if the
//           System isn't split into Components yet, the System's Functions.
// `consumes` is NOT flat here: it subscribes to an Event another Component
// produces (usually in another System), so its options are every Event in the
// model, grouped by System — see eventGroups and the Step renderer.
function targetOptions(verb, world, self, componentOfFunction) {
  const none = [{ v: "", l: verb ? "Choose…" : "Choose what it does first" }];
  const sysId = self.systemId;
  const inSystem = (id) => sysId == null || world[id].systemId === sysId;
  const ofKind = (k) => Object.keys(world).filter((id) => world[id].kind === k && inSystem(id)).map((id) => ({ v: world[id].name, l: world[id].name }));
  if (verb === "reads" || verb === "modifies") return none.concat(ofKind("DataObject"));
  if (verb === "produces") return none.concat(ofKind("Event"));
  if (verb === "calls") {
    const comp = componentOfFunction ? componentOfFunction({ kind: "Function", name: self.name, systemId: sysId }) : null;
    let fnNames;
    if (comp) {
      // Same Component: the Functions that Component performs (minus self).
      fnNames = (comp.performs || []).filter((n) => n !== self.name);
    } else {
      // Not split into Components yet: offer the System's Functions.
      fnNames = Object.keys(world)
        .filter((id) => world[id].kind === "Function" && inSystem(id) && id !== self.id)
        .map((id) => world[id].name);
    }
    return none.concat([...new Set(fnNames)].map((n) => ({ v: n, l: n })));
  }
  return none;
}

// Grouped options for a `uses` step: every Function reachable through an
// Interface, offered as "Interface / Function" and grouped by System — the own
// System first. Own-System entries come from Interfaces that serve `System`;
// other Systems' entries from their Interfaces (serving this System as Actor).
// Returns [{ system, options:[{v,l}] }]. (contour.md §3.3: a uses step names
// "Interface / Function"; within a System the Interface serves `System`.)
function usesGroups(world, selfSystemId, systemNameById) {
  const bySystem = new Map(); // systemId -> [{v,l}]
  Object.values(world).forEach((iface) => {
    if (iface.kind !== "Interface") return;
    const own = iface.systemId === selfSystemId;
    if (own && iface.serves !== "System") return; // internal uses goes through serves:System
    (iface.exposes || []).forEach((fnName) => {
      const opt = { v: `${iface.name} / ${fnName}`, l: `${iface.name} / ${fnName}` };
      const arr = bySystem.get(iface.systemId) || [];
      arr.push(opt);
      bySystem.set(iface.systemId, arr);
    });
  });
  const groups = [];
  const push = (sid) => {
    const opts = bySystem.get(sid);
    if (opts && opts.length) groups.push({ system: systemNameById[sid] || "System", options: opts });
  };
  push(selfSystemId); // own System first
  [...bySystem.keys()].filter((sid) => sid !== selfSystemId).sort((a, b) => (systemNameById[a] || "").localeCompare(systemNameById[b] || "")).forEach(push);
  return groups;
}

// Grouped options for a `consumes` step: EVERY Event in the whole model,
// grouped by System with the own System first, each option labelled with the
// Event's owning Component (when derivable) to disambiguate same-named Events.
// A consumes step subscribes to an Event another Component produces — usually
// in another System (contour.md §3.4) — so, unlike `produces`, the picker is
// never scoped to the own System. The stored value is the bare Event name
// (names resolve across the model for consumes); the label adds context only.
// Returns [{ system, options:[{v,l}] }].
function eventGroups(world, selfSystemId, systemNameById) {
  // owning Component per (systemId, eventName), from each Component's produces.
  const ownerOf = (ev) => {
    const comp = Object.values(world).find(
      (w) => w.kind === "Component" && w.systemId === ev.systemId && (w.produces || []).indexOf(ev.name) >= 0,
    );
    return comp ? comp.name : null;
  };
  const bySystem = new Map(); // systemId -> [{v,l}]
  Object.values(world).forEach((ev) => {
    if (ev.kind !== "Event") return;
    const owner = ownerOf(ev);
    const opt = { v: ev.name, l: owner ? `${ev.name}  ·  ${owner}` : ev.name };
    const arr = bySystem.get(ev.systemId) || [];
    arr.push(opt);
    bySystem.set(ev.systemId, arr);
  });
  const groups = [];
  const push = (sid) => {
    const opts = bySystem.get(sid);
    if (opts && opts.length) groups.push({ system: systemNameById[sid] || "System", options: opts });
  };
  push(selfSystemId); // own System first
  [...bySystem.keys()].filter((sid) => sid !== selfSystemId).sort((a, b) => (systemNameById[a] || "").localeCompare(systemNameById[b] || "")).forEach(push);
  return groups;
}

function verbOptions(keys) {
  return [{ v: "", l: "Choose…" }].concat(keys.map((k) => ({ v: k, l: VERB_TEXT[k] })));
}

// The callee's outcomes are resolved by the shared model helper (calls → same
// System; uses → Interface/Function across Systems). We offer the callee's
// result and alternatives as mappable endings, plus Unreachable for `uses`.

function Step({ i, s, total, ownOutcomes, world, selfId, selfName, selfSystemId, componentOfFunction, systemNameById, onChange, onMove, onDel }) {
  const keys = i === 0 || s.verb === "consumes" ? STEP_VERBS : STEP_VERBS.filter((k) => k !== "consumes");
  const callee = calleeOutcomes(s, { systemId: selfSystemId }, world);
  const usesUnreachable = s.verb === "uses" && s.target;
  const becomeRow = (key, required) => (
    <div key={key} style={{ display: "flex", flexWrap: "wrap", gap: "6px 10px", alignItems: "center" }}>
      <span style={{ flex: "0 1 170px", fontSize: 13, color: C.text }}>
        <span style={{ fontWeight: 500 }}>{key}</span>
      </span>
      <span style={{ color: C.textDim }} aria-hidden="true">→</span>
      <select
        aria-label={`What ${key} becomes`}
        value={s.becomes[key] || ""}
        onChange={(e) => {
          const v = e.target.value;
          const becomes = { ...s.becomes };
          if (v) becomes[key] = v; else delete becomes[key];
          onChange({ becomes });
        }}
        style={{ ...smallSelectStyle, height: 36, flex: "0 1 260px" }}
      >
        <option value="">{required ? "— choose —" : "Continues the main path"}</option>
        {ownOutcomes.map((n) => <option key={n} value={n}>Ends as {n}</option>)}
      </select>
      {required && (
        <span style={{ fontSize: 11, color: C.amber, border: `1px solid rgba(255,167,38,0.5)`, borderRadius: 16, padding: "2px 8px" }}>Required</span>
      )}
    </div>
  );
  const rows = [];
  // Offer every one of the callee's real endings — its result and each
  // alternative — as a mappable row (optional: unmapped continues the main
  // path). Only a `uses` step's Unreachable is required (contour.md §3.3).
  if (callee) {
    const endings = [];
    if (callee.result) endings.push(callee.result);
    callee.alts.forEach((a) => { if (endings.indexOf(a) < 0) endings.push(a); });
    endings.forEach((k) => rows.push(becomeRow(k, false)));
  }
  if (usesUnreachable) rows.push(becomeRow("Unreachable", true));

  return (
    <Block>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 10px", alignItems: "center" }}>
        <span style={{ width: 24, height: 24, borderRadius: "50%", background: C.accentBg, color: C.accent, fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
          {i + 1}
        </span>
        <select aria-label="Step verb" value={s.verb} onChange={(e) => onChange({ verb: e.target.value, target: "", becomes: {} })} style={{ ...selectStyle, flex: "0 1 330px" }}>
          {verbOptions(keys).map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
        </select>
        {s.verb === "uses" || s.verb === "consumes" ? (() => {
          const groups = s.verb === "uses"
            ? usesGroups(world, selfSystemId, systemNameById)
            : eventGroups(world, selfSystemId, systemNameById);
          const placeholder = s.verb === "uses" ? "Choose an Interface / Function…" : "Choose an Event…";
          return (
            <SearchableSelect
              ariaLabel="Step target"
              groups={groups}
              value={s.target}
              placeholder={placeholder}
              onChange={(v) => onChange({ target: v, becomes: {} })}
              style={{ flex: "1 1 220px" }}
            />
          );
        })() : (
          <select aria-label="Step target" value={s.target} onChange={(e) => onChange({ target: e.target.value, becomes: {} })} style={{ ...selectStyle, flex: "1 1 220px" }}>
            {targetOptions(s.verb, world, { id: selfId, name: selfName, systemId: selfSystemId }, componentOfFunction).map((o, k) => <option key={k} value={o.v}>{o.l}</option>)}
          </select>
        )}
        <IconBtn size={40} color={C.textFaint} onClick={() => onMove(-1)} disabled={i === 0} title="Move step up">↑</IconBtn>
        <IconBtn size={40} color={C.textFaint} onClick={() => onMove(1)} disabled={i === total - 1} title="Move step down">↓</IconBtn>
        <IconBtn size={40} onClick={onDel} title="Remove step">✕</IconBtn>
      </div>
      {rows.length > 0 && (
        <div style={{ marginLeft: 34, borderLeft: `2px solid ${C.line}`, paddingLeft: 14, display: "flex", flexDirection: "column", gap: 8 }}>
          <Muted>How its endings change how this Function ends</Muted>
          {rows}
          {callee && callee.result && <Muted>Unless mapped above, “{callee.result}” continues to the next step.</Muted>}
        </div>
      )}
    </Block>
  );
}

function Alternative({ i, a, world, selfId, selfName, selfSystemId, componentOfFunction, onChange, onDel }) {
  const effRow = (e, j) => (
    <div key={j} style={{ display: "flex", flexWrap: "wrap", gap: "8px 10px", alignItems: "center" }}>
      <select aria-label="Effect verb" value={e.verb} onChange={(ev) => {
        const effects = a.effects.map((x, k) => (k === j ? { verb: ev.target.value, target: "" } : x));
        onChange({ effects });
      }} style={{ ...smallSelectStyle, flex: "0 1 260px" }}>
        {verbOptions(EFFECT_VERBS).map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
      </select>
      <select aria-label="Effect target" value={e.target} onChange={(ev) => {
        const effects = a.effects.map((x, k) => (k === j ? { ...x, target: ev.target.value } : x));
        onChange({ effects });
      }} style={{ ...smallSelectStyle, flex: "1 1 200px" }}>
        {targetOptions(e.verb, world, { id: selfId, name: selfName, systemId: selfSystemId }, componentOfFunction).map((o, k) => <option key={k} value={o.v}>{o.l}</option>)}
      </select>
      <IconBtn onClick={() => onChange({ effects: a.effects.filter((_, k) => k !== j) })} title="Remove effect">✕</IconBtn>
    </div>
  );
  return (
    <Block accent={C.amber}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 12px", alignItems: "flex-end" }}>
        <Field label="Alternative" bg={C.panel} flex="0 1 220px">
          <input aria-label="Alternative name" placeholder="e.g. Already Shipped" value={a.name} onChange={(e) => onChange({ name: e.target.value })}
            style={{ ...inputStyle, fontWeight: 500 }} />
        </Field>
        <Field label="When does this happen?" bg={C.panel} flex="1 1 260px">
          <input aria-label="When this alternative happens" placeholder="Plain language" value={a.when} onChange={(e) => onChange({ when: e.target.value })} style={inputStyle} />
        </Field>
        <IconBtn size={40} onClick={onDel} title="Remove alternative">✕</IconBtn>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <Muted>{a.effects.length ? "Instead of the main path, it also:" : "Leaves nothing changed."}</Muted>
        {a.effects.map(effRow)}
        <AddButton size="sm" onClick={() => onChange({ effects: [...a.effects, { verb: "", target: "" }] })}>+ It also does something</AddButton>
      </div>
    </Block>
  );
}

export function FunctionEditor({ el, world, elementsById, componentOfFunction, systemNameById, onPatch, onOpen }) {
  const steps = el.steps;
  const alts = el.alts;
  const ownOutcomes = [...(el.result ? [el.result] : []), ...alts.map((a) => a.name).filter(Boolean)];

  const setStep = (i, patch) => onPatch({ steps: steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const moveStep = (i, d) => {
    const j = i + d;
    if (j < 0 || j >= steps.length) return;
    const next = steps.slice();
    [next[i], next[j]] = [next[j], next[i]];
    onPatch({ steps: next });
  };
  const delStep = (i) => onPatch({ steps: steps.filter((_, j) => j !== i) });
  const addStep = () => onPatch({ steps: [...steps, { verb: "", target: "", becomes: {} }] });

  const setAlt = (i, patch) => onPatch({ alts: alts.map((a, j) => (j === i ? { ...a, ...patch } : a)) });
  const delAlt = (i) => onPatch({ alts: alts.filter((_, j) => j !== i) });
  const addAlt = () => {
    let name = "New Outcome";
    let k = 2;
    while (alts.some((a) => a.name === name) || el.result === name) { name = "New Outcome " + k; k += 1; }
    onPatch({ alts: [...alts, { name, when: "", effects: [] }] });
  };

  const touched = dataTouched(steps, alts);

  return (
    <>
      {/* Steps */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <SectionHead title="Steps: the main path, in order" hint="One verb and one target per step. A straight line: no branches." />
        {steps.map((s, i) => (
          <Step
            key={i}
            i={i}
            s={s}
            total={steps.length}
            ownOutcomes={ownOutcomes}
            world={world}
            selfId={el.id}
            selfName={el.name}
            selfSystemId={el.systemId}
            componentOfFunction={componentOfFunction}
            systemNameById={systemNameById}
            onChange={(patch) => setStep(i, patch)}
            onMove={(d) => moveStep(i, d)}
            onDel={() => delStep(i)}
          />
        ))}
        <AddButton size="lg" onClick={addStep}>+ Add step</AddButton>
      </div>

      {/* Outcomes */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <SectionHead title="Outcomes: every way it can end" hint="Named for the result, not the check: “Already Shipped”, not “Validation Failed”." />
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 12px", alignItems: "flex-end", borderLeft: `3px solid ${C.green}`, background: C.panel, borderRadius: "0 4px 4px 0", padding: "10px 12px 10px 14px" }}>
          <Field label="Main result" bg={C.panel} flex="0 1 260px">
            <input placeholder="e.g. Placed" value={el.result} onChange={(e) => onPatch({ result: e.target.value })} style={{ ...inputStyle, fontWeight: 500 }} />
          </Field>
          <span style={{ flex: "1 1 200px", fontSize: 12, color: C.textDim, paddingBottom: 12 }}>Its effects are exactly the steps above.</span>
        </div>
        {alts.map((a, i) => (
          <Alternative key={i} i={i} a={a} world={world} selfId={el.id} selfName={el.name} selfSystemId={el.systemId} componentOfFunction={componentOfFunction} onChange={(patch) => setAlt(i, patch)} onDel={() => delAlt(i)} />
        ))}
        <AddButton size="lg" onClick={addAlt}>+ Add alternative</AddButton>
      </div>

      {/* Business rules */}
      <DescriptionField
        label="Business rules"
        value={el.behavior}
        onChange={(v) => onPatch({ behavior: v })}
        placeholder="e.g. A customer may cancel an order only before it ships."
        hint="What the steps and outcomes don’t express."
      />

      {/* Data it touches */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 500, color: C.text }}>
          Data it touches <span style={{ fontWeight: 400, color: C.textDim }}>(from reads and modifies)</span>
        </span>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {touched.length === 0 && <Muted style={{ fontSize: 13 }}>No step reads or modifies data yet.</Muted>}
          {touched.map((name) => {
            const target = Object.values(elementsById || {}).find((e) => e.name === name && e.kind === "DataObject");
            return (
              <button key={name} onClick={() => target && onOpen(target.id)}
                style={{ background: C.accentBg, color: C.accent, border: 0, borderRadius: 16, padding: "6px 12px", fontSize: 13, cursor: "pointer", minHeight: 32 }}>
                {name}
              </button>
            );
          })}
        </div>
      </div>

      {/* Exposed by: the Interfaces that expose this Function (read-only,
          derived from each Interface's `exposes`). A Function no Interface
          exposes is private. Clicking a row opens that Interface. */}
      <ExposedBy fnName={el.name} fnSystemId={el.systemId} world={world} onOpen={onOpen} />
    </>
  );
}

// Read-only panel: which Interfaces expose this Function, within its System.
// Derived from the authoritative `exposes` on each Interface — the mirror of
// the Interface editor's exposes list, so the two never disagree.
function ExposedBy({ fnName, fnSystemId, world, onOpen }) {
  const rows = Object.entries(world || {})
    .filter(([, w]) => w.kind === "Interface"
      && (fnSystemId == null || w.systemId === fnSystemId)
      && (w.exposes || []).indexOf(fnName) >= 0)
    .map(([id, w]) => ({ id, name: w.name, serves: w.serves, style: w.bindingStyle }));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <span style={{ fontSize: 13, fontWeight: 500, color: C.text }}>
        Exposed by <span style={{ fontWeight: 400, color: C.textDim }}>(Interfaces that make it reachable)</span>
      </span>
      {rows.length === 0 && <Muted style={{ fontSize: 13 }}>No Interface exposes it — this Function is private.</Muted>}
      {rows.map((r) => (
        <button key={r.id} onClick={() => onOpen(r.id)}
          style={{ textAlign: "left", display: "flex", alignItems: "center", gap: 12, background: C.panel, border: `1px solid ${C.line}`, borderRadius: 4, padding: "12px 16px", color: C.text, cursor: "pointer", minHeight: 52 }}>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: "block", fontSize: 15, fontWeight: 500 }}>{r.name}</span>
            <span style={{ display: "block", fontSize: 13, color: C.textDim, marginTop: 2 }}>
              {r.serves ? `serves ${r.serves}` : "no caller yet"}{r.style ? ` · ${r.style}` : ""}
            </span>
          </span>
          <span style={{ color: C.textDim, fontSize: 18 }} aria-hidden="true">›</span>
        </button>
      ))}
    </div>
  );
}
