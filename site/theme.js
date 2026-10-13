// The theme: the system's by default; the reader's choice (one localStorage key) overrides it.
// A classic script loaded in <head> before the stylesheet, so the first paint is already in the
// chosen theme. The footer's button cycles auto, light, dark. The theme-color metas (light, then
// dark, both before this script) follow the system; a chosen theme sets both to its paper.
(() => {
  const KEY = "bareflow.theme", ORDER = ["auto", "light", "dark"];
  const metas = [...document.querySelectorAll('meta[name="theme-color"]')], paper = metas.map((m) => m.content);
  let theme = "auto";
  try { const v = localStorage.getItem(KEY); if (ORDER.includes(v)) theme = v; } catch { /* no storage: auto */ }
  const apply = () => {
    if (theme === "auto") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    metas.forEach((m, i) => { m.content = paper[theme === "auto" ? i : ORDER.indexOf(theme) - 1]; });
    const button = document.getElementById("theme");
    if (button) button.textContent = `theme: ${theme}`;
  };
  apply();
  document.addEventListener("DOMContentLoaded", () => {
    apply();
    document.getElementById("theme").onclick = () => {
      theme = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length];
      try { localStorage.setItem(KEY, theme); } catch { /* the choice lasts this page */ }
      apply();
    };
  });
})();
