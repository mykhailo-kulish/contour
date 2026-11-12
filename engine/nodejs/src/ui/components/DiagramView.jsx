// DiagramView — the Diagram View half of Read Element.
//
// When the Modeler opens an element, Read Element loads that element's graph
// from Contour (Export Graph, via the BFF) and renders it here with Mermaid.
// Meanings keeps no copy of the model and shapes no view of its own: the engine
// already returns the right projection for the element's type (contour.md §4 —
// "Graph Carries Contour Semantics"). For a Function, Export Graph returns the
// step-ordered, depth-resolved Function View in one call — the focus Function,
// the Actors/Functions that invoke it, and the steps (its own and those of the
// Functions it calls/uses, resolved in depth) carried as step edges each tagged
// with its `ordinal` (the 1-based position in the record's steps[]). This
// component only turns that neutral graph into a picture: node→shape, verb→arrow
// label, and the engine's `ordinal` into a visible step number.
//
// The view is presentation over the already-fetched graph — zoom, fit, pan and
// node-selection highlight re-derive no structure and make no further engine
// call ("Presents The Model It Never Invents"; contour.md §4 one-way/lossy):
//   • Zoom / fit / pan — the Modeler can zoom in/out, reset to 100%, fit the
//     whole diagram to the frame, and drag to pan when it overflows.
//   • Selection highlight — clicking a node highlights it together with its
//     incident relationship edges and the immediate neighbours those edges
//     reach, dimming the rest; clicking the empty canvas clears it. The opened
//     element starts pre-highlighted.
//
// Outcomes mirror the Function's record:
//   • Read               — the graph renders.
//   • No Such Element     — Contour has no element with this id (NotFound).
//   • Catalog Unavailable — Contour couldn't be reached (CatalogUnavailable).
import { useEffect, useMemo, useRef, useState } from "react";
import mermaid from "mermaid";
import { api, CatalogUnavailable, NotFound } from "../api.js";
import { C, MONO } from "../theme.js";

// Initialize Mermaid once, in a dark theme that matches the Modeler shell.
let mermaidReady = false;
function ensureMermaid() {
  if (mermaidReady) return;
  mermaid.initialize({
    startOnLoad: false,
    theme: "dark",
    securityLevel: "strict", // no HTML/script in labels; we only emit text
    flowchart: { useMaxWidth: false, htmlLabels: false, curve: "basis" },
    themeVariables: {
      background: C.bg,
      primaryColor: C.panel,
      primaryTextColor: C.text,
      lineColor: C.lineStrong,
      fontFamily: "inherit",
    },
  });
  mermaidReady = true;
}

// Contour element type → a Mermaid node shape, so the picture reads at a glance.
// (Plain neutral shapes — the graph carries no visual hints of its own.)
function shapeFor(type, id, label) {
  const l = `"${label}"`;
  switch (type) {
    case "System": return `${id}[${l}]`;
    case "Component": return `${id}[[${l}]]`;
    case "Interface": return `${id}>${l}]`;
    case "Function": return `${id}(${l})`;
    case "Actor": return `${id}([${l}])`;
    case "Event": return `${id}{{${l}}}`;
    case "DataObject": return `${id}[(${l})]`;
    default: return `${id}[${l}]`;
  }
}

// A safe, stable Mermaid node id from the element's uuid (Mermaid ids can't
// contain hyphens unquoted).
const nodeId = (uuid) => "n" + String(uuid).replace(/[^a-zA-Z0-9]/g, "");

