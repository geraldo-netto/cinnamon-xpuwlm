"use strict";

const TAB_KEY_MOVES = Object.freeze({
    KEY_Left: "previous",
    KEY_Up: "previous",
    KEY_Right: "next",
    KEY_Down: "next",
    KEY_Home: "first",
    KEY_End: "last",
});

function tabKeyMove(Clutter, keySymbol) {
    if (!Clutter) {
        return null;
    }
    for (const [name, move] of Object.entries(TAB_KEY_MOVES)) {
        if (Clutter[name] !== undefined && Clutter[name] === keySymbol) {
            return move;
        }
    }
    return null;
}

function movedTabIndex(move, currentIndex, count) {
    if (count <= 0) {
        return -1;
    }
    const current = currentIndex >= 0 && currentIndex < count ? currentIndex : 0;
    if (move === "first") {
        return 0;
    }
    if (move === "last") {
        return count - 1;
    }
    if (move === "previous") {
        return (current - 1 + count) % count;
    }
    if (move === "next") {
        return (current + 1) % count;
    }
    return current;
}

function isNavigable(actor) {
    return actor !== null && actor !== undefined && actor.reactive !== false;
}

function endpointIndex(move, enabled) {
    if (move === "first") {
        return enabled.indexOf(true);
    }
    return move === "last" ? enabled.lastIndexOf(true) : null;
}

function directionalIndex(move, current, enabled) {
    const step = move === "previous" ? -1 : 1;
    for (let offset = 1; offset <= enabled.length; offset += 1) {
        const candidate = (current + (step * offset) + enabled.length) % enabled.length;
        if (enabled[candidate]) {
            return candidate;
        }
    }
    return -1;
}

function navigableFlags(actors) {
    if (!Array.isArray(actors) || actors.length === 0) {
        return null;
    }
    const enabled = actors.map(isNavigable);
    return enabled.some(Boolean) ? enabled : null;
}

function normalizedIndex(currentIndex, count) {
    return currentIndex >= 0 && currentIndex < count ? currentIndex : 0;
}

// Roving tab focus must skip insensitive controls without losing the cyclic
// arrow-key behaviour. `can_focus` is intentionally not consulted: roving
// focus makes every unselected, enabled tab temporarily unreachable by Tab.
function movedFocusableIndex(move, currentIndex, actors) {
    const enabled = navigableFlags(actors);
    if (enabled === null) {
        return -1;
    }
    const endpoint = endpointIndex(move, enabled);
    if (endpoint !== null) {
        return endpoint;
    }
    const current = normalizedIndex(currentIndex, enabled.length);
    if (move !== "previous" && move !== "next") {
        return enabled[current] ? current : enabled.indexOf(true);
    }
    return directionalIndex(move, current, enabled);
}

// Body controls carry a semantic identity that survives a rebuild, so keyboard
// focus can return to the same control rather than to whatever landed first.
function focusableControls(actor, found = []) {
    for (const child of actor.get_children()) {
        if (child.xpuwlmIdentity !== undefined && child.can_focus !== false) {
            found.push(child);
        }
        focusableControls(child, found);
    }
    return found;
}

function grabFocus(actor) {
    if (actor === null || actor === undefined || actor.reactive === false) {
        return false;
    }
    actor.can_focus = true;
    if (typeof actor.grab_key_focus === "function") {
        actor.grab_key_focus();
    }
    return true;
}

function focusRoving(entries, selected) {
    const target = entries.get(selected);
    if (!grabFocus(target)) {
        return false;
    }
    for (const [name, actor] of entries) {
        if (name !== selected) {
            actor.can_focus = false;
        }
    }
    return true;
}

module.exports = {
    TAB_KEY_MOVES,
    focusRoving,
    focusableControls,
    grabFocus,
    movedFocusableIndex,
    movedTabIndex,
    tabKeyMove,
};
