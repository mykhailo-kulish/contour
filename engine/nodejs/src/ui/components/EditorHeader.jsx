// The editor's heading block: the kind label, optional subtype chip, the big
// inline-editable name, and the per-kind name hint. Shared by every editor.
import { C } from "../theme.js";
import { typeLabel } from "../api.js";

const DESC_LABEL = {
  System: "What does it do, and for whom?",
  Actor: "What is the role, and who plays it?",
  Function: "What business case does it handle?",
  DataObject: "What is it?",
  Event: "What happened?",
  Requirement: "What must be true of anything that refers to it?",
  Guardrail: "What boundary must anything that refers to it stay inside?",
};
const NAME_HINT = {
  System: "",
  Actor: "Named for the role, not the job title.",
  Function: "Named for the work: an action and what it acts on.",
  DataObject: "",
  Event: "Past tense: it reports something that already happened.",
  Requirement: "Defined once, then referenced by name. A positive obligation.",
  Guardrail: "Defined once, then referenced by name. A boundary on how, not a goal.",
};

export function descLabel(kind) { return DESC_LABEL[kind] || "Description"; }

export function EditorHeader({ kind, sub, name, onName, nameHint }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 12, fontWeight: 500, letterSpacing: "0.8px", color: C.textDim }}>
          {typeLabel(kind).toUpperCase()}
        </span>
        {sub && (
          <span style={{ fontSize: 12, color: C.textDim, border: `1px solid ${C.line}`, borderRadius: 16, padding: "3px 10px" }}>
            {sub}
          </span>
        )}
      </div>
      <input
        aria-label="Name"
        value={name}
        onChange={(e) => onName(e.target.value)}
        style={{
          boxSizing: "border-box",
          width: "100%",
          background: "transparent",
          border: 0,
          borderBottom: `1px solid ${C.lineInput}`,
          color: C.text,
          fontSize: 28,
          fontWeight: 500,
          padding: "4px 0 10px",
          outline: 0,
        }}
      />
      <span style={{ fontSize: 12, color: C.textDim }}>{nameHint ?? NAME_HINT[kind] ?? ""}</span>
    </div>
  );
}

// The outlined, floating-label multi-line description used under the header.
export function DescriptionField({ label, value, onChange, placeholder, hint, bg = C.bg }) {
  return (
    <div style={{ position: "relative", display: "flex", flexDirection: "column", paddingTop: 8 }}>
      <span
        style={{
          position: "absolute",
          top: 0,
          left: 10,
          padding: "0 5px",
          fontSize: 12,
          lineHeight: "16px",
          color: C.textDim,
          background: bg,
          zIndex: 1,
        }}
      >
        {label}
      </span>
      <textarea
        rows={3}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        style={{
          boxSizing: "border-box",
          width: "100%",
          background: "transparent",
          border: `1px solid ${C.lineStrong}`,
          borderRadius: 4,
          padding: "12px 14px",
          color: C.text,
          fontSize: 15,
          lineHeight: 1.5,
          resize: "vertical",
        }}
      />
      {hint && <span style={{ fontSize: 12, color: C.textDim, margin: "3px 14px 0" }}>{hint}</span>}
    </div>
  );
}