// Escape a label for a quoted Mermaid string.
const esc = (s) => String(s == null ? "" : s).replace(/"/g, "&quot;").replace(/\r?\n/g, " ");

// Turn a Contour graph { nodes, edges } into Mermaid flowchart source. Nodes are
// shaped by element type; edges are labelled by their Contour verb (or the
// "uses via <Interface>" label the engine put on a uses edge). An edge that
// carries an `ordinal` (a Function View's step edge) is prefixed with that step
// number — the engine already computed it in record order. Edges whose endpoints
// aren't both present are dropped (belt-and-braces; the engine omits dangling).
// Each kept edge is given a stable `id` (e<index>) so selection highlighting can
// find its path in the rendered SVG.
export function graphToMermaid(graph, focusId) {
  const nodes = (graph && graph.nodes) || [];
  const edges = (graph && graph.edges) || [];
  if (!nodes.length) return null;
  const present = new Set(nodes.map((n) => n.id));

  const lines = ["flowchart LR"];
  for (const n of nodes) {
    lines.push("  " + shapeFor(n.elementType, nodeId(n.id), esc(n.name)));
  }
  for (const e of edges) {
    if (!present.has(e.from) || !present.has(e.to)) continue;
    const base = esc(e.label || e.verb);
    const label = e.ordinal ? `${e.ordinal}. ${base}` : base;
    lines.push(`  ${nodeId(e.from)} -- "${label}" --> ${nodeId(e.to)}`);
  }
  return lines.join("\n");
}

// Build a lookup from a rendered edge's endpoint node ids ("nodeId(from)->nodeId(to)") to the
// hint text the engine put on that edge — the `when` condition of a conditional alternative's
// effect (contour.md §3.3). Used to attach an on-hover explanation to the matching edge path.
// Derived only from the already-fetched graph; edges without a hint are omitted.
export function buildEdgeHints(graph) {
  const edges = (graph && graph.edges) || [];
  const m = new Map();
  for (const e of edges) {
    if (!e || !e.hint) continue;
    m.set(`${nodeId(e.from)}->${nodeId(e.to)}`, String(e.hint));
  }
  return m;
}

// Build what the selection highlight needs, keyed by the Mermaid node id
// (nodeId(uuid)) so the rendered SVG can be matched directly by id/classes:
//   - reach(nodeId): the full-depth reachable set from that node, following
//     relationships transitively (undirected), the node itself included.
//   - edgeInReach(set, from, to): whether an edge both of whose endpoints are in
//     a reach set should light up (both ends reachable → the edge is part of the
//     highlighted subgraph).
// Derived only from the already-fetched graph.
function buildAdjacency(graph) {
  const nodes = (graph && graph.nodes) || [];
  const edges = (graph && graph.edges) || [];
  const present = new Set(nodes.map((n) => n.id));
  // Directed adjacency keyed by Mermaid node id: out.get(a) holds every b where
  // an edge runs a → b. Highlighting follows edge direction, so selecting a node
  // reveals only its downstream path (what it points to), not its callers.
  const out = new Map(); // nid -> Set(nid) reachable in one directed hop
  const nids = new Set(nodes.map((n) => nodeId(n.id)));
  for (const n of nodes) out.set(nodeId(n.id), new Set());
  for (const e of edges) {
    if (!present.has(e.from) || !present.has(e.to)) continue;
    out.get(nodeId(e.from)).add(nodeId(e.to));
  }
  // Full-depth downstream set from a start node (the node itself included),
  // following edges only in their direction (transitive closure over `out`).
  const reach = (startNid) => {
    const seen = new Set();
    if (!out.has(startNid)) return seen;
    const stack = [startNid];
    while (stack.length) {
      const cur = stack.pop();
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const nb of out.get(cur) || []) if (!seen.has(nb)) stack.push(nb);
    }
    return seen;
  };
  // An edge a → b is on the highlighted downstream path when its source `a` is
  // in the downstream set (its target `b` is then in the set by construction).
  const edgeOnPath = (set, a, b) => set.has(a) && set.has(b) && out.get(a)?.has(b);
  return { reach, edgeOnPath, has: (nid) => nids.has(nid) };
}

