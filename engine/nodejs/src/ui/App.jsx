// Meanings — the Contour Modeler Editor (business view). A three-pane,
// form-based editor (tree · editor · inspector). The tree lists every Contour
// System as a collapsible node (no separate "open a model" picker); each
// expands to its Actors (with their Functions nested), Data Objects, Events,
// Requirements and Guardrails. Name resolution, status and Check Model are
// scoped per System. Meanings stores and validates nothing itself — the top
// bar's "Check model" is Contour's authoritative verdict for the System in view.
import { useMemo, useState, useEffect } from "react";
import { api, Rejected } from "./api.js";
import { C } from "./theme.js";
import { useModel } from "./useModel.js";
import { issues, dataTouched } from "./model.js";
import { TopBar } from "./components/TopBar.jsx";
import { Tree } from "./components/Tree.jsx";
import { Inspector } from "./components/Inspector.jsx";
import { Editor } from "./components/Editor.jsx";

export function App() {
  const m = useModel();
  const elements = m.elements;

  const [sel, setSel] = useState(null);          // selected element id (incl. def pseudo-ids)
  const [open, setOpen] = useState({});          // expand state: key -> bool (sys:/actor:/grp:)
  const [saving, setSaving] = useState(false);

  // All systems, in listing order.
  const systems = useMemo(
    () => m.systemIds.map((id) => elements?.[id]).filter(Boolean),
    [m.systemIds, elements],
  );

  // Expand the first System once loaded, and select it if nothing is selected.
  useEffect(() => {
    if (!systems.length) return;
    setOpen((o) => (Object.keys(o).length ? o : { ["sys:" + systems[0].id]: true }));
    setSel((s) => s || systems[0].id);
  }, [systems]);

  // Definition pseudo-elements for Requirement/Guardrail (edited as name+desc).
  const reqEls = useMemo(() => m.reqDefs.map((d) => ({ id: "req:" + d.id, defId: d.id, name: d.name, kind: "Requirement", body: { description: d.description }, description: d.description, requirements: [], guardrails: [] })), [m.reqDefs]);
  const grEls = useMemo(() => m.grDefs.map((d) => ({ id: "gr:" + d.id, defId: d.id, name: d.name, kind: "Guardrail", body: { description: d.description }, description: d.description, requirements: [], guardrails: [] })), [m.grDefs]);

  const allById = useMemo(() => {
    const map = { ...(elements || {}) };
    [...reqEls, ...grEls].forEach((d) => { map[d.id] = d; });
    return map;
  }, [elements, reqEls, grEls]);

  const current = sel ? allById[sel] : null;

  // Elements of one System, keyed by id (the scope for the editor/inspector).
  const scopeOf = (systemId) => {
    const out = {};
    Object.values(elements || {}).forEach((el) => { if (el.systemId === systemId) out[el.id] = el; });
    return out;
  };
  const byKindIn = (systemId) => {
    const g = { System: [], Actor: [], Function: [], DataObject: [], Event: [], Requirement: [], Guardrail: [] };
    Object.values(scopeOf(systemId)).forEach((el) => { (g[el.kind] || (g[el.kind] = [])).push(el); });
    return g;
  };

  function actorNameFor(el) {
    if (!el || el.kind !== "Function") return null;
    const actor = Object.values(scopeOf(el.systemId)).find((a) => a.kind === "Actor" && (a.uses || []).includes(el.name));
    return actor ? actor.name : null;
  }
  const statusOf = (el) => m.status({ ...el, actorName: actorNameFor(el) });

  // ---- tree rows (nested, progressively disclosed) ----
  // Each expandable row has a chevron (toggles) and a label (selects + opens).
  // System → Actors (+ their Functions) + four group nodes (always present,
  // with counts): Data Objects, Events, Requirements, Guardrails. Indentation
  // follows the template: 4 + level*14, add rows at +28.
  const isOpen = (key) => !!open[key];
  const ind = (level) => 4 + level * 14;

  const rows = [];
  systems.forEach((sys) => {
    const sysKey = "sys:" + sys.id;
    const sysOpen = isOpen(sysKey);
    const bk = byKindIn(sys.id);

    const branch = [];
    if (sysOpen) {
      // Actors (each expands to its used Functions).
      (bk.Actor || []).forEach((actor) => {
        const aKey = "actor:" + actor.id;
        const aOpen = isOpen(aKey);
        branch.push({ level: "actor", id: actor.id, label: actor.name, indent: ind(1), expandable: true, expanded: aOpen, selectOpens: true, toggleKey: aKey, chevLabel: `Show or hide the Functions ${actor.name} uses` });
        if (aOpen) {
          (actor.uses || []).forEach((fname) => {
            const fn = (bk.Function || []).find((f) => f.name === fname);
            if (fn) branch.push({ level: "leaf", id: fn.id, label: fn.name, indent: ind(2) });
          });
          branch.push({ isAdd: true, label: "Function", indent: ind(2) + 28, toggleKey: aKey + ":add", pick: () => onNewFunction(actor) });
        }
      });
      branch.push({ isAdd: true, label: "Actor", indent: ind(1) + 28, toggleKey: sysKey + ":addActor", pick: () => createElement("Actor", sys.id) });

      // Group nodes (always present; count only — no status on the tree).
      const refNames = (field) => {
        const s = new Set();
        Object.values(scopeOf(sys.id)).forEach((el) => (el[field] || []).forEach((n) => s.add(n)));
        return s;
      };
      const group = (label, kind, members, addLabel, onAdd) => {
        const gKey = "grp:" + sys.id + ":" + kind;
        const gOpen = isOpen(gKey);
        branch.push({ level: "group", label, indent: ind(1), count: String(members.length), muted: true, expandable: true, expanded: gOpen, labelToggles: true, toggleKey: gKey, chevLabel: `Show or hide ${label}` });
        if (gOpen) {
          members.forEach((el) => branch.push({ level: "leaf", id: el.id, label: el.name, indent: ind(2) }));
          branch.push({ isAdd: true, label: addLabel, indent: ind(2) + 28, toggleKey: gKey + ":add", pick: onAdd });
        }
      };
      const reqRef = refNames("requirements");
      const grRef = refNames("guardrails");
      group("Data Objects", "DataObject", bk.DataObject || [], "Data Object", () => createElement("DataObject", sys.id));
      group("Events", "Event", bk.Event || [], "Event", () => createElement("Event", sys.id));
      group("Requirements", "Requirement", reqEls.filter((d) => reqRef.has(d.name)), "Requirement", () => createDefinition("Requirement"));
      group("Guardrails", "Guardrail", grEls.filter((d) => grRef.has(d.name)), "Guardrail", () => createDefinition("Guardrail"));
    }

    rows.push({ level: "system", id: sys.id, label: sys.name, indent: ind(0), expandable: true, expanded: sysOpen, selectOpens: true, toggleKey: sysKey, chevLabel: `Show or hide ${sys.name}` });
    branch.forEach((r) => rows.push(r));
  });

  // ---- the System currently in view (drives top bar + inspector scope) ----
  const currentSystemId = current ? (current.systemId || (current.kind === "System" ? current.id : null)) : (systems[0]?.id ?? null);

  // Full records are loaded only for what the editor/inspector show, never for
  // the tree (the tree draws from the light scope and shows no status). Nothing
  // is hydrated eagerly on opening a System: records load on element open, for
  // the opened element and the bounded cross-reference set its inspector needs.
  const { refetchElement, hydrateCrossRefs, hydrateFunctionTargets } = m;
  // On select: load the selected element's full record, then its cross-reference
  // set (Actor's used Functions; a Data Object's/Event's touching Functions) in
  // one batch call, so the inspector's checks run on open.
  useEffect(() => {
    if (!current || !current.systemId) return;
    if (current.id.startsWith("req:") || current.id.startsWith("gr:")) return;
    refetchElement(current.id);
    hydrateCrossRefs(current);
  }, [current?.id, current?.systemId, current?.kind, refetchElement, hydrateCrossRefs]);
  // A Function's calls/uses dropdowns and outcome mapping reach other Systems'
  // Interfaces/Functions — hydrate just this Function's step targets in one batch
  // call when it is opened, not every element of every System.
  useEffect(() => { if (current && current.kind === "Function") hydrateFunctionTargets(current); }, [current?.id, current?.kind, hydrateFunctionTargets]);

  // ---- totals for the top bar (the System in view) ----
  const { totalWrong, totalGaps } = useMemo(() => {
    let w = 0;
    let g = 0;
    if (!currentSystemId) return { totalWrong: 0, totalGaps: 0 };
    Object.values(scopeOf(currentSystemId)).forEach((el) => {
      if (el.kind === "Actor") return;
      const x = issues({ ...el, actorName: actorNameFor(el) }, m.world, m.defs);
      w += x.c.length;
      g += x.g.length;
    });
    return { totalWrong: w, totalGaps: g };
  }, [currentSystemId, elements, m.world, m.defs]);

  // ---- breadcrumbs ----
  const crumbs = [];
  if (currentSystemId && elements?.[currentSystemId]) {
    const sysEl = elements[currentSystemId];
    crumbs.push({ label: sysEl.name, pick: () => selectAndReveal(sysEl.id), active: current?.id === sysEl.id });
    if (current && current.kind === "Function") {
      const actor = Object.values(scopeOf(currentSystemId)).find((a) => a.kind === "Actor" && (a.uses || []).includes(current.name));
      if (actor) crumbs.push({ label: actor.name, pick: () => selectAndReveal(actor.id), active: false });
    }
    if (current && current.id !== sysEl.id) {
      crumbs.push({ label: current.name, pick: () => selectAndReveal(current.id), active: true });
    }
  }

  // ---- inspector (local issues + refs) ----
  const inspector = useMemo(() => {
    if (!current) return { wrong: [], gaps: [], refs: [], refsTitle: "" };
    const sysId = current.systemId;
    const scope = scopeOf(sysId);
    let wrong;
    let gaps;
    if (current.kind === "Actor") {
      wrong = [];
      gaps = [];
      (current.uses || []).forEach((fname) => {
        const fn = Object.values(scope).find((f) => f.kind === "Function" && f.name === fname);
        if (!fn) { gaps.push(`Function “${fname}” is not defined yet.`); return; }
        const x = issues({ ...fn, actorName: current.name }, m.world, m.defs);
        x.g.forEach((t) => gaps.push(fn.name + ": " + t));
        x.c.forEach((t) => wrong.push(fn.name + ": " + t));
      });
    } else {
      const x = issues({ ...current, actorName: actorNameFor(current) }, m.world, m.defs);
      wrong = x.c;
      gaps = x.g;
    }
    const refs = [];
    let refsTitle = "";
    const open = (id) => () => selectAndReveal(id);
    if (current.kind === "Function") {
      refsTitle = "USED BY";
      const actor = Object.values(scope).find((a) => a.kind === "Actor" && (a.uses || []).includes(current.name));
      if (actor) refs.push({ label: actor.name, pick: open(actor.id) });
    } else if (current.kind === "DataObject" || current.kind === "Event") {
      refsTitle = "USED BY FUNCTIONS";
      Object.values(scope).filter((f) => f.kind === "Function").forEach((fn) => {
        const touches = current.kind === "DataObject"
          ? dataTouched(fn.steps, fn.alts).includes(current.name)
          : [...(fn.steps || []), ...flatEffects(fn.alts)].some((s) => (s.verb === "produces" || s.verb === "consumes") && s.target === current.name);
        if (touches) refs.push({ label: fn.name, pick: open(fn.id) });
      });
    } else if (current.kind === "Requirement" || current.kind === "Guardrail") {
      refsTitle = "APPLIES TO";
      const field = current.kind === "Requirement" ? "requirements" : "guardrails";
      Object.values(elements || {}).forEach((el) => { if ((el[field] || []).includes(current.name)) refs.push({ label: el.name, pick: open(el.id) }); });
    }
    return { wrong, gaps, refs, refsTitle };
  }, [current, elements, m.world, m.defs]);

  // ---- actions ----
  async function createElement(kind, systemId) {
    const name = window.prompt(`Name for the new ${kind === "DataObject" ? "Data Object" : kind}:`);
    if (!name) return;
    try {
      setSaving(true);
      const res = await api.place({ element: { name, elementType: kind, systemId }, record: {}, relationships: [] });
      await m.reload();
      if (res?.element?.id) setSel(res.element.id);
    } catch (e) {
      if (e instanceof Rejected) m.setError("Rejected by Contour: " + e.violations.join("; "));
      else m.setError(String(e.message || e));
    } finally {
      setSaving(false);
    }
  }

  // Create a new Requirement/Guardrail definition. Returns the created name so
  // a caller editing an element can attach it to its *local* buffer (persisted
  // only when Save is pressed) — nothing in the Element view is stored until
  // then (requirement: "Nothing is saved until Save button is pressed"). When
  // there is no element being edited (attachTo omitted), the new definition is
  // simply selected.
  async function createDefinition(kind, attachTo) {
    const name = window.prompt(`Name for the new ${kind}:`);
    if (!name) return null;
    const id = crypto.randomUUID();
    try {
      setSaving(true);
      if (kind === "Requirement") await m.defineReq(id, name, "");
      else await m.defineGr(id, name, "");
      if (!attachTo) {
        setSel((kind === "Requirement" ? "req:" : "gr:") + id);
      }
      return name;
    } catch { /* surfaced by useModel */ return null; } finally {
      setSaving(false);
    }
  }

  async function saveElementPayload(el, extra) {
    const body = { ...el.body, ...extra };
    const payload = { element: { id: el.id, name: el.name, elementType: el.kind, systemId: el.kind === "System" ? null : el.systemId }, record: body, relationships: [] };
    await m.save(payload);
  }

  async function onSave(payload) {
    setSaving(true);
    try { const id = await m.save(payload); if (id) setSel(id); } catch { /* surfaced */ } finally { setSaving(false); }
  }

  async function onDefine(buf) {
    if (buf && buf.__newDef) { return await createDefinition(buf.__newDef, buf.attachTo); }
    setSaving(true);
    try {
      if (buf.kind === "Requirement") await m.defineReq(buf.defId, buf.name, buf.description || "");
      else await m.defineGr(buf.defId, buf.name, buf.description || "");
    } catch { /* surfaced */ } finally { setSaving(false); }
  }

  async function onNewFunction(actor) {
    const name = window.prompt("Name for the new Function:");
    if (!name) return;
    try {
      setSaving(true);
      const res = await api.place({ element: { name, elementType: "Function", systemId: actor.systemId }, record: {}, relationships: [] });
      await saveElementPayload(actor, { uses: [...(actor.uses || []), name] });
      await m.reload();
      if (res?.element?.id) setSel(res.element.id);
    } catch (e) {
      if (e instanceof Rejected) m.setError("Rejected by Contour: " + e.violations.join("; "));
      else m.setError(String(e.message || e));
    } finally { setSaving(false); }
  }

  async function createSystem() {
    const name = window.prompt("Name for the new System:");
    if (!name) return;
    try {
      const res = await api.place({ element: { name, elementType: "System", systemId: null }, record: {}, relationships: [] });
      await m.reload();
      if (res?.element?.id) { setExpanded((e) => ({ ...e, [res.element.id]: true })); setSel(res.element.id); }
    } catch (e) {
      if (e instanceof Rejected) m.setError("Rejected by Contour: " + e.violations.join("; "));
      else m.setError(String(e.message || e));
    }
  }

  const toggle = (key, forceOpen = false) => setOpen((o) => ({ ...o, [key]: forceOpen ? true : !o[key] }));

  // Select an element and make sure its branch is open, so a jump from a
  // breadcrumb, a reference chip or the inspector reveals it in the tree.
  function selectAndReveal(id) {
    setSel(id);
    const el = allById[id];
    if (!el) return;
    const next = {};
    if (el.kind === "System") { next["sys:" + el.id] = true; }
    else if (el.systemId) {
      next["sys:" + el.systemId] = true;
      if (el.kind === "Function") {
        const actor = Object.values(scopeOf(el.systemId)).find((a) => a.kind === "Actor" && (a.uses || []).includes(el.name));
        if (actor) next["actor:" + actor.id] = true;
      } else if (el.kind === "Actor") {
        next["actor:" + el.id] = true;
      } else if (el.kind === "DataObject" || el.kind === "Event") {
        next["grp:" + el.systemId + ":" + el.kind] = true;
      }
    } else if (el.kind === "Requirement" || el.kind === "Guardrail") {
      // A definition opened from a ref: reveal under the systems that use it.
      Object.values(elements || {}).forEach((e) => {
        const field = el.kind === "Requirement" ? "requirements" : "guardrails";
        if ((e[field] || []).includes(el.name) && e.systemId) {
          next["sys:" + e.systemId] = true;
          next["grp:" + e.systemId + ":" + el.kind] = true;
        }
      });
    }
    if (Object.keys(next).length) setOpen((o) => ({ ...o, ...next }));
  }

  // ---- render ----
  const counts = currentSystemId
    ? (() => { const bk = byKindIn(currentSystemId); return { actors: bk.Actor.length, functions: bk.Function.length, data: bk.DataObject.length, events: bk.Event.length }; })()
    : { actors: 0, functions: 0, data: 0, events: 0 };

  const reqOptions = m.reqDefs.map((d) => d.name);
  const grOptions = m.grDefs.map((d) => d.name);
  const check = currentSystemId ? m.check[currentSystemId] : null;
  const systemNameById = useMemo(() => {
    const map = {};
    systems.forEach((s) => { map[s.id] = s.name; });
    return map;
  }, [systems]);

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, display: "flex", flexDirection: "column" }}>
      <TopBar
        crumbs={crumbs.length ? crumbs : [{ label: "Meanings", pick: () => {}, active: true }]}
        totalWrong={totalWrong}
        totalGaps={totalGaps}
        onCheck={() => m.runCheck(currentSystemId)}
        saved={check ? `Checked: ${check.contradictions?.length || 0} contradiction(s), ${check.gaps?.length || 0} gap(s)` : "Validated by Contour on save"}
      />

      {m.error && (
        <div style={{ background: C.redBg, color: C.red, padding: "10px 24px", fontSize: 14, display: "flex", justifyContent: "space-between" }}>
          <span>{m.error}</span>
          <button onClick={() => m.setError(null)} style={{ background: "transparent", border: 0, color: C.red, cursor: "pointer" }}>✕</button>
        </div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", flex: 1, alignItems: "stretch" }}>
        <Tree
          rows={rows}
          selected={current?.id}
          onSelect={setSel}
          onToggle={toggle}
          footer={
            <button onClick={createSystem}
              style={{ textAlign: "left", background: "transparent", border: 0, color: C.accent, textTransform: "uppercase", letterSpacing: "0.4px", fontWeight: 500, borderRadius: 4, padding: "0 10px", minHeight: 36, fontSize: 13, cursor: "pointer" }}>
              + New System
            </button>
          }
        />

        {!elements && <div style={{ flex: 1, padding: 32, color: C.textDim }}>Loading models…</div>}

        {elements && current && (
          <Editor
            key={current.id}
            element={current}
            world={m.world}
            elementsById={current.systemId ? scopeOf(current.systemId) : {}}
            counts={counts}
            reqOptions={reqOptions}
            grOptions={grOptions}
            status={statusOf}
            onOpen={selectAndReveal}
            onSave={onSave}
            onDefine={onDefine}
            onNewFunction={onNewFunction}
            saving={saving}
            componentOfFunction={m.componentOfFunction}
            systemNameById={systemNameById}
          />
        )}

        {elements && !current && systems.length === 0 && (
          <div style={{ flex: 1, padding: 32, color: C.textDim }}>
            No Systems yet. Create one with “+ New System” in the tree.
          </div>
        )}

        {elements && current && (
          <Inspector wrong={inspector.wrong} gaps={inspector.gaps} refs={inspector.refs} refsTitle={inspector.refsTitle} />
        )}
      </div>
    </div>
  );
}

function flatEffects(alts) {
  const out = [];
  (alts || []).forEach((a) => (a.effects || []).forEach((e) => out.push(e)));
  return out;
}
