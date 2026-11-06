// The Requirements + Guardrails panel shown for every non-definition element:
// attach existing definitions (chips) or create a new one. Requirement chips
// are blue; Guardrail chips purple (mockup). Attaching edits the element's
// `requirements` / `guardrails` name lists.
import { C } from "../theme.js";
import { AddButton } from "./primitives.jsx";
import { selectStyle } from "../theme.js";

function Chips({ names, chipColor, chipBg, onOpen, onRemove, emptyText }) {
  if (!names.length) {
    return <span style={{ fontSize: 13, color: C.textDim, lineHeight: "36px" }}>{emptyText}</span>;
  }
  return names.map((name) => (
    <span key={name} style={{ display: "inline-flex", alignItems: "center", background: chipBg, borderRadius: 18 }}>
      <button
        onClick={() => onOpen(name)}
        style={{ background: "transparent", border: 0, color: chipColor, padding: "0 4px 0 14px", minHeight: 36, fontSize: 13, cursor: "pointer" }}
      >
        {name}
      </button>
      <button
        aria-label={`Remove ${name}`}
        onClick={() => onRemove(name)}
        style={{ background: "transparent", border: 0, color: C.textDim, width: 36, minHeight: 36, fontSize: 12, cursor: "pointer" }}
      >
        ✕
      </button>
    </span>
  ));
}

function Column({ title, blurb, names, options, chipColor, chipBg, onOpen, onRemove, onAdd, onNew }) {
  const free = options.filter((o) => names.indexOf(o) < 0);
  return (
    <div
      style={{
        flex: "1 1 300px",
        minWidth: 0,
        boxSizing: "border-box",
        background: C.panel,
        border: `1px solid ${C.line}`,
        borderRadius: 4,
        padding: "16px 18px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <span style={{ fontSize: 13, fontWeight: 500, color: C.text }}>{title}</span>
      <span style={{ fontSize: 12, color: C.textDim, lineHeight: 1.4 }}>{blurb}</span>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <Chips names={names} chipColor={chipColor} chipBg={chipBg} onOpen={onOpen} onRemove={onRemove} emptyText="None attached." />
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <select
          aria-label={`Attach an existing ${title.toLowerCase()}`}
          value=""
          onChange={(e) => { if (e.target.value) onAdd(e.target.value); }}
          style={{ ...selectStyle, flex: 1 }}
        >
          <option value="">{free.length ? "Attach existing…" : "All attached"}</option>
          {free.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        <AddButton size="lg" onClick={onNew}>New</AddButton>
      </div>
    </div>
  );
}

export function ReqGuardPanel({ requirements, guardrails, reqOptions, grOptions, onChange, onOpen, onNewReq, onNewGr }) {
  const setReq = (next) => onChange({ requirements: next, guardrails });
  const setGr = (next) => onChange({ requirements, guardrails: next });
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
      <Column
        title="Requirements"
        blurb="What this must achieve. It isn’t correct unless they are met."
        names={requirements}
        options={reqOptions}
        chipColor={C.accent}
        chipBg={C.accentBg}
        onOpen={onOpen}
        onRemove={(n) => setReq(requirements.filter((x) => x !== n))}
        onAdd={(n) => setReq([...requirements, n])}
        onNew={onNewReq}
      />
      <Column
        title="Guardrails"
        blurb="Boundaries it must stay inside: how the work may be done, not what to achieve."
        names={guardrails}
        options={grOptions}
        chipColor={C.purple}
        chipBg={C.purpleBg}
        onOpen={onOpen}
        onRemove={(n) => setGr(guardrails.filter((x) => x !== n))}
        onAdd={(n) => setGr([...guardrails, n])}
        onNew={onNewGr}
      />
    </div>
  );
}
