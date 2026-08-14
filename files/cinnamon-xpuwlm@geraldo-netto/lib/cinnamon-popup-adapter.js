"use strict";

const Placement = require("./popup-placement.js");

function workspaceWorkArea(cinnamonGlobal, monitor) {
    if (!Number.isInteger(monitor.index)) {
        return null;
    }
    try {
        const workspace = cinnamonGlobal.workspace_manager.get_active_workspace();
        return workspace.get_work_area_for_monitor(monitor.index);
    } catch {
        // Muffin can reject a stale monitor index during hotplug. Preserve
        // Cinnamon's native placement until workspace geometry is available.
        return null;
    }
}

function monitorWorkArea(Main, cinnamonGlobal, sourceActor) {
    try {
        const monitor = Main.layoutManager.findMonitorForActor(sourceActor);
        return workspaceWorkArea(cinnamonGlobal, monitor);
    } catch {
        return null;
    }
}

function createCenteredPopupMenuClass({BaseMenu, Main, cinnamonGlobal = global}) {
    if (typeof BaseMenu !== "function") {
        throw new TypeError("A Cinnamon popup menu class is required");
    }
    return class CenteredAppletPopupMenu extends BaseMenu {
        _calculatePosition() {
            const fallback = super._calculatePosition();
            try {
                const workArea = monitorWorkArea(Main, cinnamonGlobal, this.sourceActor);
                const preferred = this.actor.get_preferred_size();
                const centered = Placement.centeredPopupPosition(
                    workArea,
                    preferred[2],
                    preferred[3],
                );
                return centered || fallback;
            } catch {
                return fallback;
            }
        }
    };
}

function createCenteredPopupMenuFactory({Applet, Main, cinnamonGlobal = global}) {
    if (!Applet || typeof Applet.AppletPopupMenu !== "function") {
        throw new TypeError("The Cinnamon applet popup API is required");
    }
    const CenteredMenu = createCenteredPopupMenuClass({
        BaseMenu: Applet.AppletPopupMenu,
        Main,
        cinnamonGlobal,
    });
    return (launcher, orientation) => new CenteredMenu(launcher, orientation);
}

module.exports = {
    createCenteredPopupMenuClass,
    createCenteredPopupMenuFactory,
    monitorWorkArea,
    workspaceWorkArea,
};
