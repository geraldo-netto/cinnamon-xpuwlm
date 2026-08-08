"use strict";

const Layout = require("./layout.js");
const ViewModel = require("./view-model.js");

const METRIC_NAMES = Object.freeze(["TPU load", "Queue", "Running", "Attention"]);

function requireAction(actions, name) {
    if (!actions || typeof actions[name] !== "function") {
        throw new TypeError(`Menu action ${name} is required`);
    }
    return actions[name];
}

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

class MenuView {
    constructor({St, Clutter, Atk, menu, actions, layout}) {
        if (!St || !Clutter || !menu || typeof menu.addActor !== "function") {
            throw new TypeError("Cinnamon UI dependencies are required");
        }
        this._St = St;
        this._Clutter = Clutter;
        this._Atk = Atk;
        this._actions = {
            selectTab: requireAction(actions, "selectTab"),
            toggleProfile: requireAction(actions, "toggleProfile"),
            changeWeight: requireAction(actions, "changeWeight"),
            pauseAll: requireAction(actions, "pauseAll"),
            resumeAll: requireAction(actions, "resumeAll"),
            refresh: requireAction(actions, "refresh"),
            openSettings: requireAction(actions, "openSettings"),
        };
        this._policyPaused = false;
        this._bodyKey = null;
        this._model = null;
        this._layout = layout || Layout.defaultLayout();
        this._root = this._box("tpuwm-root", true);
        this._buildHeader();
        this._buildMetrics();
        this._buildTabs();
        this._buildBody();
        this._buildFooter();
        this._applyLayoutStyles();
        menu.addActor(this._root);
    }

    // Cinnamon stylesheets cannot react to the work area, so a resolved layout
    // is applied imperatively and forces a body rebuild when it changes.
    applyLayout(layout) {
        const next = layout || Layout.defaultLayout();
        if (Layout.sameLayout(this._layout, next)) {
            return false;
        }
        this._layout = next;
        this._applyLayoutStyles();
        this._layoutMetrics();
        this._bodyKey = null;
        if (this._model !== null) {
            this.render(this._model);
        }
        return true;
    }

    render(model) {
        this._model = model;
        this._policyPaused = model.policyPaused;
        this._statusLabel.set_text(model.device.status);
        this._subtitleLabel.set_text(model.headerSubtitle);
        this._pauseLabel.set_text(this._policyPaused ? "Resume all" : "Pause all");
        this._pauseButton.set_accessible_name(this._policyPaused
            ? "Resume all workloads"
            : "Pause all workloads");
        setStyleClass(this._statusLabel, "tpuwm-status-unavailable", !model.device.available);
        for (let index = 0; index < this._metricValues.length; index += 1) {
            const metric = model.metrics[index];
            const suffix = metric.suffix ? ` ${metric.suffix}` : "";
            this._metricValues[index].set_text(`${metric.value}${suffix}`);
            setStyleClass(this._metricValues[index], "tpuwm-attention", metric.tone === "attention");
        }
        this._tabs.actor.visible = model.showTabs;
        this._manageButton.visible = model.showTabs;
        for (const [tab, button] of this._tabButtons) {
            const selected = model.selectedTab === tab;
            setStyleClass(button, "tpuwm-tab-active", selected);
            button.set_accessible_name(`${tab} tab${selected ? ", selected" : ""}`);
            this._setAccessibleState(button, "SELECTED", selected);
        }
        if (this._bodyKey !== model.bodyKey) {
            this._bodyKey = model.bodyKey;
            this._renderBody(model);
        }
    }

    destroy() {
        if (this._root === null) {
            return false;
        }
        this._root.destroy();
        this._root = null;
        this._bodyKey = null;
        this._model = null;
        return true;
    }

    _applyLayoutStyles() {
        this._root.set_style(`min-width: ${this._layout.widthPx}px; max-width: ${this._layout.widthPx}px;`);
        this._scroll.set_style(`max-height: ${this._layout.scrollHeightPx}px;`);
        for (const styleClass of Layout.MODE_STYLE_CLASS_LIST) {
            this._root.remove_style_class_name(styleClass);
        }
        this._root.add_style_class_name(this._layout.styleClass);
        this._setWrap(this._subtitleLabel, true);
    }

