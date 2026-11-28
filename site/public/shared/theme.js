// Theme: dark by default; the reader's choice is remembered.
// theme-boot.js applies the same rule before first paint.
// An icon button (data-icon) keeps its icons; a text button shows "Dark"/"Light".

import { get, set } from "./store.js";

const KEY = "theme"; // "light" | "dark" | absent = dark

function resolve() {
  return get(KEY) === "light" ? "light" : "dark";
}

function apply(theme, button) {
  document.documentElement.dataset.theme = theme;
  if (!button) return;
  const other = theme === "dark" ? "light" : "dark";
  button.setAttribute("aria-label", `Switch to ${other} theme`);
  button.title = `Switch to ${other} theme`;
  if (!("icon" in button.dataset)) button.textContent = other === "dark" ? "Dark" : "Light";
}

export function initTheme(button) {
  apply(resolve(), button);
  button?.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    set(KEY, next);
    apply(next, button);
  });
}
