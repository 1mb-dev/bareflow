// The theme: the system's by default; the reader's choice (one localStorage key) overrides it.
// A classic script loaded in <head> before the stylesheet, so the first paint is already in the
// chosen theme. The footer's button cycles auto, light, dark.
(() => {
  const KEY = "bareflow.theme", ORDER = ["auto", "light", "dark"];
  let theme = "auto";
  try { const v = localStorage.getItem(KEY); if (ORDER.includes(v)) theme = v; } catch { /* no storage: auto */ }
  const apply = () => {
    if (theme === "auto") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
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