// Pull the Contour node id (our nodeId(uuid), e.g. "n1a2b3") out of a node <g>.
// Mermaid 12's flowchart renderer sets the group id to
// `${renderId}-flowchart-${nid}-${counter}` (confirmed against mermaid 12.3).
function nidOfNodeEl(g) {
  const id = g.id || "";
  const m = id.match(/-flowchart-(n[a-zA-Z0-9]+)-\d+$/);
  return m ? m[1] : null;
}

// The two endpoint node ids of an edge <path>. Mermaid 12 gives the edge path
// class "flowchart-link" (no LS-/LE- classes) and encodes the endpoints in its
// id: `${renderId}-L_${startNid}_${endNid}_${counter}` (confirmed, mermaid 12.3).
function endpointsOfEdgeEl(p) {
  const id = p.id || "";
  const m = id.match(/-L_(n[a-zA-Z0-9]+)_(n[a-zA-Z0-9]+)_\d+$/);
  return m ? [m[1], m[2]] : [null, null];
}

// The edge-label groups, paired to their edge paths by document order. Mermaid 12
// emits one label group per edge under `g.edgeLabels`, in the same order as the
// `path.flowchart-link` edges, so the i-th label belongs to the i-th edge. The group
// has carried the class `edgeLabel` across 12.x builds; we also accept a direct child
// of `g.edgeLabels` as a fallback. Returns the label group elements in document order.
function edgeLabelEls(svgEl) {
  const byClass = Array.from(svgEl.querySelectorAll("g.edgeLabels g.edgeLabel"));
  if (byClass.length) return byClass;
  const container = svgEl.querySelector("g.edgeLabels");
  return container ? Array.from(container.querySelectorAll(":scope > g")) : [];
}

// Highlight styling — accent stroke on the node's shape and the edge's path.
// We touch only presentation (stroke/width/filter); no geometry, no model.
const HL_WIDTH_SELECTED = "3px";
const HL_WIDTH_REACHED = "2px";

function nodeShapes(g) {
  // The drawable shapes inside a node <g> (rect/circle/polygon/path/ellipse).
  return Array.from(g.querySelectorAll("rect, circle, ellipse, polygon, path"));
}
function setNodeHL(g, isSelected) {
  for (const s of nodeShapes(g)) {
    if (s.dataset.hlPrevStroke === undefined) {
      s.dataset.hlPrevStroke = s.style.stroke || "";
      s.dataset.hlPrevWidth = s.style.strokeWidth || "";
    }
    s.style.stroke = C.accent;
    s.style.strokeWidth = isSelected ? HL_WIDTH_SELECTED : HL_WIDTH_REACHED;
  }
}
function clearNodeHL(g) {
  for (const s of nodeShapes(g)) {
    if (s.dataset.hlPrevStroke !== undefined) {
      s.style.stroke = s.dataset.hlPrevStroke;
      s.style.strokeWidth = s.dataset.hlPrevWidth;
      delete s.dataset.hlPrevStroke;
      delete s.dataset.hlPrevWidth;
    }
  }
}
function setEdgeHL(p) {
  if (p.dataset.hlPrevStroke === undefined) {
    p.dataset.hlPrevStroke = p.style.stroke || "";
    p.dataset.hlPrevWidth = p.style.strokeWidth || "";
  }
  p.style.stroke = C.accent;
  p.style.strokeWidth = HL_WIDTH_REACHED;
}
function clearEdgeHL(p) {
  if (p.dataset.hlPrevStroke !== undefined) {
    p.style.stroke = p.dataset.hlPrevStroke;
    p.style.strokeWidth = p.dataset.hlPrevWidth;
    delete p.dataset.hlPrevStroke;
    delete p.dataset.hlPrevWidth;
  }
}

