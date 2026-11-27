// Leaf-spine drawing for the lab, laid out like the paper's figures (step 14): traffic flows
// left to right. Sending leaves on the left, spines in the middle, receiving leaves on the
// right; a leaf that both sends and receives appears on both sides (the "unfolded" fabric).
// Left links are uplinks (leaf->spine), right links downlinks (spine->leaf).
// Link thickness = load; label "load / capacity"; a full link turns gold and says "full";
// failed (0) is dashed. The selected demand's paths are violet with their share. Small dots
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
    for (const x of links) {
      const [[x1, y1], [x2, y2]] = at(x);
      const g = el("g", { class: "fabric-link" }, gLinks);
      const line = el("line", { x1, y1, x2, y2, class: "fabric-line" }, g);
      const hit = el("line", { x1, y1, x2, y2, class: "fabric-hit" }, g);
      const label = el("text", { x: (x1 + x2) / 2, y: (y1 + y2) / 2 - 9, class: "fabric-label", "text-anchor": "middle" }, g);
      const title = el("title", {}, hit);
      const fire = () => { const r = hit.getBoundingClientRect(); onLink?.(x.phys, r.left + r.width / 2, r.top + r.height / 2); };
      g.addEventListener("click", () => { if (g.classList.contains("is-editable")) fire(); });
      g.addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && g.classList.contains("is-editable")) { e.preventDefault(); fire(); } });
      linkEls.set(x.link, { ...x, g, line, label, title, x1, y1, x2, y2, len: Math.hypot(x2 - x1, y2 - y1) });
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
    built = { key, svg, links: linkEls, pos, gPaths, gDots, nodes, dense: links.length > 16 };
    return built;
  }

  /**
   * opts: { net, baseNet, demands, selected, result (null hides the numbers), editable,
   *         selectedLink, motion (dots on), canSwitch (several demands to show) }
   */
  function update({ net, baseNet, demands, selected, result, editable, selectedLink, motion, canSwitch }) {
    const b = build(net, baseNet, demands);
    const d = demands[selected] ?? null;
    const onDemand = (x) => d && ((x.dir === "up" && x.from === d.src) || (x.dir === "down" && x.to === d.dst));
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
      const showLabel = !b.dense || onDemand(x) || selectedLink === x.phys;
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
    // the selected demand's paths, with their shares
    b.gPaths.replaceChildren();
    if (d && b.pos.L[d.src] && b.pos.R[d.dst]) {
      const rates = result?.perDemand[selected]?.rates ?? {};
      const total = Object.values(rates).reduce((a, x) => a + x, 0);
      const ok = net.spines.filter((s) => (net.cap[`${d.src}>${s}`] ?? 0) > 0 && (net.cap[`${s}>${d.dst}`] ?? 0) > 0);
      for (const s of ok) {
        const [sx, sy] = b.pos.L[d.src];
        const [mx, my] = b.pos.S[s];
        const [dx, dy] = b.pos.R[d.dst];
        el("polyline", { points: `${sx + 19},${sy} ${mx},${my} ${dx - 19},${dy}`, class: "fabric-path" }, b.gPaths);
        if (result) {
          const share = total > 0 ? Math.round(((rates[s] ?? 0) / total) * 100) : 0;
          el("text", { x: mx, y: my - 25, class: "fabric-share", "text-anchor": "middle" }, b.gPaths).textContent = `${fmt(rates[s] ?? 0)}G · ${share}%`;
        }
      }
    }
    // moving dots: speed follows the throughput on the link
    b.gDots.replaceChildren();
    if (result && motion) {
      for (const x of b.links.values()) {
        const load = result.linkLoad[x.link] ?? 0;
        if (!(load > 0.5)) continue;
        const dur = Math.min(8, Math.max(0.6, x.len / (2.2 * load)));
        for (const phase of [0, 0.5]) {
          const c = el("circle", { r: 2.6, class: "fabric-flow" }, b.gDots);
          el("animateMotion", { dur: `${dur.toFixed(2)}s`, repeatCount: "indefinite", begin: `-${(dur * phase).toFixed(2)}s`, path: `M${x.x1},${x.y1} L${x.x2},${x.y2}` }, c);
        }
      }
    }
  }

  return { update };
}
