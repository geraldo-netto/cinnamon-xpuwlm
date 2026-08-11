"use strict";

const I18n = require("./i18n.js");
const Layout = require("./layout.js");
const ViewModel = require("./view-model.js");

const {_, N_, format, ngettext} = I18n;

// Initial placeholders only: render() updates each tile name from the view
// model, so the first tile can follow the active backend (TPU/NPU/GPU).
const METRIC_NAMES = Object.freeze([N_("Accelerator load"), N_("Queue"), N_("Running"), N_("Attention")]);
// Setup sits last: it is a reference screen, consulted when something is
// missing, not part of the daily loop the first three tabs cover.
const TAB_NAMES = Object.freeze(["overview", "profiles", "alerts", "setup"]);
const TAB_LABELS = Object.freeze({
    overview: N_("Overview"),
    profiles: N_("Profiles"),
    alerts: N_("Alerts"),
    setup: N_("Setup"),
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

// Everything known about one job, in the order it becomes known: what the
// runtime said, then what became of it, then how far along it is. Each part is
// omitted when it is not known rather than printed empty.
function jobDetail(job) {
    return [job.message, job.stateText, job.progressText, job.jobId]
        .filter((part) => typeof part === "string" && part !== "")
        .join(" · ");
}

function requireAction(actions, name) {
    if (!actions || typeof actions[name] !== "function") {
        throw new TypeError(`Menu action ${name} is required`);
    }
    return actions[name];
}

function optionalAction(actions, name) {
    return actions && typeof actions[name] === "function" ? actions[name] : () => false;
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
        if (child.xpuwlmIdentity !== undefined && child.can_focus !== false) {
            found.push(child);
        }
        focusableControls(child, found);
    }
    return found;
}

class MenuView {
    constructor({St, Clutter, Atk, menu, actions, layout, tooltips}) {
        if (!St || !Clutter || !menu || typeof menu.addActor !== "function") {
            throw new TypeError("Cinnamon UI dependencies are required");
        }
        this._St = St;
        this._Clutter = Clutter;
        this._Atk = Atk;
        // Optional: a Cinnamon build supplies imports.ui.tooltips, tests do not.
        // Absent, a disabled control still announces its reason through its
        // accessible name and the words printed on its row.
        this._tooltips = typeof tooltips === "function" ? tooltips : null;
        this._actions = {
            selectTab: requireAction(actions, "selectTab"),
            toggleProfile: requireAction(actions, "toggleProfile"),
            changeWeight: requireAction(actions, "changeWeight"),
            pauseAll: requireAction(actions, "pauseAll"),
            resumeAll: requireAction(actions, "resumeAll"),
            refresh: requireAction(actions, "refresh"),
            openSettings: requireAction(actions, "openSettings"),
            acknowledgeCatalogChanges: requireAction(actions, "acknowledgeCatalogChanges"),
            submitJob: requireAction(actions, "submitJob"),
            chooseEventFiles: optionalAction(actions, "chooseEventFiles"),
            chooseEventFolder: optionalAction(actions, "chooseEventFolder"),
            startEventImport: optionalAction(actions, "startEventImport"),
            cancelEventImport: optionalAction(actions, "cancelEventImport"),
            editEventCandidate: optionalAction(actions, "editEventCandidate"),
            decideEventCandidate: optionalAction(actions, "decideEventCandidate"),
            beginEventExport: optionalAction(actions, "beginEventExport"),
            confirmEventExport: optionalAction(actions, "confirmEventExport"),
            backEventPreview: optionalAction(actions, "backEventPreview"),
            resetEventImport: optionalAction(actions, "resetEventImport"),
        };
        this._policyPaused = false;
        this._controlPending = false;
        this._bodyKey = null;
        this._model = null;
        this._selectedTab = TAB_NAMES[0];
        this._focusedIdentity = null;
        // Disclosure state belongs to the popup, not to saved policy: it is a
        // reading position, and it survives body rebuilds so a refresh never
        // collapses the group under the user's cursor.
        this._blockedExpanded = false;
        this._blocked = null;
        this._layout = layout || Layout.defaultLayout();
        this._root = this._box("xpuwlm-root", true);
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
        setStyleClass(this._statusLabel, "xpuwlm-status-unavailable", !model.device.available);
        for (let index = 0; index < this._metricValues.length; index += 1) {
            const metric = model.metrics[index];
            const suffix = metric.suffix ? ` ${metric.suffix}` : "";
            this._metricNames[index].set_text(metric.label);
            this._metricValues[index].set_text(`${metric.value}${suffix}`);
            setStyleClass(this._metricValues[index], "xpuwlm-attention", metric.tone === "attention");
        }
        this._renderCatalogNotice(model.catalogNotice);
        this._tabs.actor.visible = model.showTabs;
        this._manageButton.visible = model.showTabs;
        this._selectedTab = model.selectedTab;
        for (const [tab, button] of this._tabButtons) {
            const selected = model.selectedTab === tab;
            setStyleClass(button, "xpuwlm-tab-active", selected);
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
        const header = this._box("xpuwlm-header");
        header.add_child(new this._St.Icon({
            icon_name: "xpuwlm-symbolic",
            icon_type: this._St.IconType.SYMBOLIC,
            icon_size: 32,
            style_class: "xpuwlm-brand-icon",
        }));
        const copy = this._box("xpuwlm-header-copy", true, true);
        const titleRow = this._box("xpuwlm-title-row");
        titleRow.add_child(this._label(_("XPU Workload Manager"), "xpuwlm-title"));
        this._statusLabel = this._label(_("Unavailable"), "xpuwlm-status");
        titleRow.add_child(this._statusLabel);
        copy.add_child(titleRow);
        this._subtitleLabel = this._label(_("Starting monitoring…"), "xpuwlm-subtitle", true);
        copy.add_child(this._subtitleLabel);
        header.add_child(copy);
        this._pauseButton = this._button("xpuwlm-secondary-button", _("Pause all workloads"), () => {
            if (this._policyPaused) {
                this._actions.resumeAll();
            } else {
                this._actions.pauseAll();
            }
        });
        this._pauseLabel = this._label(_("Pause all"), "xpuwlm-button-label");
        this._pauseButton.set_child(this._pauseLabel);
        header.add_child(this._pauseButton);
        this._root.add_child(header);
    }

    // Plug-in installs, upgrades, and removals are reported where the change
    // happened, above the workload data they affect, and stay until the user
    // acknowledges them. Nothing is communicated by colour alone.
    _buildCatalogNotice() {
        this._catalogNotice = this._box("xpuwlm-catalog-notice");
        this._catalogNotice.visible = false;
        const copy = this._box("xpuwlm-profile-copy", true, true);
        this._catalogNoticeTitle = this._label(_("Workload catalog changed"), "xpuwlm-catalog-notice-title");
        copy.add_child(this._catalogNoticeTitle);
        this._catalogNoticeDetail = this._label("", "xpuwlm-catalog-notice-detail", true);
        copy.add_child(this._catalogNoticeDetail);
        this._catalogNotice.add_child(copy);
        const dismiss = this._button(
            "xpuwlm-secondary-button",
            _("Dismiss the workload catalog change notice"),
            () => this._actions.acknowledgeCatalogChanges(),
        );
        this._catalogNoticeDismiss = this._label(_("Dismiss"), "xpuwlm-button-label");
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
        this._metrics = this._box("xpuwlm-metrics", true);
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
                row = this._box("xpuwlm-metric-row");
                this._metrics.add_child(row);
            }
            const metric = this._box("xpuwlm-metric", true, true);
            const name = this._label(_(METRIC_NAMES[index]), "xpuwlm-metric-name");
            metric.add_child(name);
            const value = this._label("—", "xpuwlm-metric-value");
            metric.add_child(value);
            row.add_child(metric);
            this._metricNames.push(name);
            this._metricValues.push(value);
        }
    }

    _buildTabs() {
        const row = this._box("xpuwlm-tabs");
        this._setAccessibleRole(row, "PAGE_TAB_LIST");
        this._tabButtons = new Map();
        for (const tab of TAB_NAMES) {
            const label = _(TAB_LABELS[tab]);
            const button = this._button(
                "xpuwlm-tab",
                format(_("%s tab"), label),
                () => this._actions.selectTab(tab),
                "PAGE_TAB",
            );
            button.set_child(this._label(label, "xpuwlm-tab-label"));
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
            style_class: "xpuwlm-scroll vfade",
            x_fill: true,
            y_fill: false,
            y_align: this._St.Align.START,
        });
        this._scroll.set_policy(this._St.PolicyType.NEVER, this._St.PolicyType.AUTOMATIC);
        this._scroll.set_auto_scrolling(true);
        this._body = this._box("xpuwlm-body", true);
        this._scroll.add_actor(this._body);
        this._root.add_child(this._scroll);
    }

    _buildFooter() {
        const footer = this._box("xpuwlm-footer");
        this._manageButton = this._button("xpuwlm-primary-button", _("Manage workload profiles"), () => this._actions.selectTab("profiles"));
        this._manageButton.x_expand = true;
        this._manageButton.set_child(this._label(_("Manage profiles"), "xpuwlm-button-label"));
        footer.add_child(this._manageButton);
        const refresh = this._button("xpuwlm-secondary-button", _("Refresh XPU status"), this._actions.refresh);
        refresh.set_child(this._label(_("Refresh"), "xpuwlm-button-label"));
        footer.add_child(refresh);
        const settings = this._button("xpuwlm-secondary-button", _("Open XPU Workload Manager settings"), this._actions.openSettings);
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
        this._blocked = null;
        if (model.controlMessage) {
            this._body.add_child(this._label(
                model.controlMessage,
                `xpuwlm-control-feedback${model.controlPending ? " xpuwlm-control-pending" : " xpuwlm-control-error"}`,
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
        const target = controls.find((control) => control.xpuwlmIdentity === identity)
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
        } else if (model.screen === "setup") {
            this._renderSetup(model);
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
                this._button("xpuwlm-paused-summary", _("Manage paused profiles"), () => this._actions.selectTab("profiles")),
                "paused-summary",
            );
            paused.set_child(this._label(
                `${format(ngettext("%d paused profile", "%d paused profiles", model.pausedProfiles.length), model.pausedProfiles.length)}  ›`,
                "xpuwlm-button-label",
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
            const row = this._box("xpuwlm-state-row");
            const copy = this._box("xpuwlm-profile-copy", true, true);
            copy.add_child(this._label(`${device.backendText} · ${device.name}`, "xpuwlm-profile-title", true));
            copy.add_child(this._label(
                device.available ? format(_("Load %s"), device.loadText) : device.statusText,
                "xpuwlm-profile-description",
                true,
            ));
            row.add_child(copy);
            row.add_child(this._label(
                device.statusText,
                device.available ? "xpuwlm-status xpuwlm-status-healthy" : "xpuwlm-status xpuwlm-status-unavailable",
            ));
            this._body.add_child(row);
        }
    }

    // Profiles that can run come first and read normally. Everything the
    // runtime cannot run goes into one group at the bottom, collapsed, so the
    // tab is a list of what works rather than a wall of controls that lie. The
    // split and every count in it are derived from the live snapshot, so the
    // group shrinks by itself as models and runtimes are installed.
    _renderProfiles(model) {
        const active = model.allGroups.flatMap((group) => group.profiles).filter((profile) => profile.enabled).length;
        const paused = model.pausedProfiles.length;
        this._addSectionHeading(
            _("Workload profiles"),
            format(_("%d active · %d paused · weight 1–5"), active, paused),
        );
        for (const group of model.runnableGroups) {
            const activeInGroup = group.profiles.filter((profile) => profile.enabled).length;
            this._addGroupHeading(group.name, format(_("%d of %d active"), activeInGroup, group.profiles.length));
            for (const profile of group.profiles) {
                this._body.add_child(this._profileRow(profile, true));
            }
        }
        if (model.runnableGroups.length === 0) {
            this._body.add_child(this._label(
                _("No workload profile can run on this machine yet. Open the Setup tab to see what each one needs."),
                "xpuwlm-empty-note",
                true,
            ));
        }
        // Above the collapsed group deliberately: what a user can run now
        // belongs with the profiles that run, and the group of profiles that
        // cannot stays at the bottom where it was.
        this._renderRun(model.run);
        this._renderEventImport(model.eventImport);
        this._renderBlockedProfiles(model);
    }

    _renderEventImport(model) {
        if (model === null || model === undefined) {
            return false;
        }
        this._addSectionHeading(model.title, _("Selected files stay private to the isolated workload worker"));
        if (model.message !== "") {
            this._body.add_child(this._label(model.message, "xpuwlm-event-message", true));
        }
        if (model.progressText !== "") {
            this._body.add_child(this._label(model.progressText, "xpuwlm-event-progress", true));
        }
        this._renderEventSources(model);
        if (model.preview) {
            this._renderEventPreview(model);
        } else if (model.confirmation) {
            this._renderEventConfirmation(model);
        }
        this._renderEventActions(model);
        return true;
    }

    _renderEventSources(model) {
        if (model.sources.length === 0) {
            if (!model.available) {
                this._body.add_child(this._label(
                    model.availabilityDetail || _("A qualified event model is not configured"),
                    "xpuwlm-run-note",
                    true,
                ));
            }
            return false;
        }
        this._addGroupHeading(_("Selected sources"), format(
            ngettext("%d file", "%d files", model.sources.length),
            model.sources.length,
        ));
        for (const source of model.sources) {
            this._body.add_child(this._label(source.name, "xpuwlm-event-source", true));
        }
        return true;
    }

    _renderEventPreview(model) {
        this._addGroupHeading(_("Evidence-backed preview"), format(
            _("%d kept · %d rejected · %d undecided"),
            model.confirmed,
            model.rejected,
            model.pending,
        ));
        if (model.duplicatesDropped > 0) {
            this._body.add_child(this._label(format(
                ngettext("%d duplicate removed", "%d duplicates removed", model.duplicatesDropped),
                model.duplicatesDropped,
            ), "xpuwlm-event-dedup", true));
        }
        for (const candidate of model.candidates) {
            this._body.add_child(this._eventCandidate(candidate));
        }
        if (model.exportRefusal !== "") {
            this._body.add_child(this._label(model.exportRefusal, "xpuwlm-run-note", true));
        }
        return true;
    }

    _eventCandidate(candidate) {
        const card = this._box("xpuwlm-event-card", true);
        const fields = {
            title: this._entry(candidate.title, format(_("%s title"), candidate.title), `event-title:${candidate.candidateId}`),
            start: this._entry(candidate.start, format(_("%s start"), candidate.title), `event-start:${candidate.candidateId}`),
            end: this._entry(candidate.endText, format(_("%s end"), candidate.title), `event-end:${candidate.candidateId}`),
            timezone: this._entry(candidate.timezone, format(_("%s timezone"), candidate.title), `event-timezone:${candidate.candidateId}`),
            location: this._entry(candidate.locationText, format(_("%s location"), candidate.title), `event-location:${candidate.candidateId}`),
        };
        const labels = {
            title: _("Title"),
            start: _("Starts"),
            end: _("Ends"),
            timezone: _("Timezone"),
            location: _("Location"),
        };
        for (const [name, entry] of Object.entries(fields)) {
            const field = this._box("xpuwlm-event-field", true);
            field.add_child(this._label(labels[name], "xpuwlm-event-field-label"));
            field.add_child(entry);
            card.add_child(field);
        }
        for (const evidence of candidate.evidenceText) {
            card.add_child(this._label(evidence, "xpuwlm-event-evidence", true));
        }
        const controls = this._box("xpuwlm-event-controls");
        controls.add_child(this._eventEditButton(candidate, fields));
        controls.add_child(this._eventDecisionButton(candidate, "confirmed", _("Keep")));
        controls.add_child(this._eventDecisionButton(candidate, "rejected", _("Reject")));
        card.add_child(controls);
        return card;
    }

    _eventEditButton(candidate, fields) {
        const button = this._identify(this._button(
            "xpuwlm-secondary-button",
            format(_("Apply edits to %s"), candidate.title),
            () => this._actions.editEventCandidate(candidate.candidateId, {
                title: fields.title.get_text(),
                start: fields.start.get_text(),
                end: fields.end.get_text() === "" ? null : fields.end.get_text(),
                timezone: fields.timezone.get_text(),
                location: fields.location.get_text() === "" ? null : fields.location.get_text(),
            }),
        ), `event-edit:${candidate.candidateId}`);
        button.set_child(this._label(_("Apply edits"), "xpuwlm-button-label"));
        return button;
    }

    _eventDecisionButton(candidate, decision, label) {
        const selected = candidate.confirmation === decision;
        const button = this._identify(this._button(
            `xpuwlm-event-decision${selected ? " xpuwlm-event-decision-selected" : ""}`,
            format(_("%s %s"), label, candidate.title),
            () => this._actions.decideEventCandidate(candidate.candidateId, decision),
            "TOGGLE_BUTTON",
        ), `event-${decision}:${candidate.candidateId}`);
        this._setAccessibleState(button, "CHECKED", selected);
        button.set_child(this._label(label, "xpuwlm-button-label"));
        return button;
    }

    _renderEventConfirmation(model) {
        const confirmed = model.candidates.filter((candidate) => candidate.kept);
        this._addGroupHeading(_("Confirm calendar export"), format(
            ngettext("%d event will be written", "%d events will be written", confirmed.length),
            confirmed.length,
        ));
        this._body.add_child(this._label(
            _("No source file is changed or removed. The chosen output must be a new file."),
            "xpuwlm-event-confirmation",
            true,
        ));
        for (const candidate of confirmed) {
            this._body.add_child(this._label(
                `${candidate.title} · ${candidate.start}`,
                "xpuwlm-event-confirmed",
                true,
            ));
        }
        return true;
    }

    _renderEventActions(model) {
        const controls = this._box("xpuwlm-event-controls");
        if (["idle", "selected", "preview", "complete", "error"].includes(model.phase)) {
            controls.add_child(this._eventAction(
                _("Choose files"), _("Choose event source files"), "event-choose-files",
                this._actions.chooseEventFiles, model.chooserEnabled,
            ));
            controls.add_child(this._eventAction(
                _("Choose folder"), _("Choose one event source folder"), "event-choose-folder",
                this._actions.chooseEventFolder, model.chooserEnabled,
            ));
        }
        if (model.phase === "selected") {
            controls.add_child(this._eventAction(
                _("Extract events"), _("Extract events from selected files"), "event-start",
                this._actions.startEventImport, model.startEnabled,
            ));
        }
        if (model.cancelEnabled) {
            controls.add_child(this._eventAction(
                _("Cancel"), _("Cancel event extraction"), "event-cancel",
                this._actions.cancelEventImport, true,
            ));
        }
        if (model.phase === "preview") {
            controls.add_child(this._eventAction(
                _("Review export"), _("Review confirmed events before export"), "event-review-export",
                this._actions.beginEventExport, model.exportRefusal === "",
            ));
        }
        if (model.phase === "confirm-export") {
            controls.add_child(this._eventAction(
                _("Write calendar file"), _("Confirm and write a new calendar file"), "event-confirm-export",
                this._actions.confirmEventExport, true,
            ));
            controls.add_child(this._eventAction(
                _("Back"), _("Return to event preview"), "event-back-preview",
                this._actions.backEventPreview, true,
            ));
        }
        if (model.complete) {
            controls.add_child(this._eventAction(
                _("New import"), _("Start a new event import"), "event-reset",
                this._actions.resetEventImport, true,
            ));
        }
        this._body.add_child(controls);
        return true;
    }

    _eventAction(label, accessibleName, identity, action, enabled) {
        const button = this._identify(
            this._button("xpuwlm-secondary-button", accessibleName, action),
            identity,
        );
        button.set_child(this._label(label, "xpuwlm-button-label"));
        this._setButtonEnabled(button, enabled);
        return button;
    }

    // The runtime's input root is both the permission boundary and the way in:
    // a picture inside it is one the service will read, and a picture anywhere
    // else is one it refuses. So the root is the list, and there is no file
    // chooser to reconcile with a directory the service was never told about.
    _renderRun(run) {
        if (!run) {
            return false;
        }
        this._addSectionHeading(run.title, this._runSubtitle(run));
        this._renderJobOutcome(run.job);
        if (run.reason !== "") {
            this._body.add_child(this._label(run.reason, "xpuwlm-run-note", true));
            return false;
        }
        if (run.omitted > 0) {
            this._body.add_child(this._label(
                format(ngettext(
                    "%d more picture is not shown",
                    "%d more pictures are not shown",
                    run.omitted,
                ), run.omitted),
                "xpuwlm-run-note",
                true,
            ));
        }
        for (const profile of run.profiles) {
            this._addGroupHeading(profile.title, format(
                ngettext("%d picture", "%d pictures", run.pictures.length),
                run.pictures.length,
            ));
            for (const picture of run.pictures) {
                this._body.add_child(this._pictureRow(profile, picture));
            }
        }
        return true;
    }

    _runSubtitle(run) {
        return run.roots.length === 0
            ? _("No input directory")
            : run.roots.join(" · ");
    }

    _pictureRow(profile, picture) {
        const button = this._identify(
            this._button(
                "xpuwlm-run-row",
                format(_("Run %s on %s"), profile.title, picture.name),
                () => this._actions.submitJob(profile.id, picture),
            ),
            `run:${profile.id}:${picture.name}`,
        );
        button.set_child(this._label(picture.name, "xpuwlm-button-label", true));
        return button;
    }

    // One line, and it says which picture and which profile: a bare "accepted"
    // beside a list of pictures does not say which of them was accepted. The
    // state comes second because it is the part that changes — accepted is a
    // receipt, and only a terminal state is an outcome.
    _renderJobOutcome(job) {
        if (job === null || job === undefined) {
            return false;
        }
        this._body.add_child(this._label(
            `${job.title} · ${job.sourceName} — ${jobDetail(job)}`,
            `xpuwlm-job-outcome xpuwlm-job-${job.tone}`,
            true,
        ));
        this._renderReading(job.reading);
        return true;
    }

    // The answer the job was run for. Rendered as its own rows rather than
    // folded into the outcome line, because a list of candidates read as one
    // run-on sentence is a list nobody reads.
    _renderReading(reading) {
        if (reading === null || reading === undefined) {
            return false;
        }
        for (const entry of reading.entries) {
            this._body.add_child(this._label(entry, "xpuwlm-job-reading", true));
        }
        return true;
    }

    _renderBlockedProfiles(model) {
        const group = model.blockedGroup;
        if (group === null || group === undefined) {
            return false;
        }
        const disclosure = this._identify(
            this._button(
                "xpuwlm-disclosure",
                group.collapsedName,
                () => this._toggleBlockedProfiles(),
                "TOGGLE_BUTTON",
            ),
            "blocked-disclosure",
        );
        const row = this._box("xpuwlm-disclosure-row");
        const arrow = this._label("", "xpuwlm-disclosure-arrow");
        row.add_child(arrow);
        const copy = this._box("xpuwlm-profile-copy", true, true);
        const title = this._label(group.label, "xpuwlm-disclosure-title");
        copy.add_child(title);
        copy.add_child(this._label(group.summary, "xpuwlm-disclosure-summary", true));
        row.add_child(copy);
        disclosure.set_child(row);
        this._body.add_child(disclosure);
        const list = this._box("xpuwlm-disclosure-list", true);
        for (const profile of model.blockedProfiles) {
            list.add_child(this._profileRow(profile, true));
        }
        this._body.add_child(list);
        this._blocked = {arrow, disclosure, group, list, title};
        this._applyBlockedExpansion();
        return true;
    }

    // Guarded rather than assumed: flipping the flag with no group on screen
    // would leave the next screen that has one already open.
    _toggleBlockedProfiles() {
        if (this._blocked === null) {
            return false;
        }
        this._blockedExpanded = !this._blockedExpanded;
        return this._applyBlockedExpansion();
    }

    // Words, an arrow, and the ATK expanded state all say the same thing, so
    // the group never depends on the glyph alone to report whether it is open.
    _applyBlockedExpansion() {
        if (this._blocked === null) {
            return false;
        }
        const {arrow, disclosure, group, list, title} = this._blocked;
        const expanded = this._blockedExpanded;
        list.visible = expanded;
        arrow.set_text(expanded ? "▾" : "▸");
        title.set_text(group.label);
        disclosure.set_accessible_name(expanded ? group.expandedName : group.collapsedName);
        this._setAccessibleState(disclosure, "EXPANDED", expanded);
        setStyleClass(disclosure, "xpuwlm-disclosure-open", expanded);
        return expanded;
    }

    // The detail the collapsed group deliberately leaves out. Grouped by
    // remedy rather than by profile, because one package or one artifact
    // usually unblocks several profiles at once, and because two of the three
    // remedies are a command while the third is the absence of one.
    _renderSetup(model) {
        const setup = model.setup;
        this._addSectionHeading(setup.title, setup.summary);
        if (setup.resolved) {
            this._body.add_child(this._hero(
                "emblem-ok-symbolic",
                _("Ready"),
                _("Every workload profile can run"),
                _("The runtime resolved a model and an accelerator lane for each installed profile. There is nothing to install here."),
                "xpuwlm-hero-ok",
            ));
            return false;
        }
        for (const section of setup.sections) {
            this._renderSetupSection(section);
        }
        return true;
    }

    _renderSetupSection(section) {
        this._addGroupHeading(section.title, format(
            ngettext("%d profile", "%d profiles", section.profiles.length),
            section.profiles.length,
        ));
        this._body.add_child(this._label(section.description, "xpuwlm-setup-description", true));
        for (const profile of section.profiles) {
            const row = this._box("xpuwlm-setup-row");
            const copy = this._box("xpuwlm-profile-copy", true, true);
            copy.add_child(this._label(profile.title, "xpuwlm-profile-title", true));
            copy.add_child(this._label(profile.reason, "xpuwlm-profile-description", true));
            row.add_child(copy);
            this._body.add_child(row);
        }
        if (section.command !== "") {
            this._body.add_child(this._commandLabel(section.command));
        }
        if (section.note !== "") {
            this._body.add_child(this._label(section.note, "xpuwlm-setup-note", true));
        }
        return section.kind;
    }

    // A command the user has to retype is a command they will get wrong, and a
    // Copy button that did nothing would be exactly the dead control this
    // screen exists to remove. St offers no clipboard action here, so the text
    // is made selectable instead and Clutter's own selection copies it. It
    // always wraps: ellipsizing a command hides the argument that matters.
    _commandLabel(text) {
        const label = this._label(text, "xpuwlm-command", true);
        label.reactive = true;
        label.can_focus = true;
        if (label.clutter_text) {
            label.clutter_text.selectable = true;
            label.clutter_text.editable = false;
            label.clutter_text.line_wrap = true;
            label.clutter_text.ellipsize = 0;
        }
        return label;
    }

    _renderAlerts(model) {
        this._renderUnknownContent(model.unknownContent);
        if (model.activeAlerts.length === 0) {
            const hero = this._hero(
                "emblem-ok-symbolic",
                _("No active alerts"),
                _("You’re all caught up"),
                _("All monitored signals are within their review thresholds."),
                "xpuwlm-hero-ok",
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
                const row = this._box("xpuwlm-history-row");
                row.add_child(this._label("✓", "xpuwlm-history-mark"));
                const copy = this._box("xpuwlm-profile-copy", true, true);
                copy.add_child(this._label(alert.title, "xpuwlm-profile-title", true));
                copy.add_child(this._label(`${alert.profileTitle} · ${alert.age}`, "xpuwlm-profile-description", true));
                row.add_child(copy);
                row.add_child(this._label(_("Resolved"), "xpuwlm-status xpuwlm-status-ok"));
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
            "xpuwlm-hero-paused",
        ));
        const resume = this._identify(
            this._button("xpuwlm-primary-button xpuwlm-state-action", _("Resume all workloads"), this._actions.resumeAll),
            "resume-all",
        );
        resume.set_child(this._label(_("Resume all workloads"), "xpuwlm-button-label"));
        this._setButtonEnabled(resume, !this._controlPending);
        this._body.add_child(resume);
        this._addGroupHeading(_("Paused groups"), _("Safety rules remain active"));
        for (const group of model.allGroups) {
            const row = this._box("xpuwlm-state-row");
            const copy = this._box("xpuwlm-profile-copy", true, true);
            copy.add_child(this._label(group.name, "xpuwlm-profile-title", true));
            copy.add_child(this._label(
                format(ngettext("%d profile", "%d profiles", group.profiles.length), group.profiles.length),
                "xpuwlm-profile-description",
                true,
            ));
            row.add_child(copy);
            row.add_child(this._label(_("Paused"), "xpuwlm-status xpuwlm-status-watching"));
            this._body.add_child(row);
        }
    }

    _renderUnavailable(model) {
        this._body.add_child(this._hero(
            "dialog-warning-symbolic",
            model.recovery.kicker,
            model.recovery.title,
            model.recovery.description,
            "xpuwlm-hero-unavailable",
        ));
        for (const step of model.recovery.steps) {
            const row = this._box("xpuwlm-recovery-row");
            row.add_child(this._label(step.number, "xpuwlm-step-number"));
            const copy = this._box("xpuwlm-profile-copy", true, true);
            copy.add_child(this._label(step.title, "xpuwlm-profile-title", true));
            copy.add_child(this._label(step.description, "xpuwlm-profile-description", true));
            row.add_child(copy);
            this._body.add_child(row);
        }
        const retry = this._identify(
            this._button("xpuwlm-primary-button xpuwlm-state-action", _("Retry accelerator detection"), this._actions.refresh),
            "retry-detection",
        );
        retry.set_child(this._label(_("Retry detection"), "xpuwlm-button-label"));
        this._body.add_child(retry);
    }

    _profileRow(profile, editableWeight) {
        const inert = profile.executable === false;
        const row = this._box(
            `xpuwlm-profile-row${profile.enabled ? "" : " xpuwlm-profile-disabled"}`
            + `${inert ? " xpuwlm-profile-inert" : ""}`,
        );
        if (inert) {
            // The controls this row disables are non-reactive, so the pointer
            // falls through to the row: hovering the dead toggle still answers
            // why it is dead.
            row.reactive = true;
            this._tooltip(row, profile.executableText);
        }
        row.add_child(new this._St.Icon({
            icon_name: profile.icon,
            icon_type: this._St.IconType.SYMBOLIC,
            icon_size: 20,
            style_class: "xpuwlm-profile-icon",
        }));
        const copy = this._box("xpuwlm-profile-copy", true, true);
        const titleRow = this._box("xpuwlm-profile-title-row");
        titleRow.add_child(this._label(profile.title, "xpuwlm-profile-title", true));
        titleRow.add_child(this._label(_(ViewModel.STATUS_LABELS[profile.status]), `xpuwlm-status xpuwlm-status-${profile.status}`));
        copy.add_child(titleRow);
        const detail = profile.detail || profile.description;
        copy.add_child(this._label(`${detail} · ${format(_("%d queued"), profile.queued)}`, "xpuwlm-profile-description", true));
        if (inert) {
            copy.add_child(this._label(profile.executableText, "xpuwlm-profile-limitation", true));
        }
        row.add_child(copy);
        row.add_child(editableWeight
            ? this._weightControls(profile, inert)
            : this._label(format(_("Weight %d"), profile.weight), "xpuwlm-weight-summary"));
        row.add_child(this._profileToggle(profile, inert));
        return row;
    }

    _weightControls(profile, inert = false) {
        const controls = this._box("xpuwlm-weight-control");
        const down = this._identify(
            this._button("xpuwlm-weight-button", format(_("Decrease %s weight"), profile.title), () => this._actions.changeWeight(profile.id, -1)),
            `weight-down:${profile.id}`,
        );
        this._setButtonEnabled(down, this._policyControlEnabled(!inert && profile.weight > 1));
        down.set_child(this._label("−", "xpuwlm-button-label"));
        controls.add_child(down);
        controls.add_child(this._label(`${profile.weight}`, "xpuwlm-weight-value"));
        const up = this._identify(
            this._button("xpuwlm-weight-button", format(_("Increase %s weight"), profile.title), () => this._actions.changeWeight(profile.id, 1)),
            `weight-up:${profile.id}`,
        );
        this._setButtonEnabled(up, this._policyControlEnabled(!inert && profile.weight < 5));
        up.set_child(this._label("+", "xpuwlm-button-label"));
        controls.add_child(up);
        return controls;
    }

    // A weight the scheduler will never read, and an "on" that starts nothing,
    // are controls that do nothing. They stay visible, because the profile is
    // still part of the catalog, but they are insensitive and say why: the
    // reason is in the accessible name and in the row's tooltip.
    _profileToggle(profile, inert) {
        const name = format(profile.enabled ? _("Disable %s") : _("Enable %s"), profile.title);
        const toggle = this._identify(
            this._button(
                `xpuwlm-toggle${profile.enabled ? " xpuwlm-toggle-on" : ""}`,
                inert ? `${name} — ${profile.executableText}` : name,
                () => this._actions.toggleProfile(profile.id),
                "TOGGLE_BUTTON",
            ),
            `toggle:${profile.id}`,
        );
        this._setAccessibleState(toggle, "CHECKED", profile.enabled);
        this._setButtonEnabled(toggle, !inert && !this._controlPending);
        toggle.set_child(this._label(profile.enabled ? _("On") : _("Off"), "xpuwlm-toggle-label"));
        return toggle;
    }

    _alertCard(alert) {
        const card = this._box(`xpuwlm-alert-card xpuwlm-alert-${alert.severity}`, true);
        const heading = this._box("xpuwlm-alert-heading");
        const copy = this._box("xpuwlm-profile-copy", true, true);
        copy.add_child(this._label(`${alert.profileTitle} · ${alert.age}`, "xpuwlm-alert-kicker"));
        copy.add_child(this._label(alert.title, "xpuwlm-alert-title", true));
        heading.add_child(copy);
        heading.add_child(this._label(_(alert.severity), "xpuwlm-status xpuwlm-status-watching"));
        card.add_child(heading);
        card.add_child(this._label(alert.summary || _("No additional detail was supplied."), "xpuwlm-alert-summary", true));
        const singleColumn = this._layout.evidenceColumns === 1;
        const evidence = this._box("xpuwlm-evidence", singleColumn);
        for (const [label, value] of [[_("Risk"), alert.riskText], [_("Confidence"), alert.confidenceText]]) {
            const metric = this._box("xpuwlm-evidence-item", true, true);
            metric.add_child(this._label(label, "xpuwlm-metric-name"));
            metric.add_child(this._label(value, "xpuwlm-metric-value"));
            evidence.add_child(metric);
        }
        card.add_child(evidence);
        card.add_child(this._label(
            _("Safe by default · no write, shutdown, authorization, or backup policy changed"),
            "xpuwlm-safety-note",
        ));
        return card;
    }

    // Stated as words in the alerts screen, where the discarded alerts would
    // have appeared, so an alert that never arrives has a visible explanation
    // rather than only a line in the system log.
    _renderUnknownContent(notice) {
        if (notice === null || notice === undefined) {
            return false;
        }
        const heading = this._addSectionHeading(notice.title, notice.detail);
        heading.set_accessible_name(notice.accessibleName);
        return true;
    }

    _addSectionHeading(title, description) {
        const heading = this._box("xpuwlm-section-heading");
        const copy = this._box("xpuwlm-profile-copy", true, true);
        copy.add_child(this._label(title, "xpuwlm-section-title", true));
        copy.add_child(this._label(description, "xpuwlm-section-description", true));
        heading.add_child(copy);
        this._body.add_child(heading);
        return heading;
    }

    _addGroupHeading(title, value) {
        const heading = this._box("xpuwlm-group-heading");
        heading.add_child(this._label(title, "xpuwlm-group-title"));
        heading.add_child(this._label(value, "xpuwlm-group-value"));
        this._body.add_child(heading);
    }

    _hero(iconName, kicker, title, description, styleClass) {
        const hero = this._box(`xpuwlm-hero ${styleClass}`, true);
        hero.add_child(new this._St.Icon({
            icon_name: iconName,
            icon_type: this._St.IconType.SYMBOLIC,
            icon_size: 36,
            style_class: "xpuwlm-hero-icon",
        }));
        hero.add_child(this._label(kicker, "xpuwlm-hero-kicker"));
        hero.add_child(this._label(title, "xpuwlm-hero-title", true));
        hero.add_child(this._label(description, "xpuwlm-hero-description", true));
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

    _entry(text, accessibleName, identity) {
        const entry = new this._St.Entry({
            text: String(text || ""),
            style_class: "xpuwlm-event-entry",
            can_focus: true,
        });
        entry.set_accessible_name(accessibleName);
        return this._identify(entry, identity);
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
            this._focusedIdentity = button.xpuwlmIdentity === undefined
                ? null
                : button.xpuwlmIdentity;
        });
        return button;
    }

    _identify(actor, identity) {
        actor.xpuwlmIdentity = identity;
        return actor;
    }

    // Cinnamon tooltips destroy themselves with the actor they describe, so a
    // rebuilt body leaves none behind.
    _tooltip(actor, text) {
        if (this._tooltips === null || !text) {
            return null;
        }
        return this._tooltips(actor, text);
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
        setStyleClass(button, "xpuwlm-button-disabled", !enabled);
        this._setAccessibleState(button, "SENSITIVE", enabled);
    }

    _policyControlEnabled(enabled = true) {
        return !this._controlPending && enabled;
    }
}

module.exports = {
    jobDetail,
    MenuView,
    TAB_NAMES,
    destroyChildren,
    focusableControls,
    movedTabIndex,
    optionalAction,
    requireAction,
    setStyleClass,
    tabKeyMove,
};
