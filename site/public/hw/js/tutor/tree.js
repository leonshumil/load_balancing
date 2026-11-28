// Figure 1 as a live SVG tree (step 12). Layout follows the paper's figure: CONGA's path
// runs down the middle; each fork's branches sit on one row. Styles in hw.css (tokens only).
// renderTree(svgHost, view, { onNode }) redraws from treeView(state) (model.js).

import { TREE } from "../path/model.js";

const SVG = "http://www.w3.org/2000/svg";
const W = 380;
const H = 590;
const ROW = 112; // room under each row for a label and a two-line cost note

// Node centres, by row (CONGA Fig 1, top to bottom).
const y = (row) => 62 + row * ROW;
const POS = {
  root: [190, 14],
  centralized: [80, y(0)], distributed: [270, y(0)],
  "in-network": [190, y(1)], "host-based": [322, y(1)],
  local: [96, y(2)], global: [262, y(2)],
  "link-state": [150, y(3)], "leaf-to-leaf": [306, y(3)],
  "per-flow": [72, y(4)], "per-flowlet": [196, y(4)], "per-packet": [308, y(4)],
};

/** Split a label into at most two lines at ", " or " (" (labels are the paper's, unchanged). */
export function labelLines(text) {
  if (text.length <= 14) return [text];
  const i = text.indexOf(" (");
  if (i > 0) return [text.slice(0, i), text.slice(i + 1)];
  const j = text.indexOf(", ");
  if (j > 0) return [text.slice(0, j + 1), text.slice(j + 2)];
  return [text];
}

/** Word-wrap a cost note into lines of at most `max` characters. */
export function wrap(text, max = 24) {
  const lines = [];
  let cur = "";
  for (const w of text.split(" ")) {
    if (cur && (cur + " " + w).length > max) { lines.push(cur); cur = w; } else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) lines.push(cur);
  return lines;
}

const STATUS_TEXT = { future: "not reached yet", current: "a branch of the current fork", path: "the paper's choice", rejected: "rejected by the paper" };

function el(tag, attrs = {}, parent) {
  const n = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  parent?.append(n);
  return n;
}

export function renderTree(host, view, { onNode, canAsk } = {}) {
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, class: "fig1", role: "group", "aria-label": "Figure 1, the design space for load balancing" });
  el("title", {}, svg).textContent = "Figure 1: design space for load balancing (CONGA, SIGCOMM 2014)";

  // edges first, so the nodes sit on top
  const edges = el("g", { class: "fig1-edges" }, svg);
  // CONGA's path last, so its solid line covers the trunk it shares with the rejected branches.
  const ORDER = { future: 0, current: 1, rejected: 2, path: 3 };
  const byStatus = Object.entries(TREE).filter(([, n]) => n.parent).sort(([a], [b]) => ORDER[view[a].status] - ORDER[view[b].status]);
  for (const [id, n] of byStatus) {
    const [px, py] = POS[n.parent];
    const [cx, cy] = POS[id];
    const midY = Math.max(py + 12, cy - 30); // the elbow sits just above the child row, below the parent row's notes
    el("path", { d: `M${px},${py + 7} V${midY} H${cx} V${cy - 8}`, class: `fig1-edge is-${view[id].status}` }, edges);
  }

  // the current fork: a faint band behind its row (the branches stay neutral until one is picked)
  const current = Object.keys(POS).filter((id) => id !== "root" && view[id].status === "current");
  if (current.length) {
    const xs = current.map((id) => POS[id][0]);
    const cy = POS[current[0]][1];
    el("rect", { x: Math.max(2, Math.min(...xs) - 70), y: cy - 20, width: Math.min(W - 4, Math.max(...xs) - Math.min(...xs) + 140), height: 56, rx: 12, class: "fig1-band" }, edges.parentNode.insertBefore(el("g", { class: "fig1-bands" }), edges));
  }

  const nodes = el("g", { class: "fig1-nodes" }, svg);
  const rootDot = el("circle", { cx: POS.root[0], cy: POS.root[1], r: 4, class: "fig1-root" }, nodes);
  rootDot.setAttribute("aria-hidden", "true");
  // the root is unlabeled in the paper's figure; the label says what the tree is about
  el("text", { x: POS.root[0] + 10, y: POS.root[1] + 4, class: "fig1-root-label" }, nodes).textContent = "Load balancing";

  for (const id of Object.keys(POS)) {
    if (id === "root") continue;
    const v = view[id];
    const [x, y] = POS[id];
    const label = TREE[id].label;
    const question = canAsk?.(id) ?? null;
    const g = el("g", {
      class: `fig1-node is-${v.status}${v.mine ? " is-mine" : ""}${question ? " is-askable" : ""}`,
      "data-node": id,
    }, nodes);
    const desc = `${label}: ${STATUS_TEXT[v.status]}${v.mine ? ", your pick" : ""}${v.cost ? `. Figure 1: ${v.cost}` : ""}`;
    if (question) {
      g.setAttribute("role", "button");
      g.setAttribute("tabindex", "0");
      g.setAttribute("aria-label", `${desc}. Ask: ${question}`);
      const fire = () => onNode?.(id);
      g.addEventListener("click", fire);
      g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fire(); } });
    } else {
      g.setAttribute("role", "img");
      g.setAttribute("aria-label", desc);
    }
    el("title", {}, g).textContent = question ? `${desc}. Click to ask: “${question}”` : desc;
    if (v.mine) el("circle", { cx: x, cy: y, r: 11, class: "fig1-mine" }, g);
    el("circle", { cx: x, cy: y, r: 7, class: "fig1-dot" }, g);
    const lines = labelLines(label);
    const t = el("text", { x, y: y + 22, class: "fig1-label", "text-anchor": "middle" }, g);
    lines.forEach((line, i) => {
      const span = el("tspan", { x, dy: i ? 13 : 0 }, t);
      if (i) span.setAttribute("class", "fig1-label-sub");
      span.textContent = line;
    });
    if (v.cost) {
      const c = el("text", { x, y: y + 24 + lines.length * 13, class: "fig1-cost", "text-anchor": "middle" }, g);
      wrap(v.cost).forEach((line, i) => {
        const span = el("tspan", { x, dy: i ? 11 : 0 }, c);
        span.textContent = line;
      });
    }
  }
  host.replaceChildren(svg);
  return svg;
}
