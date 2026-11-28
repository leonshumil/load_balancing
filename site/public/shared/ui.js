// Shared component helpers (DOM only when called; importing does nothing).
// Styles are in ui.css; shared/ui-demo.html shows each one.

const SVG = "http://www.w3.org/2000/svg";

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

/**
 * Pill chip row. items: [{ id, label, sub? }]. Exactly one chip is selected
 * (aria-pressed="true", lavender). Arrow keys move the selection.
 * Returns { select(id), get selected() }.
 */
export function chipRow(container, items, { selected = items[0]?.id, onSelect, label } = {}) {
  container.classList.add("chips");
  container.setAttribute("role", "group");
  if (label) container.setAttribute("aria-label", label);
  container.replaceChildren();
  const buttons = items.map((item) => {
    const b = el("button", "chip");
    b.type = "button";
    b.dataset.id = item.id;
    b.append(el("span", "chip-main", item.label));
    if (item.sub) b.append(el("span", "chip-sub", item.sub));
    b.addEventListener("click", () => select(item.id, true));
    b.addEventListener("keydown", (e) => {
      const i = buttons.indexOf(b);
      const j = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : null;
      if (j == null || j < 0 || j >= buttons.length) return;
      e.preventDefault();
      buttons[j].focus();
      select(items[j].id, true);
    });
    container.append(b);
    return b;
  });
  let current = null;
  function select(id, fromUser = false) {
    current = id;
    for (const b of buttons) b.setAttribute("aria-pressed", String(b.dataset.id === id));
    if (fromUser) onSelect?.(id);
  }
  select(selected);
  return { select, get selected() { return current; } };
}

/** Small pill. kind: "gold" | "violet" | "" */
export function badge(text, kind = "gold") {
  return el("span", `badge${kind ? ` badge-${kind}` : ""}`, text);
}

/** Answer feedback: green tick or red cross plus a message. */
export function checkResult(container, ok, message) {
  container.className = `check-result ${ok ? "is-ok" : "is-bad"}`;
  container.setAttribute("role", "status");
  container.textContent = message;
}

/** Dot grid: counts { violet, gold, ring, empty } -> that many dots, in that order. */
export function dotGrid(container, { violet = 0, gold = 0, ring = 0, empty = 0 } = {}, label) {
  container.classList.add("dot-grid");
  container.setAttribute("role", "img");
  if (label) container.setAttribute("aria-label", label);
  container.replaceChildren(
    ...Array.from({ length: violet }, () => el("span", "dot")),
    ...Array.from({ length: gold }, () => el("span", "dot dot-gold")),
    ...Array.from({ length: ring }, () => el("span", "dot dot-ring")),
    ...Array.from({ length: empty }, () => el("span", "dot dot-empty")),
  );
}

/**
 * Area chart: `series` gets the violet fill, `compare` (optional) the dashed gold line.
 * Values are numbers; x is evenly spaced. Returns the <svg>.
 */
export function areaChart(container, { series, compare, max, height = 180, width = 640, label, yTicks = [] }) {
  const top = Math.max(max ?? 0, ...series, ...(compare ?? []));
  const pad = { l: 30, r: 6, t: 8, b: 8 };
  const W = width - pad.l - pad.r;
  const H = height - pad.t - pad.b;
  const x = (i, n) => pad.l + (n <= 1 ? 0 : (i / (n - 1)) * W);
  const y = (v) => pad.t + H - (top ? (v / top) * H : 0);
  const path = (vals) => vals.map((v, i) => `${i ? "L" : "M"}${x(i, vals.length).toFixed(1)},${y(v).toFixed(1)}`).join("");

  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("class", "area-chart");
  svg.setAttribute("role", "img");
  if (label) svg.setAttribute("aria-label", label);
  const add = (tag, attrs) => {
    const n = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    svg.append(n);
    return n;
  };
  for (const t of yTicks) {
    add("line", { class: "grid", x1: pad.l, x2: width - pad.r, y1: y(t), y2: y(t) });
    add("text", { x: 0, y: y(t) + 4 }).textContent = String(t);
  }
  const line = path(series);
  add("path", { class: "area", d: `${line}L${x(series.length - 1, series.length)},${y(0)}L${x(0, series.length)},${y(0)}Z` });
  add("path", { class: "line", d: line });
  if (compare) add("path", { class: "compare", d: path(compare) });
  container.replaceChildren(svg);
  return svg;
}

/** Gradient summary card (final score). */
export function summaryCard(container, { value, caption }) {
  container.className = "summary-card";
  container.replaceChildren(el("div", "value", value), el("div", "caption", caption));
}

/**
 * Which section is current: the last one whose top has passed `line` (px from the viewport top).
 * Scrolled to the very bottom, the last section is current (it can never reach the line), unless a
 * section named in the URL hash is on screen (a click on a short section's rail icon). Pure.
 */
export function currentSection({ ids, tops, line, atBottom, hash, inView }) {
  let id = ids[0] ?? null;
  ids.forEach((x, i) => { if (tops[i] <= line) id = x; });
  if (atBottom) id = ids.includes(hash) && inView(hash) ? hash : ids.at(-1);
  return id;
}

/**
 * Scroll spy: marks the link of the section being read with aria-current="true" (see currentSection).
 * links: Map(sectionId -> element).
 */
export function scrollSpy(links, { line = 140 } = {}) {
  const sections = [...links.keys()].map((id) => document.getElementById(id)).filter(Boolean);
  const ids = sections.map((s) => s.id);
  let current = null;
  let queued = false;
  const update = () => {
    queued = false;
    const id = currentSection({
      ids,
      tops: sections.map((s) => s.getBoundingClientRect().top),
      line: Math.min(line, innerHeight * 0.35),
      atBottom: innerHeight + scrollY >= document.documentElement.scrollHeight - 2,
      hash: decodeURIComponent(location.hash.slice(1)),
      inView: (x) => { const r = document.getElementById(x)?.getBoundingClientRect(); return !!r && r.bottom > 0 && r.top < innerHeight; },
    });
    if (id === current) return;
    current = id;
    for (const [key, a] of links) {
      if (key === id) a.setAttribute("aria-current", "true");
      else a.removeAttribute("aria-current");
    }
  };
  const onScroll = () => { if (!queued) { queued = true; requestAnimationFrame(update); } };
  addEventListener("scroll", onScroll, { passive: true });
  addEventListener("resize", onScroll);
  addEventListener("hashchange", onScroll);
  update();
}
