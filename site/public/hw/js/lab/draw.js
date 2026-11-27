// Leaf-spine drawing for the lab (step 06). Spines on top, leaves below. A link's thickness
// follows its load; its label is "load / capacity"; a bottleneck (>= 99%) gets a gold outline;
// a failed link (0) is dashed. The selected demand's paths are violet, with their share.
// Styles in hw.css (tokens only).

const SVG = "http://www.w3.org/2000/svg";

function el(tag, attrs = {}, parent) {
  const n = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
  parent?.append(n);
  return n;
}

const fmt = (x) => (Math.abs(x - Math.round(x)) < 0.05 ? String(Math.round(x)) : x.toFixed(1));

/**
 * opts: { net, baseNet, result (or null: hide numbers), demand (selected, or null), demandPaths,
 *         splitRates: { spine: Gbps } for the demand, editable, selectedLink, onLink(key) }
 */
export function drawFabric(host, opts) {
  const { net, baseNet, result, demand, demandPaths = [], splitRates = {}, editable, selectedLink, onLink } = opts;
  const W = 560;
  const H = 300;
  const xs = (n, i) => 60 + (n === 1 ? (W - 120) / 2 : (i * (W - 120)) / (n - 1));
  const sp = Object.fromEntries(net.spines.map((s, i) => [s, [xs(net.spines.length, i), 52]]));
  const lf = Object.fromEntries(net.leaves.map((l, i) => [l, [xs(net.leaves.length, i), 250]]));
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, class: "fabric", role: "group", "aria-label": "Leaf-spine fabric" });

  // physical links: any pair that exists in the paper's version or now (a failed one stays, dashed)
  const pairs = [];
  for (const l of net.leaves) for (const s of net.spines) {
    const capNow = Math.max(net.cap[`${l}>${s}`] ?? 0, net.cap[`${s}>${l}`] ?? 0);
    const capBase = Math.max(baseNet.cap[`${l}>${s}`] ?? 0, baseNet.cap[`${s}>${l}`] ?? 0);
    if (capNow > 0 || capBase > 0) pairs.push({ l, s, key: `${l}-${s}`, cap: capNow });
  }
  const links = el("g", { class: "fabric-links" }, svg);
  // Dense fabrics (Fig 17 has 20 links): label only the selected demand's links and the edited one.
  const dense = pairs.length > 8;
  const onPath = (p) => demand && demandPaths.includes(p.s) && (p.l === demand.src || p.l === demand.dst);
  for (const p of pairs) {
    const [x1, y1] = sp[p.s];
    const [x2, y2] = lf[p.l];
    const loadUp = result?.linkLoad[`${p.l}>${p.s}`] ?? 0;
    const loadDown = result?.linkLoad[`${p.s}>${p.l}`] ?? 0;
    const load = Math.max(loadUp, loadDown);
    const util = p.cap > 0 ? load / p.cap : 0;
    const failed = p.cap === 0;
    const width = failed ? 1.5 : result ? 2 + (load / 80) * 10 : 3;
    const g = el("g", { class: `fabric-link${failed ? " is-failed" : ""}${result && util >= 0.99 ? " is-bottleneck" : ""}${selectedLink === p.key ? " is-selected" : ""}${editable ? " is-editable" : ""}` }, links);
    if (result && util >= 0.99) el("line", { x1, y1, x2, y2, class: "fabric-outline", "stroke-width": width + 6 }, g);
    el("line", { x1, y1, x2, y2, class: "fabric-line", "stroke-width": width }, g);
    // a wide invisible line so thin links are easy to click
    const hit = el("line", { x1, y1, x2, y2, class: "fabric-hit" }, g);
    // near the spine end, where crossing links are still apart; on a dense fabric the
    // destination's links get a second, lower band so the two sets of labels don't collide
    const t = dense && demand && p.l === demand.dst ? 0.56 : 0.28;
    const mx = x1 + (x2 - x1) * t;
    const my = y1 + (y2 - y1) * t;
    const label = failed ? "failed" : result ? `${fmt(load)} / ${p.cap}` : `${p.cap}`;
    if (!dense || onPath(p) || selectedLink === p.key) {
      const txt = el("text", { x: mx, y: my, class: "fabric-label", "text-anchor": "middle" }, g);
      txt.textContent = label;
    }
    const name = `${p.l}–${p.s}`;
    const desc = failed ? `${name}: failed` : result ? `${name}: ${fmt(load)} of ${p.cap} Gbps (${Math.round(util * 100)}%)` : `${name}: ${p.cap} Gbps`;
    if (editable) {
      g.setAttribute("role", "button");
      g.setAttribute("tabindex", "0");
      g.setAttribute("aria-label", `${desc}. Change its capacity`);
      const fire = () => onLink?.(p.key);
      g.addEventListener("click", fire);
      g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fire(); } });
    } else {
      g.setAttribute("role", "img");
      g.setAttribute("aria-label", desc);
    }
    el("title", {}, hit).textContent = desc;
  }

  // the selected demand's paths
  if (demand) {
    const pg = el("g", { class: "fabric-paths" }, svg);
    const [sx, sy] = lf[demand.src];
    const [dx, dy] = lf[demand.dst];
    const total = Object.values(splitRates).reduce((a, x) => a + x, 0);
    demandPaths.forEach((s, i) => {
      const [px, py] = sp[s];
      const off = (i - (demandPaths.length - 1) / 2) * 5;
      el("polyline", { points: `${sx + off},${sy - 12} ${px + off},${py + 12} ${dx + off},${dy - 12}`, class: "fabric-path" }, pg);
      if (result && splitRates[s] != null) {
        const share = total > 0 ? Math.round((splitRates[s] / total) * 100) : 0;
        const t = el("text", { x: px, y: py - 18, class: "fabric-share", "text-anchor": "middle" }, pg);
        t.textContent = `${fmt(splitRates[s])}G · ${share}%`;
      }
    });
  }

  const nodes = el("g", { class: "fabric-nodes" }, svg);
  for (const [s, [x, y]] of Object.entries(sp)) {
    el("circle", { cx: x, cy: y, r: 15, class: "fabric-spine" }, nodes);
    el("text", { x, y: y + 4, class: "fabric-node-label", "text-anchor": "middle" }, nodes).textContent = s;
  }
  for (const [l, [x, y]] of Object.entries(lf)) {
    const role = demand && l === demand.src ? " is-src" : demand && l === demand.dst ? " is-dst" : "";
    el("circle", { cx: x, cy: y, r: 15, class: `fabric-leaf${role}` }, nodes);
    el("text", { x, y: y + 4, class: "fabric-node-label", "text-anchor": "middle" }, nodes).textContent = l;
  }
  if (demand) {
    const [sx, sy] = lf[demand.src];
    const [dx] = lf[demand.dst];
    el("text", { x: sx, y: sy + 34, class: "fabric-tag", "text-anchor": "middle" }, nodes).textContent = "source";
    el("text", { x: dx, y: sy + 34, class: "fabric-tag", "text-anchor": "middle" }, nodes).textContent = "destination";
  }
  host.replaceChildren(svg);
  return svg;
}
