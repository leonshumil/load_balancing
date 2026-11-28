// Leaf-spine drawing for the lab, laid out like the paper's figures (step 14): traffic flows
// left to right. Sending leaves on the left, spines in the middle, receiving leaves on the
// right; a leaf that both sends and receives appears on both sides (the "unfolded" fabric).
// Left links are uplinks (leaf->spine), right links downlinks (spine->leaf).
// Link thickness = load; label "load / capacity"; a full link turns gold and says "full";
// failed (0) is dashed. The selected demand's paths are violet (shares in the results card). Small dots
// move along loaded links at a speed that follows the throughput (none with reduced motion).
// The SVG is built once per topology and then updated, so loads animate (CSS, ~400 ms).
// Styles in hw.css (tokens only).

const SVG = "http://www.w3.org/2000/svg";

function el(tag, attrs = {}, parent) {
  const n = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
  parent?.append(n);
  return n;
}

export const fmt = (x) => (Math.abs(x - Math.round(x)) < 0.05 ? String(Math.round(x)) : x.toFixed(1));

/** Which leaves go left (they send) and right (they receive). Idle leaves go left. */
export function columns(net, demands) {
  const src = new Set(demands.filter((d) => d.gbps > 0).map((d) => d.src));
  const dst = new Set(demands.filter((d) => d.gbps > 0).map((d) => d.dst));
  const left = net.leaves.filter((l) => src.has(l) || !dst.has(l));
  const right = net.leaves.filter((l) => dst.has(l));
  return { left, right };
}

/** Dense fabrics (Fig 17: 40 links) stay straight; there one demand is shown at a time instead. */
const isDense = (links) => links.length > 16;