// Zoom bounds and step for the controls / wheel.
const ZOOM_MIN = 0.2;
const ZOOM_MAX = 4;
const ZOOM_STEP = 1.2; // per click of the +/- buttons
// Wheel sensitivity: higher = snappier mouse-scroll zoom, lower = gentler.
// The factor is exp(-normalizedDelta * ZOOM_WHEEL_SENSITIVITY), so each notch
// nudges the scale by a smooth, symmetric amount (zoom in ≈ 1/zoom out).
const ZOOM_WHEEL_SENSITIVITY = 0.005;
const clampZoom = (z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

// Normalize a wheel event's vertical delta to pixel-ish units, so line- and
// page-mode wheels (and trackpads) zoom at a comparable rate. Clamped so one
// aggressive notch can't jump the zoom.
function normalizeWheelDelta(ev) {
  let d = ev.deltaY;
  if (ev.deltaMode === 1) d *= 16;       // lines → ~px
  else if (ev.deltaMode === 2) d *= 100; // pages → ~px
  return Math.max(-120, Math.min(120, d));
}

// The diagram's intrinsic (unscaled) size, read from the SVG Mermaid produced —
// its viewBox if present, else its width/height attributes. Independent of any
// CSS transform applied to the surface, so fit-to-view needs no scale bookkeeping.
function intrinsicSize(svgEl) {
  const vb = svgEl.getAttribute("viewBox");
  if (vb) {
    const parts = vb.split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) return { iw: parts[2], ih: parts[3] };
  }
  const iw = parseFloat(svgEl.getAttribute("width")) || svgEl.clientWidth || 0;
  const ih = parseFloat(svgEl.getAttribute("height")) || svgEl.clientHeight || 0;
  return { iw, ih };
}

