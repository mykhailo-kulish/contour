// Small presentational primitives shared by the Modeler editors. They encode
// the mockup's recurring patterns (outlined "+ add" buttons, floating-label
// fields, grouped blocks, section headers) so each editor stays declarative.
import { C } from "../theme.js";

// Pill-outline action button ("+ Add step", "+ New", …). Uppercase, blue.
export function AddButton({ children, onClick, size = "md", title }) {
  const h = size === "sm" ? 32 : size === "lg" ? 40 : 36;
  const pad = size === "sm" ? "0 12px" : "0 14px";
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      style={{
        alignSelf: "flex-start",
        background: "transparent",
        border: `1px solid ${C.accentLine}`,
        color: C.accent,
        textTransform: "uppercase",
        letterSpacing: "0.4px",
        fontWeight: 500,
        borderRadius: 4,
        padding: pad,
        minHeight: h,
        fontSize: size === "sm" ? 12 : 13,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

// Round icon button (remove ✕, move ↑↓). Red by default.
export function IconBtn({ children, onClick, color = C.red, disabled, title, size = 36 }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      style={{
        flex: "none",
        width: size,
        height: size,
        background: "transparent",
        border: 0,
        color,
        borderRadius: "50%",
        fontSize: size >= 40 ? 16 : 14,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

// A field with a floating label sitting on the border (Material outlined look).
// `bg` is the background the label notch sits on (panel vs app bg).
export function Field({ label, hint, children, flex, bg = C.bg, minWidth }) {
  return (
    <div style={{ position: "relative", display: "flex", flexDirection: "column", flex, minWidth }}>
      <span
        style={{
          position: "absolute",
          top: -8,
          left: 10,
          padding: "0 5px",
          fontSize: 12,
          lineHeight: "16px",
          color: C.textDim,
          background: bg,
          zIndex: 1,
          pointerEvents: "none",
        }}
      >
        {label}
      </span>
      {children}
      {hint && <span style={{ fontSize: 12, color: C.textDim, margin: "3px 14px 0" }}>{hint}</span>}
    </div>
  );
}

// Section title + optional right-aligned hint (mockup's "Steps … One verb per step").
export function SectionHead({ title, hint, right }) {
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        justifyContent: "space-between",
        alignItems: "baseline",
        gap: "4px 12px",
      }}
    >
      <span style={{ fontSize: 13, fontWeight: 500, color: C.text }}>{title}</span>
      {right}
      {hint && <span style={{ fontSize: 12, color: C.textDim }}>{hint}</span>}
    </div>
  );
}

// A grouped card block (the #1e1e1e panels that hold steps, schema groups…).
export function Block({ children, accent, style }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        background: C.panel,
        border: accent ? undefined : `1px solid ${C.line}`,
        borderLeft: accent ? `3px solid ${accent}` : undefined,
        borderRadius: accent ? "0 4px 4px 0" : 4,
        padding: accent ? "10px 12px 10px 14px" : "14px",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function Muted({ children, style }) {
  return <span style={{ fontSize: 12, color: C.textDim, lineHeight: 1.5, ...style }}>{children}</span>;
}