    _buildHeader() {
        const header = this._box("tpuwm-header");
        header.add_child(new this._St.Icon({
            icon_name: "tpuwm-symbolic",
            icon_type: this._St.IconType.SYMBOLIC,
            icon_size: 32,
            style_class: "tpuwm-brand-icon",
        }));
        const copy = this._box("tpuwm-header-copy", true, true);
        const titleRow = this._box("tpuwm-title-row");
        titleRow.add_child(this._label("TPU Workload Manager", "tpuwm-title"));
        this._statusLabel = this._label("Unavailable", "tpuwm-status");
        titleRow.add_child(this._statusLabel);
        copy.add_child(titleRow);
        this._subtitleLabel = this._label("Starting monitoring…", "tpuwm-subtitle", true);
        copy.add_child(this._subtitleLabel);
        header.add_child(copy);
        this._pauseButton = this._button("tpuwm-secondary-button", "Pause all workloads", () => {
            if (this._policyPaused) {
                this._actions.resumeAll();
            } else {
                this._actions.pauseAll();
            }
        });
        this._pauseLabel = this._label("Pause all", "tpuwm-button-label");
        this._pauseButton.set_child(this._pauseLabel);
        header.add_child(this._pauseButton);
        this._root.add_child(header);
    }

    _buildMetrics() {
        this._metrics = this._box("tpuwm-metrics", true);
        this._layoutMetrics();
        this._root.add_child(this._metrics);
    }

    _layoutMetrics() {
        destroyChildren(this._metrics);
        this._metricValues = [];
        const columns = this._layout.metricColumns;
        let row = null;
        for (let index = 0; index < METRIC_NAMES.length; index += 1) {
            if (index % columns === 0) {
                row = this._box("tpuwm-metric-row");
                this._metrics.add_child(row);
            }
            const metric = this._box("tpuwm-metric", true, true);
            metric.add_child(this._label(METRIC_NAMES[index], "tpuwm-metric-name"));
            const value = this._label("—", "tpuwm-metric-value");
            metric.add_child(value);
            row.add_child(metric);
            this._metricValues.push(value);
        }
    }

    _buildTabs() {
        const row = this._box("tpuwm-tabs");
        this._setAccessibleRole(row, "PAGE_TAB_LIST");
        this._tabButtons = new Map();
        for (const tab of ["overview", "profiles", "alerts"]) {
            const label = tab[0].toUpperCase() + tab.slice(1);
            const button = this._button(
                "tpuwm-tab",
                `${label} tab`,
                () => this._actions.selectTab(tab),
                "PAGE_TAB",
            );
            button.set_child(this._label(label, "tpuwm-tab-label"));
            row.add_child(button);
            this._tabButtons.set(tab, button);
        }
        this._tabs = {actor: row};
        this._root.add_child(row);
    }

    _buildBody() {
        this._scroll = new this._St.ScrollView({
            style_class: "tpuwm-scroll vfade",
            x_fill: true,
            y_fill: false,
            y_align: this._St.Align.START,
        });
        this._scroll.set_policy(this._St.PolicyType.NEVER, this._St.PolicyType.AUTOMATIC);
        this._scroll.set_auto_scrolling(true);
        this._body = this._box("tpuwm-body", true);
        this._scroll.add_actor(this._body);
        this._root.add_child(this._scroll);
    }

    _buildFooter() {
        const footer = this._box("tpuwm-footer");
        this._manageButton = this._button("tpuwm-primary-button", "Manage workload profiles", () => this._actions.selectTab("profiles"));
        this._manageButton.x_expand = true;
        this._manageButton.set_child(this._label("Manage profiles", "tpuwm-button-label"));
        footer.add_child(this._manageButton);
        const refresh = this._button("tpuwm-secondary-button", "Refresh TPU status", this._actions.refresh);
        refresh.set_child(this._label("Refresh", "tpuwm-button-label"));
        footer.add_child(refresh);
        const settings = this._button("tpuwm-secondary-button", "Open TPU Workload Manager settings", this._actions.openSettings);
        settings.set_child(new this._St.Icon({
            icon_name: "emblem-system-symbolic",
            icon_type: this._St.IconType.SYMBOLIC,
            icon_size: 16,
        }));
        footer.add_child(settings);
        this._root.add_child(footer);
    }

