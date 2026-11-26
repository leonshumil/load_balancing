// Progress: finished sections (stored under `storeKey`) and the thin reading line.
// Anything marked [data-progress-for="<id>"] gets .is-done when that section is
// finished (rail icon, contents chip, progress-panel row); [data-done-for="<id>"]
// elements are shown/hidden; [data-progress-count] shows "done/total".
// DOM is only touched in start()/render(), so importing this does nothing.

import { get, set } from "./store.js";

export function createProgress({ ids, storeKey, selector = ".progress" }) {
  let bar = null;

  const doneSet = () => {
    const v = get(storeKey, []);
    return new Set(Array.isArray(v) ? v : []);
  };

  function render() {
    const s = doneSet();
    for (const id of ids) {
      const isDone = s.has(id);
      document.querySelectorAll(`[data-done-for="${id}"]`).forEach((e) => e.toggleAttribute("hidden", !isDone));
      document.querySelectorAll(`[data-progress-for="${id}"]`).forEach((e) => e.classList.toggle("is-done", isDone));
      bar?.querySelector(`.progress-tick[data-for="${id}"]`)?.classList.toggle("is-done", isDone);
    }
    const n = ids.filter((id) => s.has(id)).length;
    document.querySelectorAll("[data-progress-count]").forEach((e) => { e.textContent = `${n}/${ids.length}`; });
  }

  function setDone(id, done = true) {
    const s = doneSet();
    if (done) s.add(id); else s.delete(id);
    set(storeKey, [...s]);
    render();
  }

  function start() {
    bar = document.querySelector(selector);
    const fill = bar?.querySelector(".progress-fill");
    render();
    if (!bar || !fill) return;
    const ticks = ids.map((id) => {
      const t = document.createElement("span");
      t.className = "progress-tick";
      t.dataset.for = id;
      bar.append(t);
      return t;
    });
    const scrollable = () => Math.max(1, document.documentElement.scrollHeight - innerHeight);
    const placeTicks = () => {
      const max = scrollable();
      ids.forEach((id, i) => {
        const el = document.getElementById(id);
        const y = el ? el.getBoundingClientRect().top + scrollY : 0;
        ticks[i].style.left = `${Math.min(100, (y / max) * 100)}%`;
      });
    };
    let queued = false;
    const update = () => {
      queued = false;
      fill.style.transform = `scaleX(${Math.min(1, scrollY / scrollable())})`;
    };
    const onScroll = () => { if (!queued) { queued = true; requestAnimationFrame(update); } };
    addEventListener("scroll", onScroll, { passive: true });
    addEventListener("resize", () => { placeTicks(); onScroll(); });
    if ("ResizeObserver" in window) new ResizeObserver(() => { placeTicks(); onScroll(); }).observe(document.body);
    placeTicks();
    update();
    render();
  }

  return { start, setDone, render };
}

/**
 * Time spent on the page while it is visible, stored in seconds under `storeKey`.
 * [data-time-spent] elements show whole minutes.
 */
export function trackTime({ storeKey, every = 15 }) {
  const show = () => {
    const secs = Number(get(storeKey, 0)) || 0;
    document.querySelectorAll("[data-time-spent]").forEach((e) => { e.textContent = `${Math.floor(secs / 60)} min`; });
  };
  show();
  setInterval(() => {
    if (document.visibilityState !== "visible") return;
    set(storeKey, (Number(get(storeKey, 0)) || 0) + every);
    show();
  }, every * 1000);
}
