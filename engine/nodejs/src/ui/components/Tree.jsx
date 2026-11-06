// The left model tree: a progressively-disclosed hierarchy, matching the
// "Contour Modeler – Top-down" template. Each expandable row has two click
// targets: a chevron that toggles expand/collapse (a rotating ›), and the
// label that selects the element and opens its branch (never collapses).
//
//   System            chevron toggles · label selects + opens
//    ├ Actor          chevron toggles · label selects + opens
//    │   └ Function   leaf → selects
//    ├ Data Objects   group node (count + chevron) → members
//    ├ Events · Requirements · Guardrails … same shape
//
// Rows are built by App. Each row: { id?, label, indent, dot?, count?,
// expandable?, expanded?, toggleKey?, isAdd?, isNote?, sub?, pick? }.
import { C } from "../theme.js";

// The 28px chevron slot: a rotating › for expandable rows, blank for leaves.
function Chevron({ expandable, expanded, onToggle, label }) {
  if (!expandable) return <span style={{ flex: "none", width: 28 }} />;
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
      aria-label={label}
      aria-expanded={expanded}
      style={{
        flex: "none",
        width: 28,
        height: 28,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: "transparent",
        border: 0,
        borderRadius: "50%",
        color: C.textDim,
        fontSize: 18,
        lineHeight: 1,
        cursor: "pointer",
        padding: 0,
      }}
    >
      <span style={{ display: "inline-block", transform: `rotate(${expanded ? 90 : 0}deg)`, transition: "transform 120ms" }}>›</span>
    </button>
  );
}

function ItemRow({ row, selected, onSelect, onToggle }) {
  const on = row.id != null && row.id === selected;
  const isSystem = row.level === "system";
  return (
    <div style={{ display: "flex", alignItems: "center", background: on ? C.accentBg : "transparent", borderRadius: 4, paddingLeft: row.indent, minHeight: 40 }}>
      <Chevron
        expandable={row.expandable}
        expanded={row.expanded}
        onToggle={() => onToggle(row.toggleKey)}
        label={row.chevLabel || (row.expanded ? "Collapse" : "Expand")}
      />
      <button
        onClick={() => {
          if (row.id != null) onSelect(row.id);
          if (row.selectOpens && row.toggleKey) onToggle(row.toggleKey, true);
          else if (row.labelToggles && row.toggleKey) onToggle(row.toggleKey);
        }}
        style={{
          flex: 1,
          minWidth: 0,
          boxSizing: "border-box",
          display: "flex",
          alignItems: "center",
          gap: 8,
          textAlign: "left",
          background: "transparent",
          color: on ? C.accent : row.muted ? C.textDim : C.text,
          fontWeight: on || isSystem || row.muted ? 500 : 400,
          border: 0,
          padding: "0 12px 0 2px",
          minHeight: 40,
          fontSize: isSystem ? 14 : 14,
          letterSpacing: isSystem ? "0.3px" : "normal",
          cursor: "pointer",
        }}
      >
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.label}</span>
        {row.count != null && row.count !== "" && <span style={{ fontSize: 12, color: C.textDim }}>{row.count}</span>}
      </button>
    </div>
  );
}

function AddRow({ row }) {
  return (
    <button
      onClick={row.pick}
      disabled={!row.pick}
      style={{
        width: "100%",
        boxSizing: "border-box",
        textAlign: "left",
        background: "transparent",
        border: 0,
        color: C.accent,
        textTransform: "uppercase",
        letterSpacing: "0.4px",
        fontWeight: 500,
        borderRadius: 4,
        padding: `0 10px 0 ${row.indent}px`,
        minHeight: 36,
        fontSize: 13,
        cursor: row.pick ? "pointer" : "default",
      }}
    >
      + {row.label}
    </button>
  );
}

function NoteRow({ row }) {
  return (
    <div style={{ padding: `6px 10px 6px ${row.indent}px`, display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontSize: 14, color: C.text }}>{row.label}</span>
      <span style={{ fontSize: 12, color: C.textDim, lineHeight: 1.4 }}>{row.sub}</span>
    </div>
  );
}

export function Tree({ rows, selected, onSelect, onToggle, footer }) {
  return (
    <aside
      aria-label="Model tree"
      style={{
        flex: "0 0 280px",
        maxWidth: "100%",
        boxSizing: "border-box",
        background: C.bg,
        borderRight: `1px solid ${C.line}`,
        padding: "14px 10px",
        display: "flex",
        flexDirection: "column",
        gap: 2,
        overflowY: "auto",
      }}
    >
      {rows.map((row, i) => {
        if (row.isAdd) return <AddRow key={row.toggleKey || i} row={row} />;
        if (row.isNote) return <NoteRow key={i} row={row} />;
        return <ItemRow key={row.id || row.toggleKey || i} row={row} selected={selected} onSelect={onSelect} onToggle={onToggle} />;
      })}

      <div style={{ flex: 1 }} />

      {footer}
    </aside>
  );
}
