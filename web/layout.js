const STORAGE_KEY = "practice-lab:workspace-layout";
let saved = {};
try {
  const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
  if (stored && typeof stored === "object" && !Array.isArray(stored)) saved = stored;
} catch {
  // The controls also work without local storage.
}

function saveLayout(key, value) {
  saved[key] = value;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  } catch {
    // Keep the active layout when browser storage is unavailable.
  }
}

function setupPane(key, containerId, byWidth) {
  const container = document.getElementById(containerId);
  const panel = document.getElementById(key + "-panel");
  const divider = document.getElementById(key + "-splitter");
  const show = document.getElementById("show-" + key);
  const hide = document.getElementById("hide-" + key);
  const previous = saved[key];
  let fraction = Number.isFinite(previous?.fraction) && previous.fraction > 0 && previous.fraction < 1
    ? previous.fraction : null;
  let collapsed = previous?.collapsed === true;
  let drag = null;

  function dimensions() {
    const style = getComputedStyle(container);
    const padding = byWidth
      ? parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)
      : parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    const total = (byWidth ? container.clientWidth : container.clientHeight) - padding;
    const min = parseFloat(style.getPropertyValue("--pane-min"));
    const max = Math.max(min, total - parseFloat(style.getPropertyValue("--other-min")) -
      parseFloat(style.getPropertyValue("--divider-size")));
    return { total, min, max };
  }

  function panelSize() {
    const bounds = (collapsed ? show : panel).getBoundingClientRect();
    return byWidth ? bounds.width : bounds.height;
  }

  function updateSeparator() {
    const { total, max } = dimensions();
    if (total <= 0) return;
    const pixels = Math.round(panelSize());
    divider.setAttribute("aria-valuemax", String(Math.round(100 * max / total)));
    divider.setAttribute("aria-valuenow", String(collapsed ? 0 : Math.round(100 * pixels / total)));
    divider.setAttribute("aria-valuetext", collapsed ? "Collapsed" : pixels + " pixels");
  }

  function render() {
    if (fraction !== null) container.style.setProperty("--pane-size", (fraction * 100) + "%");
    container.dataset.paneCollapsed = String(collapsed);
    panel.hidden = collapsed;
    show.hidden = !collapsed;
    updateSeparator();
  }

  function persist() {
    saveLayout(key, { collapsed, fraction });
  }

  function setCollapsed(value) {
    if (collapsed === value) return;
    collapsed = value;
    render();
    persist();
  }

  function resize(pixels) {
    const { total, min, max } = dimensions();
    collapsed = pixels < min;
    if (!collapsed && total > 0) fraction = Math.min(pixels, max) / total;
    render();
  }

  const pointerPosition = (event) => byWidth ? event.clientX : -event.clientY;

  divider.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || drag) return;
    event.preventDefault();
    divider.focus({ preventScroll: true });
    drag = { id: event.pointerId, start: pointerPosition(event), size: panelSize(), fraction, collapsed };
    divider.setPointerCapture(event.pointerId);
    divider.classList.add("is-dragging");
  });

  function resizeFromPointer(event) {
    if (drag?.id === event.pointerId) resize(drag.size + pointerPosition(event) - drag.start);
  }

  function endDrag(event, cancelled) {
    if (drag?.id !== event.pointerId) return;
    if (!cancelled) resizeFromPointer(event);
    if (cancelled) collapsed = drag.collapsed;
    if (cancelled || collapsed) fraction = drag.fraction;
    if (fraction === null) container.style.removeProperty("--pane-size");
    drag = null;
    divider.classList.remove("is-dragging");
    render();
    if (!cancelled) persist();
  }

  divider.addEventListener("pointermove", resizeFromPointer);
  divider.addEventListener("pointerup", (event) => endDrag(event, false));
  divider.addEventListener("pointercancel", (event) => endDrag(event, true));
  divider.addEventListener("lostpointercapture", (event) => endDrag(event, true));

  divider.addEventListener("keydown", (event) => {
    if (drag) return;
    const grow = byWidth ? "ArrowRight" : "ArrowUp";
    const shrink = byWidth ? "ArrowLeft" : "ArrowDown";
    const { max } = dimensions();
    if (event.key === "Enter" || event.key === " ") setCollapsed(!collapsed);
    else if (event.key === "Home") setCollapsed(true);
    else if (event.key === grow && collapsed) setCollapsed(false);
    else if (event.key === "End" || (!collapsed && [grow, shrink].includes(event.key))) {
      resize(event.key === "End" ? max : panelSize() + (event.key === grow ? 24 : -24));
      persist();
    } else return;
    event.preventDefault();
  });

  show.addEventListener("click", () => {
    setCollapsed(false);
    hide.focus({ preventScroll: true });
  });
  hide.addEventListener("click", () => {
    setCollapsed(true);
    show.focus({ preventScroll: true });
  });

  divider.setAttribute("aria-valuemin", "0");
  render();
  new ResizeObserver(updateSeparator).observe(container);
  return () => setCollapsed(false);
}

setupPane("statement", "workspace", true);
export const revealTests = setupPane("tests", "workbench", false);
