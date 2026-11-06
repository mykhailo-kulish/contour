// Design tokens lifted from the Modeler Editor mockup (meanings-template.zip,
// Main.dc.html). The mockup carries its precise values in inline styles; these
// constants are the single source so every component replicates them faithfully
// rather than copying literals around.

export const C = {
  bg: "#121212", // app background / sidebars
  panel: "#1e1e1e", // cards, grouped field blocks
  topbar: "#272727", // top bar
  text: "#ffffff",
  textDim: "rgba(255,255,255,0.7)", // secondary text / labels
  textFaint: "rgba(255,255,255,0.54)",
  line: "rgba(255,255,255,0.12)", // hairline borders
  lineStrong: "rgba(255,255,255,0.23)", // input borders
  lineInput: "rgba(255,255,255,0.42)", // name underline

  accent: "#90caf9", // primary blue (links, selection, Contour mark)
  accentBg: "rgba(144,202,249,0.16)",
  accentLine: "rgba(144,202,249,0.5)",

  green: "#66bb6a", // complete
  amber: "#ffa726", // has gaps
  red: "#e57373", // wrong / contradicts
  redBg: "rgba(244,67,54,0.16)",
  greenBg: "rgba(102,187,106,0.16)",
  amberBg: "rgba(255,167,38,0.16)",
  purple: "#ce93d8", // guardrail chips
  purpleBg: "rgba(206,147,216,0.16)",

  code: "rgba(255,255,255,0.05)", // code/preview block background
};

export const MONO =
  "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

// Status → dot/color. green complete, amber gaps, red wrong.
export function statusColor(status) {
  if (status === "wrong") return C.red;
  if (status === "gaps") return C.amber;
  return C.green;
}

// Shared input style (height-40 single-line inputs & selects).
export const inputStyle = {
  height: 40,
  boxSizing: "border-box",
  width: "100%",
  background: "transparent",
  border: `1px solid ${C.lineStrong}`,
  borderRadius: 4,
  padding: "0 12px",
  color: C.text,
  fontSize: 14,
  outline: "none",
};

export const selectStyle = {
  ...inputStyle,
  padding: "0 8px",
};

// A smaller (height-36) control used in dense rows (schema fields, effects).
export const smallInputStyle = {
  ...inputStyle,
  height: 36,
  fontSize: 13,
  padding: "0 10px",
};
export const smallSelectStyle = {
  ...smallInputStyle,
  padding: "0 8px",
};
