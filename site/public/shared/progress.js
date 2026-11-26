// Thin reading-progress line at the top of the page, with a tick per section that
// turns solid when the section is marked finished. Finished sections are stored
// under `storeKey`; contents links with [data-done-for="<id>"] show "done".

import { get, set } from "./store.js";

export function createProgress({ ids, storeKey, selector = ".progress" }) {
  // DOM is looked up lazily (in render/start), so importing this does nothing.
  let bar = null;

  const doneSet = () => {
    const v = get(storeKey, []);
    return new Set(Array.isArray(v) ? v : []);
  };

  function render() {
    const s = doneSet();
    for (const id of ids) {
      const isDone = s.has(id);
      document.querySelector(`[data-done-for="${id}"]`)?.toggleAttribute("hidden", !isDone);
      bar?.querySelector(`.progress-tick[data-for="${id}"]`)?.classList.toggle("is-done", isDone);
    }
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
