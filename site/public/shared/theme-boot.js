// Classic (non-module) script, loaded in <head> before the CSS so the right theme
// is set before first paint. Same rule as theme.js: saved choice, else system.
(function () {
  var t = null;
  try { t = JSON.parse(localStorage.getItem("conga:theme")); } catch (e) {}
  if (t !== "light" && t !== "dark") {
    try { t = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"; } catch (e) { t = "light"; }
  }
  document.documentElement.setAttribute("data-theme", t);
})();
