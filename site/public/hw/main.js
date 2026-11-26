// Homework page entry. Later steps mark a section finished with
// `progress.setDone("path")`.

import { initTheme } from "../shared/theme.js";
import { initSidenotes } from "../shared/sidenotes.js";
import { createProgress } from "../shared/progress.js";

export const SECTIONS = ["read", "watch", "path", "chat", "lab"];

export const progress = createProgress({ ids: SECTIONS, storeKey: "hw:done" });

export function initPage() {
  initTheme(document.querySelector(".theme-toggle"));
  initSidenotes();
  progress.start();
}
