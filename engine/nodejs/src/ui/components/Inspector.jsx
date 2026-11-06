// The right inspector: "WRONG: CONTRADICTS THE MODEL", "STILL TO FILL IN"
// (gaps), and a references panel ("USED BY" / "APPLIES TO" …). Driven by the
// selected element's local issues; the authoritative counts come from the
// top bar's Check model (Contour).
import { C } from "../theme.js";

function Bullet({ color, children }) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
      <span style={{ width: 10, height: 10, borderRadius: "50%", background: color, marginTop: 5, flex: "none" }} />
      <div style={{ fontSize: 14, lineHeight: 1.5, color: C.text }}>{children}</div>
    </div>
  );
}

function Label({ color, children }) {
  return (
    <span style={{ fontSize: 11, fontWeight: 500, letterSpacing: "0.8px", color: color || C.textDim }}>
      {children}
    </span>
  );
}

export function Inspector({ wrong, gaps, refs, refsTitle }) {
  return (
    <aside
      aria-label="Inspector"
      style={{
        flex: "0 0 320px",
        maxWidth: "100%",
        boxSizing: "border-box",
        background: C.bg,
        borderLeft: `1px solid ${C.line}`,
        padding: "22px 20px",
        display: "flex",
        flexDirection: "column",
        gap: 22,
        overflowY: "auto",
      }}
    >
      {wrong.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Label color={C.red}>WRONG: CONTRADICTS THE MODEL</Label>
          {wrong.map((w, i) => <Bullet key={i} color={C.red}>{w}</Bullet>)}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Label>STILL TO FILL IN</Label>
        {gaps.length > 0 ? (
          <>
            {gaps.map((g, i) => <Bullet key={i} color={C.amber}>{g}</Bullet>)}
            <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: C.textDim }}>
              Gaps are not errors and never stop you from saving.
            </p>
          </>
        ) : (
          <div style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 14, color: C.green }}>
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: C.green }} />
            Nothing missing here
          </div>
        )}
      </div>

      {refs.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Label>{refsTitle}</Label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {refs.map((r, i) => (
              <button
                key={i}
                onClick={r.pick}
                style={{
                  background: "transparent",
                  border: `1px solid ${C.lineStrong}`,
                  color: C.text,
                  borderRadius: 16,
                  padding: "6px 12px",
                  fontSize: 13,
                  cursor: "pointer",
                  minHeight: 32,
                }}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={{ flex: 1 }} />
    </aside>
  );
}