    _renderBody(model) {
        destroyChildren(this._body);
        if (model.screen === "unavailable") {
            this._renderUnavailable(model);
        } else if (model.screen === "paused") {
            this._renderPaused(model);
        } else if (model.screen === "profiles") {
            this._renderProfiles(model);
        } else if (model.screen === "alerts") {
            this._renderAlerts(model);
        } else {
            this._renderOverview(model);
        }
    }

    _renderOverview(model) {
        this._addSectionHeading("Active profiles", "Weights apply only when queues contend");
        for (const group of model.enabledGroups) {
            this._addGroupHeading(group.name, `${group.profiles.length} active`);
            for (const profile of group.profiles) {
                this._body.add_child(this._profileRow(profile, false));
            }
        }
        if (model.pausedProfiles.length > 0) {
            const paused = this._button("tpuwm-paused-summary", "Manage paused profiles", () => this._actions.selectTab("profiles"));
            paused.set_child(this._label(`${model.pausedProfiles.length} paused profiles  ›`, "tpuwm-button-label"));
            this._body.add_child(paused);
        }
    }

    _renderProfiles(model) {
        const active = model.allGroups.flatMap((group) => group.profiles).filter((profile) => profile.enabled).length;
        const paused = model.pausedProfiles.length;
        this._addSectionHeading("Workload profiles", `${active} active · ${paused} paused · weight 1–5`);
        for (const group of model.allGroups) {
            const activeInGroup = group.profiles.filter((profile) => profile.enabled).length;
            this._addGroupHeading(group.name, `${activeInGroup} of ${group.profiles.length} active`);
            for (const profile of group.profiles) {
                this._body.add_child(this._profileRow(profile, true));
            }
        }
    }

    _renderAlerts(model) {
        if (model.activeAlerts.length === 0) {
            const hero = this._hero(
                "emblem-ok-symbolic",
                "No active alerts",
                "You’re all caught up",
                "All monitored signals are within their review thresholds.",
                "tpuwm-hero-ok",
            );
            this._body.add_child(hero);
        } else {
            this._addSectionHeading("Needs review", `${model.activeAlerts.length} active · no automatic action`);
            for (const alert of model.activeAlerts) {
                this._body.add_child(this._alertCard(alert));
            }
        }
        if (model.resolvedAlerts.length > 0) {
            this._addGroupHeading("Recently resolved", `${model.resolvedAlerts.length}`);
            for (const alert of model.resolvedAlerts.slice(0, 5)) {
                const row = this._box("tpuwm-history-row");
                row.add_child(this._label("✓", "tpuwm-history-mark"));
                const copy = this._box("tpuwm-profile-copy", true, true);
                copy.add_child(this._label(alert.title, "tpuwm-profile-title", true));
                copy.add_child(this._label(`${alert.profileTitle} · ${alert.age}`, "tpuwm-profile-description", true));
                row.add_child(copy);
                row.add_child(this._label("Resolved", "tpuwm-status tpuwm-status-ok"));
                this._body.add_child(row);
            }
        }
    }

    _renderPaused(model) {
        this._body.add_child(this._hero(
            "media-playback-pause-symbolic",
            "Local policy paused",
            "All local profiles are paused",
            "A connected runtime must apply this policy before accepting new jobs. The applet does not modify queued jobs.",
            "tpuwm-hero-paused",
        ));
        const resume = this._button("tpuwm-primary-button tpuwm-state-action", "Resume all workloads", this._actions.resumeAll);
        resume.set_child(this._label("Resume all workloads", "tpuwm-button-label"));
        this._body.add_child(resume);
        this._addGroupHeading("Paused groups", "Safety rules remain active");
        for (const group of model.allGroups) {
            const row = this._box("tpuwm-state-row");
            const copy = this._box("tpuwm-profile-copy", true, true);
            copy.add_child(this._label(group.name, "tpuwm-profile-title", true));
            copy.add_child(this._label(`${group.profiles.length} profiles`, "tpuwm-profile-description", true));
            row.add_child(copy);
            row.add_child(this._label("Paused", "tpuwm-status tpuwm-status-watching"));
            this._body.add_child(row);
        }
    }