export function DiagramView({ element }) {
  const elementId = element && element.id;
  const [state, setState] = useState({ phase: "loading" }); // loading|ready|empty|not-found|unavailable|error
  const [svg, setSvg] = useState("");
  // Pan/zoom transform of the diagram surface.
  const [tf, setTf] = useState({ scale: 1, x: 0, y: 0 });
  // The Mermaid node id (nodeId(uuid)) currently selected inside the diagram
  // (for full-depth relationship highlighting), or null when nothing is selected.
  const [selected, setSelected] = useState(null);
  // Whether the diagram is presented full-screen (via the Fullscreen API).
  const [fullscreen, setFullscreen] = useState(false);
  const containerRef = useRef(null); // the outer box (the fullscreen target)
  const frameRef = useRef(null); // the clipping viewport
  const surfaceRef = useRef(null); // the transformed surface holding the SVG
  const pan = useRef(null); // in-progress drag: { startX, startY, origX, origY }

  const graph = state.phase === "ready" ? state.graph : null;
  const adjacency = useMemo(() => (graph ? buildAdjacency(graph) : null), [graph]);
  const edgeHints = useMemo(() => (graph ? buildEdgeHints(graph) : null), [graph]);

  // Load the element's graph (Read Element -> Export Graph). One call: the engine
  // returns the projection for the element's type — a Function yields the
  // step-ordered, depth-resolved Function View already shaped, so Meanings does
  // no expansion, filtering or numbering of its own.
  useEffect(() => {
    let cancelled = false;
    if (!elementId) { setState({ phase: "empty" }); return; }
    setState({ phase: "loading" });
    api.graph(elementId)
      .then((graph) => { if (!cancelled) setState({ phase: "ready", graph }); })
      .catch((e) => {
        if (cancelled) return;
        if (e instanceof NotFound) setState({ phase: "not-found" });
        else if (e instanceof CatalogUnavailable) setState({ phase: "unavailable" });
        else setState({ phase: "error", message: String(e.message || e) });
      });
    return () => { cancelled = true; };
  }, [elementId]);

  // Render with Mermaid once the graph is in hand.
  useEffect(() => {
    if (state.phase !== "ready") { setSvg(""); return; }
    const src = graphToMermaid(state.graph, elementId);
    if (!src) { setState({ phase: "empty" }); return; }
    let cancelled = false;
    ensureMermaid();
    const renderId = "contour-diagram-" + Math.random().toString(36).slice(2);
    mermaid.render(renderId, src)
      .then(({ svg }) => { if (!cancelled) setSvg(svg); })
      .catch((e) => { if (!cancelled) setState({ phase: "error", message: "Could not render diagram: " + String(e.message || e) }); });
    return () => { cancelled = true; };
  }, [state.phase, state.graph, elementId]);

  // Attach on-hover hints to conditional-branch edges, on the edge LABEL (the verb text drawn on
  // the arrow) rather than the line. A long-form alternative's effect (contour.md §3.3) is drawn
  // without a step number; its `when` condition rides along as an SVG <title> on the label, so
  // hovering the label explains when the branch is taken. Presentation only over the already-fetched
  // graph — no re-derivation, no engine call. Edge paths and their label groups are emitted by
  // Mermaid in the same order, so the i-th label belongs to the i-th edge; we identify the edge by
  // the path's decoded endpoints and hang the hint on the paired label.
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface || !svg) return;
    const svgEl = surface.querySelector("svg");
    if (!svgEl) return;

    // Always clear anything we injected on a previous pass (re-render reuses the DOM).
    for (const t of Array.from(svgEl.querySelectorAll("title[data-contour-hint]"))) t.remove();
    for (const r of Array.from(svgEl.querySelectorAll("rect[data-contour-hitrect]"))) r.remove();
    for (const el of Array.from(svgEl.querySelectorAll("[data-contour-hinted]"))) {
      el.removeAttribute("data-contour-hinted");
      el.style.cursor = "";
      el.style.pointerEvents = "";
    }
    if (!edgeHints || edgeHints.size === 0) return;

    const mkTitle = (text) => {
      const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
      title.setAttribute("data-contour-hint", "1");
      title.textContent = text;
      return title;
    };

    const paths = Array.from(svgEl.querySelectorAll("path.flowchart-link"));
    const labels = edgeLabelEls(svgEl);

    // Prefer matching a label to its edge by the endpoints encoded in the label's own id
    // (Mermaid 12 sets `id="...L_<from>_<to>_<n>"` on the label group in most builds); fall back
    // to document order, which Mermaid keeps identical between paths and labels.
    const labelByEndpoints = new Map();
    for (const l of labels) {
      const id = l.id || "";
      const m = id.match(/-L_(n[a-zA-Z0-9]+)_(n[a-zA-Z0-9]+)_\d+$/);
      if (m) labelByEndpoints.set(`${m[1]}->${m[2]}`, l);
    }

    paths.forEach((p, i) => {
      const [a, b] = endpointsOfEdgeEl(p);
      const hint = a && b ? edgeHints.get(`${a}->${b}`) : undefined;
      if (!hint) return;
      const label = (a && b && labelByEndpoints.get(`${a}->${b}`)) || labels[i];
      if (!label) return;
      // The label group is the hover target: a comfortable area over the verb text. A native
      // <title> tooltip shows on hover. Because the text glyphs leave gaps, lay a transparent
      // background rect over the label's bounding box so the whole label area catches the pointer.
      label.setAttribute("data-contour-hinted", "1");
      label.style.cursor = "help";
      label.style.pointerEvents = "all";
      try {
        const bb = label.getBBox();
        const pad = 4;
        const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        rect.setAttribute("data-contour-hitrect", "1");
        rect.setAttribute("x", String(bb.x - pad));
        rect.setAttribute("y", String(bb.y - pad));
        rect.setAttribute("width", String(bb.width + pad * 2));
        rect.setAttribute("height", String(bb.height + pad * 2));
        rect.setAttribute("fill", "transparent");
        rect.style.pointerEvents = "all";
        rect.style.cursor = "help";
        rect.appendChild(mkTitle(hint));
        label.insertBefore(rect, label.firstChild);
      } catch {
        // getBBox can throw if the label isn't laid out yet; the group title below still applies.
      }
      label.appendChild(mkTitle(hint));
    });
  }, [svg, edgeHints]);

  // When a new element's graph renders, open with nothing highlighted (the
  // whole graph at normal strength) and the diagram fit to the frame. The
  // Modeler highlights a node's full-depth relations by clicking it.
  useEffect(() => {
    if (!svg) return;
    setSelected(null);
    // Defer the fit until the SVG is in the DOM and measurable.
    const t = setTimeout(() => fitToView(), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [svg]);

  // Apply the relationship highlight to the rendered SVG whenever the selection
  // (or the SVG) changes. Presentation only over the already-fetched graph — it
  // reads and writes no model content. It does NOT dim anything: it positively
  // highlights the selected node and, in full depth, every node and edge reachable
  // from it through the relationships (transitive closure), leaving the rest at
  // their normal appearance.
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface || !adjacency) return;
    const svgEl = surface.querySelector("svg");
    if (!svgEl) return;

    const nodeEls = Array.from(svgEl.querySelectorAll("g.node"));
    const edgePaths = Array.from(svgEl.querySelectorAll("path.flowchart-link"));

    // Clear any previous highlight; set the pointer cursor on nodes. Selection
    // is driven by the frame's pointer handlers (so it cooperates with panning),
    // not by per-node click handlers. Matching is deterministic against Mermaid
    // 12's DOM: a node's group id ends "-flowchart-<nid>-<n>"; an edge path's id
    // ends "-L_<startNid>_<endNid>_<n>".
    for (const g of nodeEls) {
      const nid = nidOfNodeEl(g);
      clearNodeHL(g);
      g.style.cursor = nid ? "pointer" : "default";
    }
    for (const p of edgePaths) clearEdgeHL(p);

    if (!selected || !adjacency.has(selected)) return;

    // Full-depth downstream set from the selected node (the node itself included).
    const reached = adjacency.reach(selected);

    for (const g of nodeEls) {
      const nid = nidOfNodeEl(g);
      if (nid && reached.has(nid)) setNodeHL(g, nid === selected);
    }
    for (const p of edgePaths) {
      const [a, b] = endpointsOfEdgeEl(p);
      // An edge lights up only when it is on the downstream path (a → b, with a
      // in the downstream set) — so callers of the selected node stay dark.
      if (a && b && adjacency.edgeOnPath(reached, a, b)) setEdgeHL(p);
    }
  }, [svg, selected, adjacency]);

  // --- pan / zoom controls ---------------------------------------------------

  function fitToView() {
    const frame = frameRef.current;
    const surface = surfaceRef.current;
    const svgEl = surface && surface.querySelector("svg");
    if (!frame || !svgEl) return;
    const fw = frame.clientWidth;
    const fh = frame.clientHeight;
    // Intrinsic diagram size, independent of the CSS transform currently applied:
    // prefer the viewBox Mermaid sets, fall back to the width/height attributes.
    const { iw, ih } = intrinsicSize(svgEl);
    if (!iw || !ih) return;
    const pad = 24;
    const scale = clampZoom(Math.min((fw - pad) / iw, (fh - pad) / ih, ZOOM_MAX));
    // Centre the scaled diagram in the frame.
    const x = (fw - iw * scale) / 2;
    const y = (fh - ih * scale) / 2;
    setTf({ scale, x, y });
  }

  function zoomBy(factor) {
    setTf((t) => {
      const frame = frameRef.current;
      const scale = clampZoom(t.scale * factor);
      if (!frame) return { ...t, scale };
      // Zoom around the frame centre so the view stays put.
      const cx = frame.clientWidth / 2;
      const cy = frame.clientHeight / 2;
      const k = scale / t.scale;
      return { scale, x: cx - (cx - t.x) * k, y: cy - (cy - t.y) * k };
    });
  }

  const resetZoom = () => setTf((t) => ({ ...t, scale: 1 }));

  // Full-screen the diagram via the Fullscreen API on the outer container. Track
  // the actual fullscreen element so the button label and styling stay in sync
  // even when the user exits with Esc, and re-fit when the viewport size changes.
  useEffect(() => {
    const onFsChange = () => {
      const fs = document.fullscreenElement === containerRef.current;
      setFullscreen(fs);
      // The frame just resized to (or back from) the whole screen — refit.
      setTimeout(() => fitToView(), 0);
    };
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleFullscreen = () => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement === el) {
      document.exitFullscreen?.();
    } else if (el.requestFullscreen) {
      el.requestFullscreen().catch(() => {});
    }
  };

  // Wheel-zoom must call preventDefault to stop the page scrolling, which a
  // React onWheel (passive) can't do — so bind a non-passive native listener.
  // Keeps the point under the cursor fixed while zooming.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const onWheel = (ev) => {
      if (!svg) return;
      ev.preventDefault();
      const rect = frame.getBoundingClientRect();
      const px = ev.clientX - rect.left;
      const py = ev.clientY - rect.top;
      setTf((t) => {
        // Smooth, delta-proportional zoom: gentle per notch, symmetric in/out.
        const factor = Math.exp(-normalizeWheelDelta(ev) * ZOOM_WHEEL_SENSITIVITY);
        const scale = clampZoom(t.scale * factor);
        const k = scale / t.scale;
        return { scale, x: px - (px - t.x) * k, y: py - (py - t.y) * k };
      });
    };
    frame.addEventListener("wheel", onWheel, { passive: false });
    return () => frame.removeEventListener("wheel", onWheel);
  }, [svg]);

  const onPointerDown = (ev) => {
    if (!svg) return;
    if (ev.button !== 0) return; // left button only
    // Remember where the press started and what it landed on; the node (if any)
    // is resolved from THIS target, not from pointerup (pointer capture would
    // otherwise retarget pointerup to the frame and lose the node).
    const nodeEl = ev.target && ev.target.closest ? ev.target.closest("g.node") : null;
    pan.current = {
      startX: ev.clientX, startY: ev.clientY,
      origX: tf.x, origY: tf.y,
      moved: false, captured: false,
      nid: nodeEl ? nidOfNodeEl(nodeEl) : null,
    };
  };
  const onPointerMove = (ev) => {
    if (!pan.current) return;
    const dx = ev.clientX - pan.current.startX;
    const dy = ev.clientY - pan.current.startY;
    if (!pan.current.moved && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
      pan.current.moved = true;
      // Start capturing only once it's really a drag, so a tap stays a tap.
      try { frameRef.current.setPointerCapture?.(ev.pointerId); pan.current.captured = true; } catch {}
      // Clear any text selection the drag may have started on an SVG label.
      try { window.getSelection && window.getSelection().removeAllRanges(); } catch {}
    }
    if (!pan.current.moved) return;
    // Capture the drag origin into locals before updating state. The setTf
    // updater must not dereference pan.current, which endPan/onPointerLeave can
    // null out between this call and when React invokes the updater — that race
    // is what threw "Cannot read properties of null (reading 'origX')".
    const { origX, origY } = pan.current;
    setTf((t) => ({ ...t, x: origX + dx, y: origY + dy }));
  };
  const endPan = (ev) => {
    const g = pan.current;
    pan.current = null;
    if (!g) return;
    if (g.captured) { try { frameRef.current.releasePointerCapture?.(ev.pointerId); } catch {} }
    if (g.moved) return; // a drag, not a tap — leave selection as is
    // A tap: select the node pressed, toggling it off if already selected; a tap
    // on empty canvas clears the selection.
    if (g.nid) setSelected((s) => (s === g.nid ? null : g.nid));
    else setSelected(null);
  };

  const Note = ({ children }) => (
    <div style={{ fontSize: 13, color: C.textDim, padding: "18px 4px", fontFamily: MONO }}>{children}</div>
  );

  if (state.phase === "loading") return <Note>Loading diagram…</Note>;
  if (state.phase === "empty") return <Note>No diagram for this element.</Note>;
  if (state.phase === "not-found") return <Note>No graph for this element — it may have been removed, or the diagram service is unavailable.</Note>;
  if (state.phase === "unavailable") return <Note>Catalog Unavailable — the diagram can’t be loaded right now.</Note>;
  if (state.phase === "error") return <Note>{state.message}</Note>;

  return (
    <div
      ref={containerRef}
      aria-label="Diagram View"
      style={{
        position: "relative",
        background: C.panel,
        border: fullscreen ? "none" : `1px solid ${C.line}`,
        borderRadius: fullscreen ? 0 : 4,
        height: fullscreen ? "100vh" : 520,
        width: "100%",
        boxSizing: "border-box",
        overflow: "hidden",
      }}
    >
      <div
        ref={frameRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPan}
        onPointerLeave={() => { pan.current = null; }}
        style={{
          position: "absolute",
          inset: 0,
          overflow: "hidden",
          cursor: pan.current ? "grabbing" : "grab",
          touchAction: "none",
          userSelect: "none",
          WebkitUserSelect: "none",
          MozUserSelect: "none",
          msUserSelect: "none",
        }}
      >
        <div
          ref={surfaceRef}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            transformOrigin: "0 0",
            transform: `translate(${tf.x}px, ${tf.y}px) scale(${tf.scale})`,
          }}
          // Mermaid returns a self-contained SVG string; securityLevel "strict"
          // keeps labels free of markup, so this is a sanitized SVG.
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>

      <ZoomControls
        scale={tf.scale}
        onIn={() => zoomBy(ZOOM_STEP)}
        onOut={() => zoomBy(1 / ZOOM_STEP)}
        onReset={resetZoom}
        onFit={fitToView}
        fullscreen={fullscreen}
        onToggleFullscreen={toggleFullscreen}
      />
    </div>
  );
}

