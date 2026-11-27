// Homework page entry. Sections mark themselves finished with `progress.setDone(id)`.

import { initTheme } from "../shared/theme.js";
import { createProgress, trackTime } from "../shared/progress.js";
import { scrollSpy } from "../shared/ui.js";
import { initTutor } from "./js/tutor/view.js";
import { initRead, initWatch } from "./js/sections/view.js";

export const SECTIONS = ["read", "watch", "tutor", "lab", "questions"];

export const progress = createProgress({ ids: SECTIONS, storeKey: "hw:done" });

/**
 * Wide mode while a wide section is in view (≥1280px): it crosses the middle of the screen.
 * The progress column folds into a strip; its toggle (and hover/focus) expands it over the page.
 */
function wideWhileInView(section) {
  const app = document.querySelector(".app");
  const side = document.querySelector(".side");
  const toggle = document.querySelector(".side-toggle");
  if (!app || !section || !("IntersectionObserver" in window)) return;
  const desktop = matchMedia("(min-width: 1280px)");
  let inView = false;
  // Switching changes the width of everything above, so their height too: switch at once and
  // scroll by the difference, so the section stays exactly where it was on the screen.
  const apply = () => {
    const on = inView && desktop.matches;
    if (app.classList.contains("is-wide") === on) return;
    const before = section.getBoundingClientRect().top;
    const root = document.documentElement;
    root.style.overflowAnchor = "none"; // we correct the scroll ourselves
    app.classList.toggle("is-wide", on);
    const shift = section.getBoundingClientRect().top - before;
    if (shift) scrollBy({ top: shift, behavior: "instant" }); // not smooth: the page sets scroll-behavior: smooth
    requestAnimationFrame(() => { root.style.overflowAnchor = ""; });
  };
  new IntersectionObserver(([e]) => { inView = e.isIntersecting; apply(); }, { rootMargin: "-45% 0px -45% 0px" }).observe(section);
  desktop.addEventListener("change", apply);
  toggle?.addEventListener("click", () => {
    const open = !side.classList.contains("is-open");
    side.classList.toggle("is-open", open);
    toggle.setAttribute("aria-expanded", String(open));
    toggle.textContent = open ? "›" : "‹";
  });
}

export function initPage() {
  initTheme(document.querySelector(".theme-toggle"));
  progress.start();
  trackTime({ storeKey: "hw:time" });
  const links = new Map([...document.querySelectorAll(".rail-btn[data-section]")].map((a) => [a.dataset.section, a]));
  scrollSpy(links);
  initRead({ section: document.getElementById("read"), progress });
  initWatch({ section: document.getElementById("watch"), progress });
  initTutor({ root: document.querySelector("[data-tutor]"), badge: document.querySelector("[data-tutor-badge]"), progress });
  wideWhileInView(document.getElementById("tutor"));
}