    _renderUnavailable(model) {
        this._body.add_child(this._hero(
            "dialog-warning-symbolic",
            "Connection required",
            "TPU accelerator unavailable",
            "Profiles remain saved locally. No data, authorization, backup, or CPU-fallback policy is changed.",
            "tpuwm-hero-unavailable",
        ));
        const steps = [
            ["1", "Check the connection", "Reconnect the accelerator directly to a supported USB or PCIe interface."],
            ["2", "Check device access", "Confirm the current user can access the Edge TPU runtime."],
            ["3", "Retry detection", model.device.reason],
        ];
        for (const [number, title, description] of steps) {
            const row = this._box("tpuwm-recovery-row");
            row.add_child(this._label(number, "tpuwm-step-number"));
            const copy = this._box("tpuwm-profile-copy", true, true);
            copy.add_child(this._label(title, "tpuwm-profile-title", true));
            copy.add_child(this._label(description, "tpuwm-profile-description", true));
            row.add_child(copy);
            this._body.add_child(row);
        }
        const retry = this._button("tpuwm-primary-button tpuwm-state-action", "Retry TPU detection", this._actions.refresh);
        retry.set_child(this._label("Retry detection", "tpuwm-button-label"));
        this._body.add_child(retry);
    }

    _profileRow(profile, editableWeight) {
        const row = this._box(`tpuwm-profile-row${profile.enabled ? "" : " tpuwm-profile-disabled"}`);
        row.add_child(new this._St.Icon({
            icon_name: profile.icon,
            icon_type: this._St.IconType.SYMBOLIC,
            icon_size: 20,
            style_class: "tpuwm-profile-icon",
        }));
        const copy = this._box("tpuwm-profile-copy", true, true);
        const titleRow = this._box("tpuwm-profile-title-row");
        titleRow.add_child(this._label(profile.title, "tpuwm-profile-title", true));
        titleRow.add_child(this._label(ViewModel.STATUS_LABELS[profile.status], `tpuwm-status tpuwm-status-${profile.status}`));
        copy.add_child(titleRow);
        const detail = profile.detail || profile.description;
        copy.add_child(this._label(`${detail} · ${profile.queued} queued`, "tpuwm-profile-description", true));
        row.add_child(copy);
        if (editableWeight) {
            const controls = this._box("tpuwm-weight-control");
            const down = this._button("tpuwm-weight-button", `Decrease ${profile.title} weight`, () => this._actions.changeWeight(profile.id, -1));
            this._setButtonEnabled(down, profile.weight > 1);
            down.set_child(this._label("−", "tpuwm-button-label"));
            controls.add_child(down);
            controls.add_child(this._label(`${profile.weight}`, "tpuwm-weight-value"));
            const up = this._button("tpuwm-weight-button", `Increase ${profile.title} weight`, () => this._actions.changeWeight(profile.id, 1));
            this._setButtonEnabled(up, profile.weight < 5);
            up.set_child(this._label("+", "tpuwm-button-label"));
            controls.add_child(up);
            row.add_child(controls);
        } else {
            row.add_child(this._label(`Weight ${profile.weight}`, "tpuwm-weight-summary"));
        }
        const toggle = this._button(
            `tpuwm-toggle${profile.enabled ? " tpuwm-toggle-on" : ""}`,
            `${profile.enabled ? "Disable" : "Enable"} ${profile.title}`,
            () => this._actions.toggleProfile(profile.id),
            "TOGGLE_BUTTON",
        );
        this._setAccessibleState(toggle, "CHECKED", profile.enabled);
        toggle.set_child(this._label(profile.enabled ? "On" : "Off", "tpuwm-toggle-label"));
        row.add_child(toggle);
        return row;
    }

