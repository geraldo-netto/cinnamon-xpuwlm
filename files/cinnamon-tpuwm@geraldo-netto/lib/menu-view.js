"use strict";

const I18n = require("./i18n.js");
const Layout = require("./layout.js");
const ViewModel = require("./view-model.js");

const {_, N_, format, ngettext} = I18n;

// Initial placeholders only: render() updates each tile name from the view
// model, so the first tile can follow the active backend (TPU/NPU/GPU).
const METRIC_NAMES = Object.freeze([N_("Accelerator load"), N_("Queue"), N_("Running"), N_("Attention")]);
const TAB_NAMES = Object.freeze(["overview", "profiles", "alerts"]);
const TAB_LABELS = Object.freeze({
    overview: N_("Overview"),
    profiles: N_("Profiles"),
    alerts: N_("Alerts"),
});

// Tab-strip key handling, kept pure so the expected arrow, Home, and End
// behaviour can be verified without a Clutter stage.
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

// Body controls carry a semantic identity that survives a rebuild, so keyboard
// focus can return to the same control rather than to whatever landed first.
function focusableControls(actor, found = []) {
    for (const child of actor.get_children()) {
        if (child.tpuwmIdentity !== undefined && child.can_focus !== false) {
            found.push(child);
        }
        focusableControls(child, found);
    }
    return found;
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
            acknowledgeCatalogChanges: requireAction(actions, "acknowledgeCatalogChanges"),
        };
        this._policyPaused = false;
        this._controlPending = false;
        this._bodyKey = null;
        this._model = null;
        this._selectedTab = TAB_NAMES[0];
        this._focusedIdentity = null;
        this._layout = layout || Layout.defaultLayout();
        this._root = this._box("tpuwm-root", true);
        this._buildHeader();
        this._buildCatalogNotice();
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
        this._controlPending = model.controlPending;
        this._statusLabel.set_text(model.device.status);
        this._subtitleLabel.set_text(model.headerSubtitle);
        this._pauseLabel.set_text(this._policyPaused ? _("Resume all") : _("Pause all"));
        this._pauseButton.set_accessible_name(this._policyPaused
            ? _("Resume all workloads")
            : _("Pause all workloads"));
        this._setButtonEnabled(this._pauseButton, !this._controlPending);
        setStyleClass(this._statusLabel, "tpuwm-status-unavailable", !model.device.available);
        for (let index = 0; index < this._metricValues.length; index += 1) {
            const metric = model.metrics[index];
            const suffix = metric.suffix ? ` ${metric.suffix}` : "";
            this._metricNames[index].set_text(metric.label);
            this._metricValues[index].set_text(`${metric.value}${suffix}`);
            setStyleClass(this._metricValues[index], "tpuwm-attention", metric.tone === "attention");
        }
        this._renderCatalogNotice(model.catalogNotice);
        this._tabs.actor.visible = model.showTabs;
        this._manageButton.visible = model.showTabs;
        this._selectedTab = model.selectedTab;
        for (const [tab, button] of this._tabButtons) {
            const selected = model.selectedTab === tab;
            setStyleClass(button, "tpuwm-tab-active", selected);
            button.set_accessible_name(format(
                selected ? _("%s tab, selected") : _("%s tab"),
                _(TAB_LABELS[tab]),
            ));
            this._setAccessibleState(button, "SELECTED", selected);
            button.can_focus = selected;
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
        this._focusedIdentity = null;
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
        this._setWrap(this._catalogNoticeDetail, true);
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
        titleRow.add_child(this._label(_("TPU Workload Manager"), "tpuwm-title"));
        this._statusLabel = this._label(_("Unavailable"), "tpuwm-status");
        titleRow.add_child(this._statusLabel);
        copy.add_child(titleRow);
        this._subtitleLabel = this._label(_("Starting monitoring…"), "tpuwm-subtitle", true);
        copy.add_child(this._subtitleLabel);
        header.add_child(copy);
        this._pauseButton = this._button("tpuwm-secondary-button", _("Pause all workloads"), () => {
            if (this._policyPaused) {
                this._actions.resumeAll();
            } else {
                this._actions.pauseAll();
            }
        });
        this._pauseLabel = this._label(_("Pause all"), "tpuwm-button-label");
        this._pauseButton.set_child(this._pauseLabel);
        header.add_child(this._pauseButton);
        this._root.add_child(header);
    }

    // Plug-in installs, upgrades, and removals are reported where the change
    // happened, above the workload data they affect, and stay until the user
    // acknowledges them. Nothing is communicated by colour alone.
    _buildCatalogNotice() {
        this._catalogNotice = this._box("tpuwm-catalog-notice");
        this._catalogNotice.visible = false;
        const copy = this._box("tpuwm-profile-copy", true, true);
        this._catalogNoticeTitle = this._label(_("Workload catalog changed"), "tpuwm-catalog-notice-title");
        copy.add_child(this._catalogNoticeTitle);
        this._catalogNoticeDetail = this._label("", "tpuwm-catalog-notice-detail", true);
        copy.add_child(this._catalogNoticeDetail);
        this._catalogNotice.add_child(copy);
        const dismiss = this._button(
            "tpuwm-secondary-button",
            _("Dismiss the workload catalog change notice"),
            () => this._actions.acknowledgeCatalogChanges(),
        );
        this._catalogNoticeDismiss = this._label(_("Dismiss"), "tpuwm-button-label");
        dismiss.set_child(this._catalogNoticeDismiss);
        this._catalogNotice.add_child(dismiss);
        this._root.add_child(this._catalogNotice);
    }

    _renderCatalogNotice(notice) {
        const present = notice !== null && notice !== undefined;
        this._catalogNotice.visible = present;
        if (!present) {
            return false;
        }
        this._catalogNoticeTitle.set_text(notice.title);
        this._catalogNoticeDetail.set_text(notice.detail);
        this._catalogNoticeDismiss.set_text(notice.dismissLabel);
        this._catalogNotice.set_accessible_name(notice.accessibleName);
        return true;
    }

    _buildMetrics() {
        this._metrics = this._box("tpuwm-metrics", true);
        this._layoutMetrics();
        this._root.add_child(this._metrics);
    }

    _layoutMetrics() {
        destroyChildren(this._metrics);
        this._metricNames = [];
        this._metricValues = [];
        const columns = this._layout.metricColumns;
        let row = null;
        for (let index = 0; index < METRIC_NAMES.length; index += 1) {
            if (index % columns === 0) {
                row = this._box("tpuwm-metric-row");
                this._metrics.add_child(row);
            }
            const metric = this._box("tpuwm-metric", true, true);
            const name = this._label(_(METRIC_NAMES[index]), "tpuwm-metric-name");
            metric.add_child(name);
            const value = this._label("—", "tpuwm-metric-value");
            metric.add_child(value);
            row.add_child(metric);
            this._metricNames.push(name);
            this._metricValues.push(value);
        }
    }

    _buildTabs() {
        const row = this._box("tpuwm-tabs");
        this._setAccessibleRole(row, "PAGE_TAB_LIST");
        this._tabButtons = new Map();
        for (const tab of TAB_NAMES) {
            const label = _(TAB_LABELS[tab]);
            const button = this._button(
                "tpuwm-tab",
                format(_("%s tab"), label),
                () => this._actions.selectTab(tab),
                "PAGE_TAB",
            );
            button.set_child(this._label(label, "tpuwm-tab-label"));
            button.connect("key-press-event", (_actor, event) => this._onTabKeyPress(event));
            row.add_child(button);
            this._tabButtons.set(tab, button);
        }
        this._tabs = {actor: row};
        this._root.add_child(row);
    }

    _onTabKeyPress(event) {
        const stop = this._Clutter.EVENT_STOP === undefined ? true : this._Clutter.EVENT_STOP;
        const propagate = this._Clutter.EVENT_PROPAGATE === undefined
            ? false
            : this._Clutter.EVENT_PROPAGATE;
        if (!event || typeof event.get_key_symbol !== "function") {
            return propagate;
        }
        const move = tabKeyMove(this._Clutter, event.get_key_symbol());
        if (move === null) {
            return propagate;
        }
        const current = TAB_NAMES.indexOf(this._selectedTab);
        const target = TAB_NAMES[movedTabIndex(move, current, TAB_NAMES.length)];
        if (target !== this._selectedTab) {
            this._actions.selectTab(target);
        }
        this._focusTab(target);
        return stop;
    }

    // Roving focus: only the selected tab is reachable with Tab, and arrow,
    // Home, and End keys move both the selection and the keyboard focus.
    _focusTab(tab) {
        const button = this._tabButtons.get(tab);
        if (!button) {
            return false;
        }
        button.can_focus = true;
        if (typeof button.grab_key_focus === "function") {
            button.grab_key_focus();
        }
        for (const [name, candidate] of this._tabButtons) {
            if (name !== tab) {
                candidate.can_focus = false;
            }
        }
        return true;
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
        this._manageButton = this._button("tpuwm-primary-button", _("Manage workload profiles"), () => this._actions.selectTab("profiles"));
        this._manageButton.x_expand = true;
        this._manageButton.set_child(this._label(_("Manage profiles"), "tpuwm-button-label"));
        footer.add_child(this._manageButton);
        const refresh = this._button("tpuwm-secondary-button", _("Refresh TPU status"), this._actions.refresh);
        refresh.set_child(this._label(_("Refresh"), "tpuwm-button-label"));
        footer.add_child(refresh);
        const settings = this._button("tpuwm-secondary-button", _("Open TPU Workload Manager settings"), this._actions.openSettings);
        settings.set_child(new this._St.Icon({
            icon_name: "emblem-system-symbolic",
            icon_type: this._St.IconType.SYMBOLIC,
            icon_size: 16,
        }));
        footer.add_child(settings);
        this._root.add_child(footer);
    }

    _renderBody(model) {
        const previous = this._focusedIdentity;
        destroyChildren(this._body);
        if (model.controlMessage) {
            this._body.add_child(this._label(
                model.controlMessage,
                `tpuwm-control-feedback${model.controlPending ? " tpuwm-control-pending" : " tpuwm-control-error"}`,
                true,
            ));
        }
        this._renderScreen(model);
        return this._restoreBodyFocus(previous);
    }

    // A rebuilt body keeps the caret on the same semantic control; when that
    // control is gone the first body control takes it, and when the body has no
    // control at all the selected tab does.
    _restoreBodyFocus(identity) {
        if (identity === null || identity === undefined) {
            return null;
        }
        const controls = focusableControls(this._body);
        const target = controls.find((control) => control.tpuwmIdentity === identity)
            || controls[0]
            || this._tabButtons.get(this._selectedTab)
            || null;
        if (target === null) {
            this._focusedIdentity = null;
            return null;
        }
        if (typeof target.grab_key_focus === "function") {
            target.grab_key_focus();
        }
        return this._focusedIdentity;
    }

    _renderScreen(model) {
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
        this._renderAccelerators(model);
        this._addSectionHeading(_("Active profiles"), _("Weights apply only when queues contend"));
        for (const group of model.enabledGroups) {
            this._addGroupHeading(group.name, format(_("%d active"), group.profiles.length));
            for (const profile of group.profiles) {
                this._body.add_child(this._profileRow(profile, false));
            }
        }
        if (model.pausedProfiles.length > 0) {
            const paused = this._identify(
                this._button("tpuwm-paused-summary", _("Manage paused profiles"), () => this._actions.selectTab("profiles")),
                "paused-summary",
            );
            paused.set_child(this._label(
                `${format(ngettext("%d paused profile", "%d paused profiles", model.pausedProfiles.length), model.pausedProfiles.length)}  ›`,
                "tpuwm-button-label",
            ));
            this._body.add_child(paused);
        }
    }

    _renderAccelerators(model) {
        if (model.devices.length === 0) {
            return;
        }
        const availableCount = model.devices.filter((device) => device.available).length;
        this._addGroupHeading(_("Accelerators"), format(_("%d of %d available"), availableCount, model.devices.length));
        for (const device of model.devices) {
            const row = this._box("tpuwm-state-row");
            const copy = this._box("tpuwm-profile-copy", true, true);
            copy.add_child(this._label(`${device.backendText} · ${device.name}`, "tpuwm-profile-title", true));
            copy.add_child(this._label(
                device.available ? format(_("Load %s"), device.loadText) : device.statusText,
                "tpuwm-profile-description",
                true,
            ));
            row.add_child(copy);
            row.add_child(this._label(
                device.statusText,
                device.available ? "tpuwm-status tpuwm-status-healthy" : "tpuwm-status tpuwm-status-unavailable",
            ));
            this._body.add_child(row);
        }
    }

    _renderProfiles(model) {
        const active = model.allGroups.flatMap((group) => group.profiles).filter((profile) => profile.enabled).length;
        const paused = model.pausedProfiles.length;
        this._addSectionHeading(_("Workload profiles"), format(_("%d active · %d paused · weight 1–5"), active, paused));
        for (const group of model.allGroups) {
            const activeInGroup = group.profiles.filter((profile) => profile.enabled).length;
            this._addGroupHeading(group.name, format(_("%d of %d active"), activeInGroup, group.profiles.length));
            for (const profile of group.profiles) {
                this._body.add_child(this._profileRow(profile, true));
            }
        }
    }

    _renderAlerts(model) {
        if (model.activeAlerts.length === 0) {
            const hero = this._hero(
                "emblem-ok-symbolic",
                _("No active alerts"),
                _("You’re all caught up"),
                _("All monitored signals are within their review thresholds."),
                "tpuwm-hero-ok",
            );
            this._body.add_child(hero);
        } else {
            this._addSectionHeading(
                _("Needs review"),
                format(_("%d active · highest severity %s · no automatic action"), model.activeAlerts.length, model.highestSeverityText),
            );
            for (const alert of model.activeAlerts) {
                this._body.add_child(this._alertCard(alert));
            }
        }
        if (model.resolvedAlerts.length > 0) {
            this._addGroupHeading(_("Recently resolved"), `${model.resolvedAlerts.length}`);
            for (const alert of model.resolvedAlerts.slice(0, 5)) {
                const row = this._box("tpuwm-history-row");
                row.add_child(this._label("✓", "tpuwm-history-mark"));
                const copy = this._box("tpuwm-profile-copy", true, true);
                copy.add_child(this._label(alert.title, "tpuwm-profile-title", true));
                copy.add_child(this._label(`${alert.profileTitle} · ${alert.age}`, "tpuwm-profile-description", true));
                row.add_child(copy);
                row.add_child(this._label(_("Resolved"), "tpuwm-status tpuwm-status-ok"));
                this._body.add_child(row);
            }
        }
    }

    _renderPaused(model) {
        this._body.add_child(this._hero(
            "media-playback-pause-symbolic",
            _("Local policy paused"),
            _("All local profiles are paused"),
            _("A connected runtime must apply this policy before accepting new jobs. The applet does not modify queued jobs."),
            "tpuwm-hero-paused",
        ));
        const resume = this._identify(
            this._button("tpuwm-primary-button tpuwm-state-action", _("Resume all workloads"), this._actions.resumeAll),
            "resume-all",
        );
        resume.set_child(this._label(_("Resume all workloads"), "tpuwm-button-label"));
        this._setButtonEnabled(resume, !this._controlPending);
        this._body.add_child(resume);
        this._addGroupHeading(_("Paused groups"), _("Safety rules remain active"));
        for (const group of model.allGroups) {
            const row = this._box("tpuwm-state-row");
            const copy = this._box("tpuwm-profile-copy", true, true);
            copy.add_child(this._label(group.name, "tpuwm-profile-title", true));
            copy.add_child(this._label(
                format(ngettext("%d profile", "%d profiles", group.profiles.length), group.profiles.length),
                "tpuwm-profile-description",
                true,
            ));
            row.add_child(copy);
            row.add_child(this._label(_("Paused"), "tpuwm-status tpuwm-status-watching"));
            this._body.add_child(row);
        }
    }

    _renderUnavailable(model) {
        this._body.add_child(this._hero(
            "dialog-warning-symbolic",
            model.recovery.kicker,
            model.recovery.title,
            model.recovery.description,
            "tpuwm-hero-unavailable",
        ));
        for (const step of model.recovery.steps) {
            const row = this._box("tpuwm-recovery-row");
            row.add_child(this._label(step.number, "tpuwm-step-number"));
            const copy = this._box("tpuwm-profile-copy", true, true);
            copy.add_child(this._label(step.title, "tpuwm-profile-title", true));
            copy.add_child(this._label(step.description, "tpuwm-profile-description", true));
            row.add_child(copy);
            this._body.add_child(row);
        }
        const retry = this._identify(
            this._button("tpuwm-primary-button tpuwm-state-action", _("Retry TPU detection"), this._actions.refresh),
            "retry-detection",
        );
        retry.set_child(this._label(_("Retry detection"), "tpuwm-button-label"));
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
        titleRow.add_child(this._label(_(ViewModel.STATUS_LABELS[profile.status]), `tpuwm-status tpuwm-status-${profile.status}`));
        copy.add_child(titleRow);
        const detail = profile.detail || profile.description;
        copy.add_child(this._label(`${detail} · ${format(_("%d queued"), profile.queued)}`, "tpuwm-profile-description", true));
        row.add_child(copy);
        if (editableWeight) {
            const controls = this._box("tpuwm-weight-control");
            const down = this._identify(
                this._button("tpuwm-weight-button", format(_("Decrease %s weight"), profile.title), () => this._actions.changeWeight(profile.id, -1)),
                `weight-down:${profile.id}`,
            );
            this._setButtonEnabled(down, this._policyControlEnabled(profile.weight > 1));
            down.set_child(this._label("−", "tpuwm-button-label"));
            controls.add_child(down);
            controls.add_child(this._label(`${profile.weight}`, "tpuwm-weight-value"));
            const up = this._identify(
                this._button("tpuwm-weight-button", format(_("Increase %s weight"), profile.title), () => this._actions.changeWeight(profile.id, 1)),
                `weight-up:${profile.id}`,
            );
            this._setButtonEnabled(up, this._policyControlEnabled(profile.weight < 5));
            up.set_child(this._label("+", "tpuwm-button-label"));
            controls.add_child(up);
            row.add_child(controls);
        } else {
            row.add_child(this._label(format(_("Weight %d"), profile.weight), "tpuwm-weight-summary"));
        }
        const toggle = this._identify(
            this._button(
                `tpuwm-toggle${profile.enabled ? " tpuwm-toggle-on" : ""}`,
                format(profile.enabled ? _("Disable %s") : _("Enable %s"), profile.title),
                () => this._actions.toggleProfile(profile.id),
                "TOGGLE_BUTTON",
            ),
            `toggle:${profile.id}`,
        );
        this._setAccessibleState(toggle, "CHECKED", profile.enabled);
        this._setButtonEnabled(toggle, !this._controlPending);
        toggle.set_child(this._label(profile.enabled ? _("On") : _("Off"), "tpuwm-toggle-label"));
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
        heading.add_child(this._label(_(alert.severity), "tpuwm-status tpuwm-status-watching"));
        card.add_child(heading);
        card.add_child(this._label(alert.summary || _("No additional detail was supplied."), "tpuwm-alert-summary", true));
        const singleColumn = this._layout.evidenceColumns === 1;
        const evidence = this._box("tpuwm-evidence", singleColumn);
        for (const [label, value] of [[_("Risk"), alert.riskText], [_("Confidence"), alert.confidenceText]]) {
            const metric = this._box("tpuwm-evidence-item", true, true);
            metric.add_child(this._label(label, "tpuwm-metric-name"));
            metric.add_child(this._label(value, "tpuwm-metric-value"));
            evidence.add_child(metric);
        }
        card.add_child(evidence);
        card.add_child(this._label(
            _("Safe by default · no write, shutdown, authorization, or backup policy changed"),
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
        button.connect("key-focus-in", () => {
            this._focusedIdentity = button.tpuwmIdentity === undefined
                ? null
                : button.tpuwmIdentity;
        });
        return button;
    }

    _identify(actor, identity) {
        actor.tpuwmIdentity = identity;
        return actor;
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

    _policyControlEnabled(enabled = true) {
        return !this._controlPending && enabled;
    }
}

module.exports = {
    MenuView,
    TAB_NAMES,
    destroyChildren,
    focusableControls,
    movedTabIndex,
    requireAction,
    setStyleClass,
    tabKeyMove,
};
