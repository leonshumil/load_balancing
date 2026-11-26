// Classic (non-module) script, loaded in <head> before the CSS so the right theme
// is set before first paint. Same rule as theme.js: the saved choice, else dark.
(function () {
  var t = null;
  try { t = JSON.parse(localStorage.getItem("conga:theme")); } catch (e) {}
  document.documentElement.setAttribute("data-theme", t === "light" ? "light" : "dark");
})();