    _alertCard(alert) {
        const card = this._box(`tpuwm-alert-card tpuwm-alert-${alert.severity}`, true);
        const heading = this._box("tpuwm-alert-heading");
        const copy = this._box("tpuwm-profile-copy", true, true);
        copy.add_child(this._label(`${alert.profileTitle} · ${alert.age}`, "tpuwm-alert-kicker"));
        copy.add_child(this._label(alert.title, "tpuwm-alert-title", true));
        heading.add_child(copy);
        heading.add_child(this._label(alert.severity, "tpuwm-status tpuwm-status-watching"));
        card.add_child(heading);
        card.add_child(this._label(alert.summary || "No additional detail was supplied.", "tpuwm-alert-summary", true));
        const singleColumn = this._layout.evidenceColumns === 1;
        const evidence = this._box("tpuwm-evidence", singleColumn);
        for (const [label, value] of [["Risk", alert.riskText], ["Confidence", alert.confidenceText]]) {
            const metric = this._box("tpuwm-evidence-item", true, true);
            metric.add_child(this._label(label, "tpuwm-metric-name"));
            metric.add_child(this._label(value, "tpuwm-metric-value"));
            evidence.add_child(metric);
        }
        card.add_child(evidence);
        card.add_child(this._label(
            "Safe by default · no write, shutdown, authorization, or backup policy changed",
            "tpuwm-safety-note",
        ));
        return card;
    }

    _addSectionHeading(title, description) {
        const heading = this._box("tpuwm-section-heading");
        const copy = this._box("tpuwm-profile-copy", true, true);
        copy.add_child(this._label(title, "tpuwm-section-title", true));
        copy.add_child(this._label(description, "tpuwm-section-description", true));
        heading.add_child(copy);
        this._body.add_child(heading);
    }

    _addGroupHeading(title, value) {
        const heading = this._box("tpuwm-group-heading");
        heading.add_child(this._label(title, "tpuwm-group-title"));
        heading.add_child(this._label(value, "tpuwm-group-value"));
        this._body.add_child(heading);
    }

    _hero(iconName, kicker, title, description, styleClass) {
        const hero = this._box(`tpuwm-hero ${styleClass}`, true);
        hero.add_child(new this._St.Icon({
            icon_name: iconName,
            icon_type: this._St.IconType.SYMBOLIC,
            icon_size: 36,
            style_class: "tpuwm-hero-icon",
        }));
        hero.add_child(this._label(kicker, "tpuwm-hero-kicker"));
        hero.add_child(this._label(title, "tpuwm-hero-title", true));
        hero.add_child(this._label(description, "tpuwm-hero-description", true));
        return hero;
    }

    _box(styleClass, vertical = false, expand = false) {
        return new this._St.BoxLayout({vertical, style_class: styleClass, x_expand: expand});
    }

    _label(text, styleClass, wrap = false) {
        const label = new this._St.Label({
            text: String(text || ""),
            style_class: styleClass,
            y_align: this._Clutter.ActorAlign.CENTER,
        });
        this._setWrap(label, wrap);
        return label;
    }

    // Narrow, high-scale, and large-text popups wrap descriptive text instead of
    // clipping it; the wide layout keeps one-line ellipsized rows.
    _setWrap(label, wrap) {
        if (!label || !label.clutter_text) {
            return false;
        }
        const wrapping = wrap === true && this._layout.wrapText;
        label.clutter_text.line_wrap = wrapping;
        label.clutter_text.ellipsize = wrapping ? 0 : 3;
        return wrapping;
    }

    _button(styleClass, accessibleName, callback, role = "PUSH_BUTTON") {
        const button = new this._St.Button({
            style_class: styleClass,
            can_focus: true,
            reactive: true,
            track_hover: true,
        });
        button.set_accessible_name(accessibleName);
        this._setAccessibleRole(button, role);
        button.connect("clicked", () => callback());
        return button;
    }

    // Assistive technology needs the semantic role and state, not only the
    // accessible name; both are set here so the two never disagree.
    _setAccessibleRole(actor, role) {
        const value = this._Atk && this._Atk.Role ? this._Atk.Role[role] : undefined;
        if (value === undefined || typeof actor.set_accessible_role !== "function") {
            return false;
        }
        actor.set_accessible_role(value);
        return true;
    }

    _setAccessibleState(actor, state, enabled) {
        const value = this._Atk && this._Atk.StateType ? this._Atk.StateType[state] : undefined;
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

    _setButtonEnabled(button, enabled) {
        button.reactive = enabled;
        button.can_focus = enabled;
        setStyleClass(button, "tpuwm-button-disabled", !enabled);
        this._setAccessibleState(button, "SENSITIVE", enabled);
    }
}

module.exports = {
    MenuView,
    destroyChildren,
    requireAction,
    setStyleClass,
};
