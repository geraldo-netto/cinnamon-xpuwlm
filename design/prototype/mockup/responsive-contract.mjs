const SCREEN_LABELS = Object.freeze({
  overview: "overview",
  profiles: "profiles",
  alerts: "active alert",
  paused: "all paused",
  unavailable: "device unavailable",
  clear: "alerts clear",
});

export const SCREEN_NAMES = Object.freeze(["overview", "profiles", "alerts", "paused", "unavailable", "clear"]);
export const LAYOUT_NAMES = Object.freeze(["wide", "narrow", "high-scale", "large-text"]);

export function supportedValue(candidate, supported, fallback) {
  return supported.includes(candidate) ? candidate : fallback;
}

export function resolvePrototypeState(search = "") {
  const parameters = new globalThis.URLSearchParams(typeof search === "string" ? search : "");
  const activeScreen = supportedValue(parameters.get("screen"), SCREEN_NAMES, "overview");
  const activeLayout = supportedValue(parameters.get("layout"), LAYOUT_NAMES, "wide");
  let tabScreen = activeScreen;
  if (activeScreen === "clear") {
    tabScreen = "alerts";
  } else if (activeScreen === "paused") {
    tabScreen = "overview";
  }
  return Object.freeze({
    activeLayout,
    activeScreen,
    screenLabel: SCREEN_LABELS[activeScreen],
    tabScreen,
  });
}
