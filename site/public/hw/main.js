// Homework page entry. Sections mark themselves finished with `progress.setDone(id)`.

import { initTheme } from "../shared/theme.js";
import { createProgress, trackTime } from "../shared/progress.js";
import { scrollSpy } from "../shared/ui.js";
import { initTutor } from "./js/tutor/view.js";
import { initRead, initWatch } from "./js/sections/view.js";
import { initLab } from "./js/lab/view.js";

export const SECTIONS = ["read", "watch", "tutor", "lab", "questions"];

export const progress = createProgress({ ids: SECTIONS, storeKey: "hw:done" });

/** The folded progress strip: its toggle opens the full panel over the page (hover/focus do too). */
function initSideToggle() {
  const side = document.querySelector(".side");
  const toggle = document.querySelector(".side-toggle");
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
  initLab({ root: document.querySelector("[data-lab]"), progress });
  initSideToggle();
}