// The overlaid zoom/fit/fullscreen control cluster (top-right of the diagram frame).
function ZoomControls({ scale, onIn, onOut, onReset, onFit, fullscreen, onToggleFullscreen }) {
  const btn = {
    width: 32, height: 32, borderRadius: "50%",
    background: C.panel, border: `1px solid ${C.lineStrong}`,
    color: C.text, fontSize: 16, lineHeight: "1", cursor: "pointer",
    display: "inline-flex", alignItems: "center", justifyContent: "center",
  };
  return (
    <div
      role="toolbar"
      aria-label="Diagram controls"
      style={{
        position: "absolute", top: 12, right: 12,
        display: "flex", flexDirection: "column", gap: 6, alignItems: "center",
      }}
    >
      <button type="button" title="Zoom in" aria-label="Zoom in" style={btn} onClick={onIn}>+</button>
      <button
        type="button"
        title="Reset to 100%"
        aria-label="Reset zoom to 100%"
        onClick={onReset}
        style={{ ...btn, width: "auto", borderRadius: 16, padding: "0 10px", fontSize: 12, fontFamily: MONO }}
      >
        {Math.round(scale * 100)}%
      </button>
      <button type="button" title="Zoom out" aria-label="Zoom out" style={btn} onClick={onOut}>−</button>
      <button
        type="button"
        title="Fit to view"
        aria-label="Fit diagram to view"
        onClick={onFit}
        style={{ ...btn, fontSize: 14 }}
      >
        ⤢
      </button>
      <button
        type="button"
        title={fullscreen ? "Exit full screen" : "Full screen"}
        aria-label={fullscreen ? "Exit full screen" : "Full screen"}
        aria-pressed={fullscreen}
        onClick={onToggleFullscreen}
        style={{ ...btn, fontSize: 15 }}
      >
        {fullscreen ? "⤧" : "⛶"}
      </button>
    </div>
  );
}