export function createFabric(host, { onLink, onSelectSource } = {}) {
  let built = null;

  function build(net, baseNet, demands) {
    const { left, right } = columns(net, demands);
    const spines = net.spines;
    const capNow = (a, b) => net.cap[`${a}>${b}`] ?? 0;
    const capBase = (a, b) => baseNet.cap[`${a}>${b}`] ?? 0;
    const links = [];
    for (const l of left) for (const s of spines) if (capBase(l, s) > 0 || capNow(l, s) > 0) links.push({ dir: "up", from: l, to: s, phys: `${l}-${s}`, link: `${l}>${s}` });
    for (const r of right) for (const s of spines) if (capBase(s, r) > 0 || capNow(s, r) > 0) links.push({ dir: "down", from: s, to: r, phys: `${r}-${s}`, link: `${s}>${r}` });
    const key = JSON.stringify([left, right, spines, links.map((x) => x.link)]);
    if (built?.key === key) return built;

    const W = 640;
    const rows = Math.max(left.length, spines.length, right.length);
    const H = Math.max(300, 70 * rows + 50);
    const col = (items, x) => Object.fromEntries(items.map((n, i) => [n, [x, 30 + ((i + 0.5) * (H - 60)) / items.length]]));
    const pos = { L: col(left, 70), S: col(spines, W / 2), R: col(right, W - 70) };
    const at = (x) => (x.dir === "up" ? [pos.L[x.from], pos.S[x.to]] : [pos.S[x.from], pos.R[x.to]]);
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, class: "fabric", role: "group", "aria-label": "Leaf-spine fabric: senders left, spines middle, receivers right" });
    const gLinks = el("g", { class: "fabric-links" }, svg);
    const gPaths = el("g", { class: "fabric-paths" }, svg);
    const gDots = el("g", { class: "fabric-dots", "aria-hidden": "true" }, svg);
    const gNodes = el("g", { class: "fabric-nodes" }, svg);
    const linkEls = new Map();
    // Links that cross another link (e.g. L0→S1 and L1→S0 in the Sandbox) get a slight curve, so the
    // crossing reads as two links: descending ones bow up, ascending ones bow down.
    const seg = (x) => at(x).flat();
    const crosses = (a, c) => {
      const [p1x, p1y, p2x, p2y] = a, [p3x, p3y, p4x, p4y] = c;
      const d = (ax, ay, bx, by, cx, cy) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      const shared = [[p1x, p1y], [p2x, p2y]].some(([u, v]) => [[p3x, p3y], [p4x, p4y]].some(([w, z]) => Math.hypot(u - w, v - z) < 1));
      return !shared && d(p3x, p3y, p4x, p4y, p1x, p1y) * d(p3x, p3y, p4x, p4y, p2x, p2y) < 0 && d(p1x, p1y, p2x, p2y, p3x, p3y) * d(p1x, p1y, p2x, p2y, p4x, p4y) < 0;
    };
    const curved = new Set(links.filter((x) => !isDense(links) && links.some((o) => o !== x && o.dir === x.dir && crosses(seg(x), seg(o)))).map((x) => x.link));
    for (const x of links) {
      const [[x1, y1], [x2, y2]] = at(x);
      const bend = curved.has(x.link) ? (y2 > y1 ? -1 : 1) * 16 : 0;
      const cx = (x1 + x2) / 2;
      const cy = (y1 + y2) / 2 + bend * 2; // control point; the curve's midpoint sits `bend` px off the straight line
      const d = bend ? `M${x1},${y1} Q${cx},${cy} ${x2},${y2}` : `M${x1},${y1} L${x2},${y2}`;
      const [mx, my] = [cx, (y1 + y2) / 2 + bend];
      const g = el("g", { class: "fabric-link" }, gLinks);
      const line = el("path", { d, class: "fabric-line", "data-x1": x1, "data-y1": y1, "data-x2": x2, "data-y2": y2, "data-curved": bend ? "1" : null }, g);
      const hit = el("path", { d, class: "fabric-hit" }, g);
      const label = el("text", { x: mx, y: my - 9, class: "fabric-label", "text-anchor": "middle" }, g);
      const title = el("title", {}, hit);
      const fire = () => { const r = hit.getBoundingClientRect(); onLink?.(x.phys, r.left + r.width / 2, r.top + r.height / 2); };
      g.addEventListener("click", () => { if (g.classList.contains("is-editable")) fire(); });
      g.addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && g.classList.contains("is-editable")) { e.preventDefault(); fire(); } });
      linkEls.set(x.link, { ...x, g, line, label, title, d, len: Math.hypot(x2 - x1, y2 - y1) + Math.abs(bend) });
    }
    const node = (name, [x, y], kind, side) => {
      const g = el("g", { class: `fabric-node is-${kind}`, "data-name": name, "data-side": side ?? "" }, gNodes);
      el("circle", { cx: x, cy: y, r: 17, class: "fabric-node-circle" }, g);
      el("text", { x, y: y + 4, class: "fabric-node-label", "text-anchor": "middle" }, g).textContent = name;
      return g;
    };
    const nodes = { L: {}, S: {}, R: {} };
    for (const s of spines) nodes.S[s] = node(s, pos.S[s], "spine");
    for (const l of left) {
      const g = (nodes.L[l] = node(l, pos.L[l], "leaf", "left"));
      g.addEventListener("click", () => onSelectSource?.(l));
      g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelectSource?.(l); } });
    }
    for (const r of right) nodes.R[r] = node(r, pos.R[r], "leaf", "right");
    for (const [x, text] of [[70, "senders"], [W / 2, "spines"], [W - 70, "receivers"]]) {
      el("text", { x, y: H - 6, class: "fabric-col", "text-anchor": "middle" }, svg).textContent = text;
    }
    host.replaceChildren(svg);
    built = { key, svg, links: linkEls, pos, gPaths, gDots, nodes, dense: isDense(links) };
    return built;
  }

  /**
   * opts: { net, baseNet, demands, selected, result (null hides the numbers), editable,
   *         selectedLink, motion (dots on), canSwitch (several demands to show),
   *         focus: { solid: [spines], dashed: [spines] } (optional) }
   * focus (Fig 17, where every leaf reaches every spine): only the selected demand's paths stay
   * visible: solid = the Nash flow, dashed = the better flow, as in the paper; all else fades.
   */
  function update({ net, baseNet, demands, selected, result, editable, selectedLink, motion, canSwitch, focus }) {
    const b = build(net, baseNet, demands);
    const d = demands[selected] ?? null;
    const onDemand = (x) => d && ((x.dir === "up" && x.from === d.src) || (x.dir === "down" && x.to === d.dst));
    const focusSpines = focus ? new Set([...focus.solid, ...focus.dashed]) : null;
    const inFocus = (x) => !focusSpines || (onDemand(x) && focusSpines.has(x.dir === "up" ? x.to : x.from));
    for (const x of b.links.values()) {
      const cap = net.cap[x.link] ?? 0;
      const load = result?.linkLoad[x.link] ?? 0;
      const util = cap > 0 ? load / cap : 0;
      const failed = cap === 0;
      const full = !!result && !failed && util >= 0.99;
      x.line.style.strokeWidth = String(failed ? 1.5 : result ? 2.5 + (load / 80) * 11 : 3);
      x.g.classList.toggle("is-failed", failed);
      x.g.classList.toggle("is-full", full);
      x.g.classList.toggle("is-selected", selectedLink === x.phys);
      x.g.classList.toggle("is-editable", !!editable);
      x.g.classList.toggle("is-faded", !inFocus(x));
      const showLabel = (!b.dense || onDemand(x) || selectedLink === x.phys) && inFocus(x);
      x.label.textContent = !showLabel ? "" : failed ? "failed" : result ? `${fmt(load)} / ${cap}${full ? " full" : ""}` : `${cap}G`;
      const desc = `${x.from}→${x.to}: ${failed ? "failed" : result ? `${fmt(load)} of ${cap} Gbps${full ? ", full" : ""}` : `${cap} Gbps`}`;
      x.title.textContent = editable ? `${desc}. Click to change the capacity of ${x.phys.replace("-", "–")}` : desc;
      if (editable) { x.g.setAttribute("role", "button"); x.g.setAttribute("tabindex", "0"); x.g.setAttribute("aria-label", `${desc}. Change its capacity`); }
      else { x.g.setAttribute("role", "img"); x.g.removeAttribute("tabindex"); x.g.setAttribute("aria-label", desc); }
    }
    for (const [n, g] of Object.entries(b.nodes.L)) {
      g.classList.toggle("is-src", !!d && n === d.src);
      if (canSwitch) { g.setAttribute("role", "button"); g.setAttribute("tabindex", "0"); g.setAttribute("aria-label", `${n}: show its traffic`); g.classList.add("is-clickable"); }
      else { g.removeAttribute("role"); g.removeAttribute("tabindex"); g.classList.remove("is-clickable"); }
    }
    for (const [n, g] of Object.entries(b.nodes.R)) g.classList.toggle("is-dst", !!d && n === d.dst);
    // the selected demand's paths (their shares are in the results card)
    b.gPaths.replaceChildren();
    if (d && b.pos.L[d.src] && b.pos.R[d.dst]) {
      const ok = net.spines.filter((s) => (net.cap[`${d.src}>${s}`] ?? 0) > 0 && (net.cap[`${s}>${d.dst}`] ?? 0) > 0 && (!focusSpines || focusSpines.has(s)));
      for (const s of ok) {
        const kind = !focus ? "" : focus.solid.includes(s) ? " is-solid" : " is-dashed";
        // follow the links themselves (curved ones too): uplink then downlink
        const up = b.links.get(`${d.src}>${s}`);
        const down = b.links.get(`${s}>${d.dst}`);
        if (up && down) el("path", { d: `${up.d} ${down.d}`, class: `fabric-path${kind}` }, b.gPaths);
      }
    }
    // moving dots: speed follows the throughput on the link
    b.gDots.replaceChildren();
    if (result && motion) {
      for (const x of b.links.values()) {
        const load = result.linkLoad[x.link] ?? 0;
        if (!(load > 0.5) || !inFocus(x)) continue;
        const dur = Math.min(8, Math.max(0.6, x.len / (2.2 * load)));
        for (const phase of [0, 0.5]) {
          const c = el("circle", { r: 2.6, class: "fabric-flow" }, b.gDots);
          el("animateMotion", { dur: `${dur.toFixed(2)}s`, repeatCount: "indefinite", begin: `-${(dur * phase).toFixed(2)}s`, path: x.d }, c);
        }
      }
    }
  }

  return { update };
}
