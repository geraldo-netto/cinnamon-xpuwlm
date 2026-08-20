"use strict";

// How big the panel's glyph is drawn, and where Cinnamon looks for it.
//
// Both are the icon's own subject and neither is the applet's lifecycle, so
// they live here rather than among the settings binding, the refresh timer and
// the teardown that surrounded them. What stayed with the applet is the part
// that genuinely belongs to it: the actor. This file decides the number and
// owns the search-path entry; the applet applies them to the widget it holds.

const DEFAULT_PANEL_ICON_SIZE = 32;
// Not 1: an icon Cinnamon sizes to its zone preference is drawn smaller than
// every systray neighbour, and the status shape is the entire message now that
// the panel carries no text.
const MIN_PANEL_ICON_SIZE = 28;

// Cinnamon's panel-zone preference still asks for 16 pixels on a 40-pixel
// panel, which draws this glyph noticeably smaller than the systray icons
// beside it. The floor is what keeps a compact status shape legible without
// touching the panel's own height, which is the user's setting, not ours.
//
// Which is also why the floor is bounded by that height: Cinnamon allows a
// panel down to 20 pixels, and an unconditional 28 would ask such a panel to
// draw an icon taller than the strip it sits in — through an inline
// `icon-size` style, the one declaration the theme cannot outrank. The floor
// raises a small icon; it never overflows a small panel.
function panelIconSize(requestedSize, panelHeight) {
    const requested = Number.isFinite(requestedSize) && requestedSize > 0
        ? Math.floor(requestedSize)
        : DEFAULT_PANEL_ICON_SIZE;
    const floor = Number.isFinite(panelHeight) && panelHeight > 0
        ? Math.min(MIN_PANEL_ICON_SIZE, Math.floor(panelHeight))
        : MIN_PANEL_ICON_SIZE;
    return Math.max(floor, requested);
}

// The payload's icon directory, in the session's icon theme and back out
// again.
//
// Without the entry the payload's icons are not in the icon theme, so Cinnamon
// cannot recolour them: the chip drew in the symbolic fallback grey, which on
// a dark panel is nearly the background, leaving only the small green status
// mark visible beside 32-pixel neighbours. Appended once, and only when
// absent, so a reload does not grow the search path.
//
// And taken back with the applet. `Gtk.IconTheme.get_default()` is the
// session's theme, not the applet's, so an appended search path outlives every
// applet that appended it and goes on naming a directory that leaves with the
// uninstall. Only the registration that added the entry removes it — which is
// the whole rule, because `metadata.json` declares one instance, and it is why
// the theme is remembered here rather than asked for again at release.
function createIconSearchPath(iconTheme, iconPath) {
    let owner = null;
    return {
        register() {
            if (!iconTheme || iconTheme.get_search_path().includes(iconPath)) {
                return false;
            }
            iconTheme.append_search_path(iconPath);
            owner = iconTheme;
            return true;
        },
        release() {
            const theme = owner;
            owner = null;
            if (!theme || typeof theme.set_search_path !== "function") {
                return false;
            }
            theme.set_search_path(
                theme.get_search_path().filter((entry) => entry !== iconPath),
            );
            return true;
        },
    };
}

module.exports = {
    DEFAULT_PANEL_ICON_SIZE,
    MIN_PANEL_ICON_SIZE,
    createIconSearchPath,
    panelIconSize,
};
