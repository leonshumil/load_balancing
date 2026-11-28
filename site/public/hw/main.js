// Homework page entry. Sections mark themselves finished with `progress.setDone(id)`.

import { initTheme } from "../shared/theme.js";
import { createProgress, trackTime } from "../shared/progress.js";
import { scrollSpy } from "../shared/ui.js";
import { initTutor } from "./js/tutor/view.js";
import { initRead, initWatch } from "./js/sections/view.js";
import { initLab } from "./js/lab/view.js";
import { initSubmit } from "./js/submit/view.js";

export const SECTIONS = ["read", "watch", "tutor", "lab", "questions"];

export const progress = createProgress({ ids: SECTIONS, storeKey: "hw:done" });

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
  initSubmit({ root: document.querySelector("[data-submit]") });
}
