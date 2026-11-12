(() => {
  const storageKey = "practice-lab:appearance";
  const modes = { auto: "Auto", light: "Light", dark: "Dark", night: "Night" };
  const palettes = { violet: "Violet", ocean: "Ocean", forest: "Forest" };
  const system = window.matchMedia("(prefers-color-scheme: dark)");
  const root = document.documentElement;
  let modeControl;
  let paletteControl;

  function readPreferences(raw) {
    try {
      const stored = JSON.parse(raw ?? localStorage.getItem(storageKey));
      return {
        mode: Object.hasOwn(modes, stored?.mode) ? stored.mode : "auto",
        palette: Object.hasOwn(palettes, stored?.palette) ? stored.palette : "violet",
      };
    } catch {
      return { mode: "auto", palette: "violet" };
    }
  }

  let preferences = readPreferences();

  function apply() {
    const { mode, palette } = preferences;
    root.dataset.theme = mode === "auto" ? (system.matches ? "dark" : "light") : mode;
    root.dataset.palette = palette;
    if (modeControl) modeControl.value = mode;
    if (paletteControl) paletteControl.value = palette;
    document.dispatchEvent(new Event("practice-appearance-change"));
  }

  function save(field, value) {
    preferences[field] = value;
    try {
      localStorage.setItem(storageKey, JSON.stringify(preferences));
    } catch {
      // Apply the choice for this page even when storage is unavailable.
    }
    apply();
  }

  function addControl(parent, label, field, choices) {
    const wrapper = document.createElement("label");
    wrapper.append(label);
    const select = document.createElement("select");
    for (const [value, text] of Object.entries(choices)) {
      select.add(new Option(text, value));
    }
    select.value = preferences[field];
    select.addEventListener("change", () => save(field, select.value));
    wrapper.append(select);
    parent.append(wrapper);
    return select;
  }

  apply();
  system.addEventListener("change", () => {
    if (preferences.mode === "auto") apply();
  });
  window.addEventListener("storage", (event) => {
    if (event.key === storageKey || event.key === null) {
      preferences = readPreferences(event.newValue);
      apply();
    }
  });

  document.addEventListener("DOMContentLoaded", () => {
    const host = document.getElementById("appearance");
    const menu = document.createElement("details");
    const toggle = document.createElement("summary");
    toggle.textContent = "Appearance";
    const options = document.createElement("div");
    options.className = "appearance-options";
    modeControl = addControl(options, "Mode", "mode", modes);
    paletteControl = addControl(options, "Color scheme", "palette", palettes);
    menu.append(toggle, options);
    host.append(menu);

    document.addEventListener("pointerdown", (event) => {
      if (menu.open && !menu.contains(event.target)) menu.open = false;
    });
    menu.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && menu.open) {
        event.preventDefault();
        menu.open = false;
        toggle.focus();
      }
    });
  });
})();
