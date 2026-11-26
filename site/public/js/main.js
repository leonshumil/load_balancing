// Page entry: theme, sidenote toggles, contents list, reading-progress line.
// Later steps mark a puzzle finished with `setPuzzleDone("tree", true)`.

import { get, set } from "./store.js";
import { initTheme } from "./theme.js";

const PUZZLES = ["tree", "place", "fig2", "questions"];
const DONE_KEY = "done";

/* ---------- finished puzzles ---------- */

function doneSet() {
  const v = get(DONE_KEY, []);
  return new Set(Array.isArray(v) ? v : []);
}

export function setPuzzleDone(id, done = true) {
  const s = doneSet();
  if (done) s.add(id); else s.delete(id);
  set(DONE_KEY, [...s]);
  renderDone();
}

function renderDone() {
  const s = doneSet();
  for (const id of PUZZLES) {
    const isDone = s.has(id);
    document.querySelector(`.contents [data-done-for="${id}"]`)?.toggleAttribute("hidden", !isDone);
    document.querySelector(`.progress-tick[data-for="${id}"]`)?.classList.toggle("is-done", isDone);
  }
}

/* ---------- reading-progress line ---------- */

function initProgress() {
  const bar = document.querySelector(".progress");
  const fill = bar?.querySelector(".progress-fill");
  if (!bar || !fill) return;

  const ticks = PUZZLES.map((id) => {
    const t = document.createElement("span");
    t.className = "progress-tick";
    t.dataset.for = id;
    bar.append(t);
    return t;
  });

  const scrollable = () => Math.max(1, document.documentElement.scrollHeight - innerHeight);

  function placeTicks() {
    const max = scrollable();
    PUZZLES.forEach((id, i) => {
      const el = document.getElementById(id);
      const y = el ? el.getBoundingClientRect().top + scrollY : 0;
      ticks[i].style.left = `${Math.min(100, (y / max) * 100)}%`;
    });
  }

  let queued = false;
  function update() {
    queued = false;
    fill.style.transform = `scaleX(${Math.min(1, scrollY / scrollable())})`;
  }
  const onScroll = () => { if (!queued) { queued = true; requestAnimationFrame(update); } };

  addEventListener("scroll", onScroll, { passive: true });
  addEventListener("resize", () => { placeTicks(); onScroll(); });
  if ("ResizeObserver" in window) new ResizeObserver(() => { placeTicks(); onScroll(); }).observe(document.body);
  placeTicks();
  update();
}

/* ---------- sidenotes: inline toggles under 900px ---------- */

function initSidenotes(root = document) {
  for (const note of root.querySelectorAll(".sidenote")) {
    const btn = note.querySelector(".sidenote-toggle");
    const body = note.querySelector(".sidenote-body");
    if (!btn || !body || btn.dataset.wired) continue;
    btn.dataset.wired = "1";
    body.id ||= `note-${Math.random().toString(36).slice(2, 8)}`;
    btn.setAttribute("aria-controls", body.id);
    btn.setAttribute("aria-expanded", "false");
    btn.addEventListener("click", () => {
      const open = note.classList.toggle("is-open");
      btn.setAttribute("aria-expanded", String(open));
    });
  }
}

/* ---------- boot ---------- */

export function initPage() {
  initTheme(document.querySelector(".theme-toggle"));
  initSidenotes();
  initProgress();
  renderDone();
}

export { initSidenotes };
