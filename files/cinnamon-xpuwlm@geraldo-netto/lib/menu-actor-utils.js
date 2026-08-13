"use strict";

function setStyleClass(actor, className, enabled) {
    if (enabled) {
        actor.add_style_class_name(className);
    } else {
        actor.remove_style_class_name(className);
    }
}

function destroyChildren(actor) {
    for (const child of actor.get_children()) {
        child.destroy();
    }
}

function box(St, styleClass, vertical = false, expand = false) {
    return new St.BoxLayout({vertical, style_class: styleClass, x_expand: expand});
}

function setWrap(actor, wrap, layout) {
    if (!actor || !actor.clutter_text) {
        return false;
    }
    const wrapping = wrap === true && layout.wrapText;
    actor.clutter_text.line_wrap = wrapping;
    actor.clutter_text.ellipsize = wrapping ? 0 : 3;
    return wrapping;
}

function label(St, Clutter, layout, text, styleClass, wrap = false) {
    const actor = new St.Label({
        text: String(text || ""),
        style_class: styleClass,
        y_align: Clutter.ActorAlign.CENTER,
    });
    setWrap(actor, wrap, layout);
    return actor;
}

function identify(actor, identity) {
    actor.xpuwlmIdentity = identity;
    return actor;
}

function entry(St, text, accessibleName, identity) {
    const actor = new St.Entry({
        text: String(text || ""),
        style_class: "xpuwlm-event-entry",
        can_focus: true,
    });
    actor.set_accessible_name(accessibleName);
    return identify(actor, identity);
}

function setAccessibleRole(Atk, actor, role) {
    const value = Atk && Atk.Role ? Atk.Role[role] : undefined;
    if (value === undefined || typeof actor.set_accessible_role !== "function") {
        return false;
    }
    actor.set_accessible_role(value);
    return true;
}

function setAccessibleState(Atk, actor, state, enabled) {
    const value = Atk && Atk.StateType ? Atk.StateType[state] : undefined;
    if (value === undefined) {
        return false;
    }
    const method = enabled ? "add_accessible_state" : "remove_accessible_state";
    if (typeof actor[method] !== "function") {
        return false;
    }
    actor[method](value);
    return true;
}

function setButtonEnabled(Atk, button, enabled) {
    button.reactive = enabled;
    button.can_focus = enabled;
    setStyleClass(button, "xpuwlm-button-disabled", !enabled);
    setAccessibleState(Atk, button, "SENSITIVE", enabled);
}

function tooltip(factory, actor, text) {
    return factory === null || !text ? null : factory(actor, text);
}

module.exports = {
    box,
    destroyChildren,
    entry,
    identify,
    label,
    setAccessibleRole,
    setAccessibleState,
    setButtonEnabled,
    setStyleClass,
    setWrap,
    tooltip,
};
