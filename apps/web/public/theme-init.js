// Applies the saved theme before first paint to avoid a light/dark flash. Kept as a file (not
// inline) so the API's Content-Security-Policy can stay at script-src 'self'.
(function () {
  try {
    var p = localStorage.getItem("mdm.theme") || "system";
    var dark = p === "dark" || (p === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  } catch (e) {}
})();
