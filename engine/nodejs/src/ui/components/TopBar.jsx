// The Modeler's top bar: Contour mark, breadcrumb trail, save status, the
// Check-model button with live contradiction/gap counts, and the view badge.
// Replicates the mockup's header exactly (colors, radii, spacing).
import { C } from "../theme.js";

function Crumb({ label, onPick, active, sep }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      {sep && <span style={{ color: C.lineStrong }}>/</span>}
      <button
        onClick={onPick}
        style={{
          background: "transparent",
          border: 0,
          color: active ? C.text : C.textDim,
          fontSize: 14,
          padding: "6px 4px",
          minHeight: 32,
          cursor: "pointer",
        }}
      >
        {label}
      </button>
    </span>
  );
}

export function TopBar({ crumbs, totalWrong, totalGaps, onCheck, onCopyLink, copied, saved }) {
  const wrongColor = totalWrong > 0 ? C.red : C.green;
  const wrongBg = totalWrong > 0 ? C.redBg : C.greenBg;
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "12px 16px",
        padding: "0 24px",
        minHeight: 64,
        background: C.topbar,
        boxShadow:
          "0 2px 4px -1px rgba(0,0,0,0.2), 0 4px 5px 0 rgba(0,0,0,0.14), 0 1px 10px 0 rgba(0,0,0,0.12)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={C.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 15c3-8 6-8 9-3s6 5 9-3" />
        </svg>
        <span style={{ fontSize: 20, fontWeight: 500, letterSpacing: "0.15px" }}>Meanings</span>
      </div>

      <nav aria-label="Breadcrumb" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, fontSize: 14 }}>
        {crumbs.map((c, i) => (
          <Crumb key={i} label={c.label} onPick={c.pick} active={c.active} sep={i > 0} />
        ))}
      </nav>

      <div style={{ flex: "1 1 40px" }} />

      <span style={{ fontSize: 13, color: C.textDim }}>{saved}</span>

      <button
        onClick={onCopyLink}
        title="Copy a link to this view"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          background: "transparent",
          border: `1px solid ${copied ? C.accentLine : C.lineStrong}`,
          color: copied ? C.accent : C.text,
          borderRadius: 4,
          padding: "0 14px",
          height: 40,
          fontSize: 13,
          fontWeight: 500,
          cursor: "pointer",
        }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" />
          <path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />
        </svg>
        <span style={{ textTransform: "uppercase", letterSpacing: "0.4px" }}>{copied ? "Link copied" : "Copy link"}</span>
      </button>

      <button
        onClick={onCheck}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          background: "transparent",
          border: `1px solid ${C.lineStrong}`,
          color: C.text,
          borderRadius: 4,
          padding: "0 14px",
          height: 40,
          fontSize: 14,
          fontWeight: 500,
          cursor: "pointer",
        }}
      >
        <span style={{ textTransform: "uppercase", letterSpacing: "0.4px", fontSize: 13 }}>Check model</span>
        <span style={{ fontSize: 12, color: wrongColor, background: wrongBg, borderRadius: 16, padding: "2px 8px" }}>
          {totalWrong} contradictions
        </span>
        <span style={{ fontSize: 12, color: C.amber, background: C.amberBg, borderRadius: 16, padding: "2px 8px" }}>
          {totalGaps} gaps
        </span>
      </button>
    </div>
  );
}
