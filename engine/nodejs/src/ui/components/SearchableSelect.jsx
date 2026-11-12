// A type-in searchable combobox for long, System-grouped target lists (a Steps
// editor's `uses` and `consumes` targets span every System and can grow long —
// see the Meanings UI binding, conventions: Searchable picker). It is a
// drop-in replacement for the grouped <select>/<optgroup> the Steps editor used:
// it shows the current value, opens a popover with a filter box and a scrollable
// grouped option list, narrows options as you type (case-insensitive substring
// over the visible label, which already includes the owning Component/System),
// and keeps the System grouping (a group shows only while it has a match).
//
// Presentation only: it changes no stored value and no scoping rule. `groups`
// is exactly what the caller passed to the old optgroups — [{ system, options:
// [{ v, l }] }] — and `onChange(value)` receives the chosen option's `v`, the
// same string the <select> would have stored. Keyboard: type to filter, ↑/↓ to
// move, Enter to pick, Escape to close without changing; labelled for a11y.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { C } from "../theme.js";
import { selectStyle } from "../theme.js";

export function SearchableSelect({ groups, value, onChange, placeholder = "Choose…", ariaLabel, style }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0); // index into the flat visible-options list
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  // The label currently selected (so the closed control shows text, not the id).
  const selectedLabel = useMemo(() => {
    for (const g of groups) {
      const hit = g.options.find((o) => o.v === value);
      if (hit) return hit.l;
    }
    return value || ""; // an out-of-list stored value still shows as itself
  }, [groups, value]);

  // Filter the groups by the query, preserving grouping; drop empty groups.
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const out = [];
    for (const g of groups) {
      const opts = needle ? g.options.filter((o) => o.l.toLowerCase().includes(needle)) : g.options;
      if (opts.length) out.push({ system: g.system, options: opts });
    }
    return out;
  }, [groups, q]);

  // Flat list of visible options, for arrow-key navigation and Enter.
  const flat = useMemo(() => filtered.flatMap((g) => g.options), [filtered]);

  // Keep the active index in range whenever the filtered set changes.
  useEffect(() => { setActive((i) => (flat.length === 0 ? 0 : Math.min(i, flat.length - 1))); }, [flat.length]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDocDown = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) close(); };
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [open]);

  // Focus the filter box when the popover opens.
  useLayoutEffect(() => { if (open && inputRef.current) inputRef.current.focus(); }, [open]);

  // Scroll the active option into view as the Modeler arrows through.
  useLayoutEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-opt-index="${active}"]`);
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  function openPopover() { setQ(""); setActive(0); setOpen(true); }
  function close() { setOpen(false); setQ(""); }
  function pick(v) { onChange(v); close(); }

  function onKeyDown(e) {
    if (!open && (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ")) {
      e.preventDefault(); openPopover(); return;
    }
    if (!open) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(i + 1, flat.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); if (flat[active]) pick(flat[active].v); }
    else if (e.key === "Escape") { e.preventDefault(); close(); }
  }

  let runningIndex = -1; // assign a flat index to each rendered option

  return (
    <div ref={rootRef} style={{ position: "relative", ...style }}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? close() : openPopover())}
        onKeyDown={onKeyDown}
        style={{
          ...selectStyle,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          textAlign: "left",
          cursor: "pointer",
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: selectedLabel ? C.text : C.textDim }}>
          {selectedLabel || placeholder}
        </span>
        <span aria-hidden="true" style={{ color: C.textDim, flex: "none" }}>▾</span>
      </button>

      {open && (
        <div
          role="listbox"
          style={{
            position: "absolute",
            zIndex: 20,
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            background: C.panel,
            border: `1px solid ${C.lineStrong}`,
            borderRadius: 4,
            boxShadow: "0 6px 20px rgba(0,0,0,0.4)",
            display: "flex",
            flexDirection: "column",
            maxHeight: 320,
          }}
        >
          <div style={{ padding: 8, borderBottom: `1px solid ${C.line}` }}>
            <input
              ref={inputRef}
              aria-label={ariaLabel ? `Filter ${ariaLabel}` : "Filter options"}
              value={q}
              placeholder="Type to filter…"
              onChange={(e) => { setQ(e.target.value); setActive(0); }}
              onKeyDown={onKeyDown}
              style={{
                height: 36,
                boxSizing: "border-box",
                width: "100%",
                background: "transparent",
                border: `1px solid ${C.lineStrong}`,
                borderRadius: 4,
                padding: "0 10px",
                color: C.text,
                fontSize: 13,
                outline: "none",
              }}
            />
          </div>
          <div ref={listRef} style={{ overflowY: "auto" }}>
            {flat.length === 0 && (
              <div style={{ padding: "10px 12px", fontSize: 13, color: C.textDim }}>No match.</div>
            )}
            {filtered.map((g) => (
              <div key={g.system}>
                <div style={{ padding: "6px 12px", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.4px", color: C.textDim, position: "sticky", top: 0, background: C.panel }}>
                  {g.system}
                </div>
                {g.options.map((o) => {
                  runningIndex += 1;
                  const idx = runningIndex;
                  const isActive = idx === active;
                  const isSelected = o.v === value;
                  return (
                    <div
                      key={o.v}
                      role="option"
                      aria-selected={isSelected}
                      data-opt-index={idx}
                      onMouseEnter={() => setActive(idx)}
                      onMouseDown={(e) => { e.preventDefault(); pick(o.v); }}
                      style={{
                        padding: "8px 12px",
                        fontSize: 14,
                        cursor: "pointer",
                        color: isActive ? C.accent : C.text,
                        background: isActive ? C.accentBg : "transparent",
                        fontWeight: isSelected ? 600 : 400,
                      }}
                    >
                      {o.l}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
