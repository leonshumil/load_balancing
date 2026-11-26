// Theme: follows the system setting until the reader picks one, then remembers it.
// index.html runs a tiny inline copy of `resolve` in <head> so there is no flash.

import { get, set } from "./store.js";

const KEY = "theme"; // "light" | "dark" | absent = follow system

function systemTheme() {
  try {
    return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return "light";
  }
}

function resolve() {
  const saved = get(KEY);
  return saved === "light" || saved === "dark" ? saved : systemTheme();
}

function apply(theme, button) {
  document.documentElement.dataset.theme = theme;
  if (button) {
    const other = theme === "dark" ? "light" : "dark";
    button.textContent = other === "dark" ? "Dark" : "Light";
    button.setAttribute("aria-label", `Switch to ${other} theme`);
  }
}

export function initTheme(button) {
  apply(resolve(), button);

  button?.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    set(KEY, next);
    apply(next, button);
  });

  try {
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      if (get(KEY) == null) apply(systemTheme(), button);
    });
  } catch {
    /* old browsers: no live follow */
  }
}
