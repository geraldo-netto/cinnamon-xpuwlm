"use strict";

const I18n = require("./i18n.js");
const Layout = require("./layout.js");
const ViewModel = require("./view-model.js");

const {_, N_, format, ngettext} = I18n;

// Persisted identifiers stay compatible with earlier releases; labels and
// ordering now describe user goals instead of implementation structure.
const TAB_NAMES = Object.freeze(["overview", "alerts", "profiles", "setup"]);
const TAB_LABELS = Object.freeze({
    overview: N_("Tools"),
    alerts: N_("Activity"),
    profiles: N_("System"),
    setup: N_("Diagnostics"),
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

const IMMEDIATE_ACTION_SCHEDULER = Object.freeze({
    schedule(_delayMs, callback) {
        callback();
        return null;
    },
    cancel() {
        return false;
    },
});

function requireActionScheduler(candidate) {
    if (!candidate || typeof candidate.schedule !== "function"
            || typeof candidate.cancel !== "function") {
        throw new TypeError("A menu action scheduler with schedule/cancel is required");
    }
    return candidate;
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
    constructor({
        St, Clutter, Atk, menu, actions, layout, tooltips,
        actionScheduler = IMMEDIATE_ACTION_SCHEDULER,
    }) {
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
        this._actionScheduler = requireActionScheduler(actionScheduler);
        this._deferredActions = new Set();
        this._actions = {
            selectTab: requireAction(actions, "selectTab"),
            toggleProfile: requireAction(actions, "toggleProfile"),
            changeWeight: requireAction(actions, "changeWeight"),
            pauseAll: requireAction(actions, "pauseAll"),
            resumeAll: requireAction(actions, "resumeAll"),
            refresh: requireAction(actions, "refresh"),
            openSettings: requireAction(actions, "openSettings"),
            clearActivity: optionalAction(actions, "clearActivity"),
            openLogs: optionalAction(actions, "openLogs"),
            copyReport: optionalAction(actions, "copyReport"),
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
            chooseQuestionFiles: optionalAction(actions, "chooseQuestionFiles"),
            startDocumentQuestion: optionalAction(actions, "startDocumentQuestion"),
            cancelDocumentQuestion: optionalAction(actions, "cancelDocumentQuestion"),
            resetDocumentQuestion: optionalAction(actions, "resetDocumentQuestion"),
            startSelectedText: optionalAction(actions, "startSelectedText"),
            cancelSelectedText: optionalAction(actions, "cancelSelectedText"),
            resetSelectedText: optionalAction(actions, "resetSelectedText"),
            chooseOrganizerFiles: optionalAction(actions, "chooseOrganizerFiles"),
            startFileOrganizer: optionalAction(actions, "startFileOrganizer"),
            cancelFileOrganizer: optionalAction(actions, "cancelFileOrganizer"),
            resetFileOrganizer: optionalAction(actions, "resetFileOrganizer"),
        };
        this._policyPaused = false;
        this._controlPending = false;
        this._bodyKey = null;
        this._model = null;
        this._selectedTab = TAB_NAMES[0];
        this._detail = null;
        this._confirmClearHistory = false;
        this._diagnosticFeedback = "";
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
        this._subtitleLabel.set_text(model.headerSubtitle);
        this._renderCatalogNotice(model.catalogNotice);
        this._tabs.actor.visible = model.showTabs;
        if (this._selectedTab !== model.selectedTab) {
            this._detail = null;
            this._confirmClearHistory = false;
            this._diagnosticFeedback = "";
            this._bodyKey = null;
        }
        this._selectedTab = model.selectedTab;
        this._setScreenStyle(model.selectedTab);
        this._footer.visible = model.showTabs && model.selectedTab === "overview" && this._detail === null;
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
        this._cancelDeferredActions();
        this._root.destroy();
        this._root = null;
        this._bodyKey = null;
        this._model = null;
        this._focusedIdentity = null;
        this._detail = null;
        this._confirmClearHistory = false;
        this._diagnosticFeedback = "";
        return true;
    }

    _applyLayoutStyles() {
        this._root.set_style(`min-width: ${this._layout.widthPx}px; max-width: ${this._layout.widthPx}px;`);
        const viewport = `${this._layout.scrollHeightPx}px`;
        this._scroll.set_style(`min-height: ${viewport}; max-height: ${viewport};`);
        this._scrollContent.set_style(`min-height: ${viewport};`);
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
            icon_size: 28,
            style_class: "xpuwlm-brand-icon",
        }));
        const copy = this._box("xpuwlm-header-copy", true, true);
        const titleRow = this._box("xpuwlm-title-row");
        titleRow.add_child(this._label(_("XPU Workload Manager"), "xpuwlm-title"));
        copy.add_child(titleRow);
        this._subtitleLabel = this._label(_("Starting monitoring…"), "xpuwlm-subtitle", true);
        copy.add_child(this._subtitleLabel);
        header.add_child(copy);
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

    _buildTabs() {
        this._content = this._box("xpuwlm-content", true);
        this._root.add_child(this._content);
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
        this._content.add_child(row);
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
            y_fill: true,
            y_align: this._St.Align.START,
        });
        this._scroll.set_policy(this._St.PolicyType.NEVER, this._St.PolicyType.AUTOMATIC);
        this._scroll.set_auto_scrolling(true);
        this._scrollContent = this._box("xpuwlm-scroll-content", true, true);
        this._body = this._box("xpuwlm-body", true);
        this._body.y_expand = true;
        this._scrollContent.add_child(this._body);
        this._scroll.add_actor(this._scrollContent);
        this._content.add_child(this._scroll);
    }

    _buildFooter() {
        const footer = this._box("xpuwlm-footer", false, true);
        footer.add_child(this._box("xpuwlm-control-spacer", false, true));
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
        this._footer = footer;
        this._scrollContent.add_child(footer);
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
        } else if (this._detail !== null) {
            this._renderDetail(model);
        } else if (model.screen === "profiles") {
            this._renderSystem(model);
        } else if (model.screen === "alerts") {
            this._renderActivity(model);
        } else if (model.screen === "setup") {
            this._renderDiagnostics(model);
        } else {
            this._renderTools(model);
        }
    }

    _renderTools(model) {
        for (const tool of model.tools) {
            this._body.add_child(this._toolRow(tool));
        }
        return model.tools.length;
    }

    _toolRow(tool) {
        const button = this._identify(this._button(
            "xpuwlm-tool-row",
            format(_("%s, %s. %s"), tool.title, tool.status, tool.description),
            () => this._openDetail(tool.detail),
        ), `tool:${tool.id}`);
        const row = this._box("xpuwlm-tool-row-content", false, true);
        row.add_child(new this._St.Icon({
            icon_name: tool.icon,
            icon_type: this._St.IconType.SYMBOLIC,
            icon_size: 24,
            style_class: "xpuwlm-profile-icon",
        }));
        const copy = this._box("xpuwlm-profile-copy", true, true);
        copy.add_child(this._label(tool.title, "xpuwlm-profile-title", true));
        copy.add_child(this._label(tool.description, "xpuwlm-profile-description", true));
        row.add_child(copy);
        row.add_child(this._label(tool.status, `xpuwlm-status xpuwlm-status-${tool.statusTone}`));
        row.add_child(this._label("›", "xpuwlm-tool-chevron"));
        button.set_child(row);
        this._setButtonEnabled(button, tool.enabled);
        return button;
    }

    _openDetail(detail) {
        this._detail = detail;
        this._confirmClearHistory = false;
        this._bodyKey = null;
        if (this._model !== null) {
            this.render(this._model);
        }
        return detail;
    }

    _closeDetail() {
        if (this._detail === null) {
            return false;
        }
        this._detail = null;
        this._bodyKey = null;
        if (this._model !== null) {
            this.render(this._model);
        }
        return true;
    }

    _renderDetail(model) {
        const detail = this._detail;
        const back = this._identify(this._button(
            "xpuwlm-back-button",
            format(_("Back to %s"), _(TAB_LABELS[this._selectedTab])),
            () => this._closeDetail(),
        ), "detail-back");
        back.set_child(this._label(
            format(_("‹ %s"), _(TAB_LABELS[this._selectedTab])),
            "xpuwlm-button-label",
        ));
        this._body.add_child(back);
        if (detail === "documents") {
            return this._renderDocumentQuestion(model.documentQuestion);
        }
        if (detail === "events") {
            return this._renderEventImport(model.eventImport);
        }
        if (detail === "text") {
            return this._renderSelectedText(model.selectedText);
        }
        if (detail === "organizer") {
            return this._renderFileOrganizer(model.fileOrganizer);
        }
        if (detail === "picture") {
            return this._renderRun(model.run);
        }
        if (detail === "profiles") {
            return this._renderProfiles(model);
        }
        if (detail === "setup") {
            return this._renderSetupDetails(model);
        }
        return false;
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
                _("No workload profile can run on this machine yet. Open Diagnostics to see what each one needs."),
                "xpuwlm-empty-note",
                true,
            ));
        }
        this._renderBlockedProfiles(model);
        return true;
    }

    _renderFileOrganizer(model) {
        if (model === null || model === undefined) {
            return false;
        }
        this._addSectionHeading(
            model.title,
            _("Suggestions only: this applet never moves, renames, overwrites, or deletes files"),
        );
        this._renderFileOrganizerStatus(model);
        this._renderFileOrganizerSources(model);
        this._renderFileOrganizerPlan(model);
        this._renderFileOrganizerActions(model);
        return true;
    }

    _renderFileOrganizerStatus(model) {
        for (const [text, style] of [
            [model.message, "xpuwlm-event-message"],
            [model.progressText, "xpuwlm-event-progress"],
        ]) {
            if (text !== "") {
                this._body.add_child(this._label(text, style, true));
            }
        }
        if (!model.available && model.phase === "idle") {
            this._body.add_child(this._label(
                model.availabilityDetail || _("A qualified file-organizer provider is not configured"),
                "xpuwlm-run-note",
                true,
            ));
        }
        return true;
    }

    _renderFileOrganizerSources(model) {
        if (model.sources.length === 0) {
            return false;
        }
        this._addGroupHeading(_("Selected files for organization"), format(
            ngettext("%d file", "%d files", model.sources.length),
            model.sources.length,
        ));
        for (const source of model.sources) {
            this._body.add_child(this._label(source.name, "xpuwlm-event-source", true));
        }
        return true;
    }

    _renderFileOrganizerPlan(model) {
        if (!model.complete) {
            return false;
        }
        this._addGroupHeading(
            _("Review organization plan"),
            `${model.providerId} · ${model.accelerator.toUpperCase()}`,
        );
        for (const item of model.plan) {
            this._addGroupHeading(item.fileName, item.tagsText);
            for (const text of [item.nameText, item.folderText, item.duplicateText, item.reason]) {
                this._body.add_child(this._label(text, "xpuwlm-event-evidence", true));
            }
            for (const evidence of item.evidence) {
                this._body.add_child(this._label(evidence.text, "xpuwlm-event-evidence", true));
            }
        }
        return true;
    }

    _renderFileOrganizerActions(model) {
        const controls = this._box("xpuwlm-event-controls");
        if (["idle", "selected", "complete", "error"].includes(model.phase)) {
            controls.add_child(this._eventAction(
                _("Choose files"), _("Choose files for a review-only organization plan"),
                "organizer-choose-files", this._actions.chooseOrganizerFiles,
                model.chooserEnabled,
            ));
        }
        if (model.phase === "selected") {
            controls.add_child(this._eventAction(
                _("Create plan"), _("Suggest organization without changing files"),
                "organizer-start", this._actions.startFileOrganizer, model.startEnabled, true,
            ));
        }
        if (model.cancelEnabled) {
            controls.add_child(this._eventAction(
                _("Cancel"), _("Cancel file organization"), "organizer-cancel",
                this._actions.cancelFileOrganizer, true,
            ));
        }
        if (model.complete || model.phase === "error") {
            controls.add_child(this._eventAction(
                _("Clear"), _("Clear the review-only organization plan"), "organizer-reset",
                this._actions.resetFileOrganizer, true,
            ));
        }
        this._body.add_child(controls);
        return true;
    }

    _renderSelectedText(model) {
        if (model === null || model === undefined) {
            return false;
        }
        this._addSectionHeading(
            model.title,
            _("Reads the clipboard once only after an operation is chosen"),
        );
        this._renderSelectedTextStatus(model);
        if (model.operationEnabled) {
            this._renderSelectedTextOperations(model);
        }
        if (model.complete) {
            this._renderSelectedTextResult(model);
        }
        this._renderSelectedTextActions(model);
        return true;
    }

    _renderSelectedTextStatus(model) {
        for (const [text, style] of [
            [model.message, "xpuwlm-event-message"],
            [model.progressText, "xpuwlm-event-progress"],
        ]) {
            if (text !== "") {
                this._body.add_child(this._label(text, style, true));
            }
        }
        if (!model.available && model.phase === "idle") {
            this._body.add_child(this._label(
                model.availabilityDetail || _("A qualified selected-text provider is not configured"),
                "xpuwlm-run-note",
                true,
            ));
        }
        return true;
    }

    _renderSelectedTextActions(model) {
        const controls = this._box("xpuwlm-event-controls");
        if (model.cancelEnabled) {
            controls.add_child(this._eventAction(
                _("Cancel"), _("Cancel selected-text request"), "selected-text-cancel",
                this._actions.cancelSelectedText, true,
            ));
        }
        if (model.complete || model.phase === "error") {
            controls.add_child(this._eventAction(
                _("Clear"), _("Clear selected-text result"), "selected-text-reset",
                this._actions.resetSelectedText, true,
            ));
        }
        this._body.add_child(controls);
        return true;
    }

    _renderSelectedTextOperations(model) {
        const controls = this._box("xpuwlm-event-controls");
        for (const [operation, label] of [
            ["explain", _("Explain")],
            ["summarize", _("Summarize")],
            ["rewrite", _("Rewrite")],
            ["extract-tasks", _("Extract tasks")],
        ]) {
            controls.add_child(this._eventAction(
                label,
                format(_("%s the explicit clipboard selection"), label),
                `selected-text-${operation}`,
                () => this._actions.startSelectedText(operation, null),
                model.operationEnabled,
            ));
        }
        this._body.add_child(controls);
        const translation = this._box("xpuwlm-event-controls");
        const language = this._entry("", _("Translation target language"), "selected-text-language");
        translation.add_child(language);
        translation.add_child(this._eventAction(
            _("Translate"), _("Translate the explicit clipboard selection"), "selected-text-translate",
            () => this._actions.startSelectedText("translate", language.get_text()),
            model.operationEnabled,
        ));
        this._body.add_child(translation);
        return true;
    }

    _renderSelectedTextResult(model) {
        this._addGroupHeading(
            _("Review result"),
            `${model.providerId} · ${model.accelerator.toUpperCase()}`,
        );
        this._body.add_child(this._label(model.result, "xpuwlm-event-confirmation", true));
        if (model.tasks.length > 0) {
            this._addGroupHeading(_("Extracted tasks"), format(
                ngettext("%d suggestion", "%d suggestions", model.tasks.length),
                model.tasks.length,
            ));
            for (const task of model.tasks) {
                this._body.add_child(this._label(task, "xpuwlm-event-evidence", true));
            }
        }
        this._body.add_child(this._label(model.evidenceText, "xpuwlm-event-evidence", true));
        return true;
    }

    _renderDocumentQuestion(model) {
        if (model === null || model === undefined) {
            return false;
        }
        this._addSectionHeading(
            model.title,
            _("Only chosen files and this one question reach the isolated workers"),
        );
        this._renderDocumentQuestionStatus(model);
        this._renderDocumentQuestionSources(model);
        const question = this._documentQuestionEntry(model);
        this._renderDocumentQuestionResult(model);
        this._renderDocumentQuestionActions(model, question);
        return true;
    }

    _renderDocumentQuestionStatus(model) {
        for (const [text, style] of [
            [model.message, "xpuwlm-event-message"],
            [model.progressText, "xpuwlm-event-progress"],
        ]) {
            if (text !== "") {
                this._body.add_child(this._label(text, style, true));
            }
        }
    }

    _renderDocumentQuestionSources(model) {
        if (model.sources.length === 0) {
            return false;
        }
        this._addGroupHeading(_("Selected documents"), format(
            ngettext("%d file", "%d files", model.sources.length),
            model.sources.length,
        ));
        for (const source of model.sources) {
            this._body.add_child(this._label(source.name, "xpuwlm-event-source", true));
        }
        return true;
    }

    _documentQuestionEntry(model) {
        if (model.phase !== "selected") {
            return null;
        }
        const entry = this._entry("", _("Question for selected documents"), "document-question-input");
        this._body.add_child(entry);
        return entry;
    }

    _renderDocumentQuestionResult(model) {
        if (!model.complete) {
            return false;
        }
        this._addGroupHeading(_("Grounded answer"), `${model.providerId} · ${model.accelerator.toUpperCase()}`);
        this._body.add_child(this._label(model.answer, "xpuwlm-event-confirmation", true));
        for (const citation of model.citations) {
            this._body.add_child(this._label(citation.text, "xpuwlm-event-evidence", true));
        }
        return true;
    }

    _renderDocumentQuestionActions(model, question) {
        const controls = this._box("xpuwlm-event-controls");
        if (["idle", "selected", "complete", "error"].includes(model.phase)) {
            controls.add_child(this._eventAction(
                _("Choose files"), _("Choose documents for one question"), "question-choose-files",
                this._actions.chooseQuestionFiles, model.chooserEnabled,
            ));
        }
        if (question !== null) {
            controls.add_child(this._eventAction(
                _("Ask"), _("Ask the explicit question over selected documents"), "question-start",
                () => this._actions.startDocumentQuestion(question.get_text()), model.askEnabled, true,
            ));
        }
        if (model.cancelEnabled) {
            controls.add_child(this._eventAction(
                _("Cancel"), _("Cancel document question"), "question-cancel",
                this._actions.cancelDocumentQuestion, true,
            ));
        }
        if (model.complete) {
            controls.add_child(this._eventAction(
                _("New question"), _("Clear this answer and start again"), "question-reset",
                this._actions.resetDocumentQuestion, true,
            ));
        }
        this._body.add_child(controls);
        return true;
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
                this._actions.startEventImport, model.startEnabled, true,
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
                this._actions.beginEventExport, model.exportRefusal === "", true,
            ));
        }
        if (model.phase === "confirm-export") {
            controls.add_child(this._eventAction(
                _("Write calendar file"), _("Confirm and write a new calendar file"), "event-confirm-export",
                this._actions.confirmEventExport, true, true,
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

    _eventAction(label, accessibleName, identity, action, enabled, primary = false) {
        const button = this._identify(
            this._button(
                primary ? "xpuwlm-primary-button" : "xpuwlm-secondary-button",
                accessibleName,
                action,
            ),
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

    _focusBlockedDisclosure() {
        if (this._blocked === null) {
            return false;
        }
        this._blockedExpanded = true;
        this._applyBlockedExpansion();
        const {disclosure} = this._blocked;
        if (typeof disclosure.grab_key_focus === "function") {
            disclosure.grab_key_focus();
        }
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
    _renderSetupDetails(model) {
        const setup = model.setup;
        const toolSetup = model.diagnostics.toolSetup;
        const resolved = setup.resolved && toolSetup.length === 0;
        this._addSectionHeading(
            resolved ? setup.title : _("What needs setup"),
            model.diagnostics.setupSummary,
        );
        if (resolved) {
            this._body.add_child(this._hero(
                "emblem-ok-symbolic",
                _("Ready"),
                _("Every workload profile can run"),
                _("The runtime resolved a model and an accelerator lane for each installed profile. There is nothing to install here."),
                "xpuwlm-hero-ok",
            ));
            return false;
        }
        if (toolSetup.length > 0) {
            this._addGroupHeading(
                _("Unavailable tools"),
                format(ngettext("%d tool", "%d tools", toolSetup.length), toolSetup.length),
            );
            for (const tool of toolSetup) {
                this._body.add_child(this._statusRow(tool));
            }
        }
        for (const section of setup.sections) {
            this._renderSetupSection(section);
        }
        return true;
    }

    // Compatibility for callers that exercise this focused renderer directly.
    _renderSetup(model) {
        return this._renderSetupDetails(model);
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

    _renderActivity(model) {
        this._addSectionHeading(_("Activity"), _("Jobs, results, and alerts"));
        this._renderRunningActivity(model.activity);
        this._renderRecentActivity(model);
        this._renderActivityControls(model.activity.canClear || model.resolvedAlerts.length > 0);
        return true;
    }

    _renderRunningActivity(activity) {
        if (activity.running.length === 0) {
            const card = this._box("xpuwlm-running-card", true);
            card.add_child(this._label(_("Running now"), "xpuwlm-profile-title"));
            const empty = this._box("xpuwlm-running-empty", false, true);
            empty.add_child(new this._St.Icon({
                icon_name: "emblem-ok-symbolic",
                icon_type: this._St.IconType.SYMBOLIC,
                icon_size: 28,
                style_class: "xpuwlm-healthy-icon",
            }));
            const copy = this._box("xpuwlm-profile-copy", true, true);
            copy.add_child(this._label(_("No active jobs"), "xpuwlm-hero-title", true));
            copy.add_child(this._label(
                _("Start a tool when you are ready"),
                "xpuwlm-hero-description",
                true,
            ));
            empty.add_child(copy);
            card.add_child(empty);
            this._body.add_child(card);
            return false;
        }
        this._addGroupHeading(
            _("Running now"),
            format(ngettext("%d active job", "%d active jobs", activity.activeCount), activity.activeCount),
        );
        for (const item of activity.running) {
            this._body.add_child(this._activityRow(item));
        }
        this._body.add_child(this._activityPauseButton());
        return true;
    }

    _activityPauseButton() {
        const pause = this._identify(this._button(
            "xpuwlm-secondary-button",
            _("Pause all workloads"),
            this._actions.pauseAll,
        ), "activity-pause");
        pause.set_child(this._label(_("Pause all"), "xpuwlm-button-label"));
        this._setButtonEnabled(pause, !this._controlPending);
        return pause;
    }

    _renderRecentActivity(model) {
        this._addGroupHeading(_("Recent"), `${model.activity.recent.length + model.activeAlerts.length + model.resolvedAlerts.length}`);
        for (const item of model.activity.recent) {
            this._body.add_child(this._activityRow(item));
        }
        this._renderUnknownContent(model.unknownContent);
        for (const alert of model.activeAlerts) {
            this._body.add_child(this._alertCard(alert));
        }
        for (const alert of model.resolvedAlerts.slice(0, 5)) {
            this._body.add_child(this._activityRow({
                id: `alert:${alert.id}`,
                title: alert.title,
                detail: `${alert.profileTitle} · ${alert.age}`,
                status: _("Resolved"),
                tone: "healthy",
            }));
        }
        const recentCount = model.activity.recent.length
            + model.activeAlerts.length + model.resolvedAlerts.length;
        if (recentCount === 0) {
            this._body.add_child(this._label(_("No recent activity"), "xpuwlm-empty-note", true));
        }
        return true;
    }

    _activityRow(item) {
        const row = this._box("xpuwlm-history-row");
        row.add_child(new this._St.Icon({
            icon_name: this._activityIcon(item),
            icon_type: this._St.IconType.SYMBOLIC,
            icon_size: 24,
            style_class: `xpuwlm-row-icon xpuwlm-row-icon-${item.tone}`,
        }));
        const copy = this._box("xpuwlm-profile-copy", true, true);
        copy.add_child(this._label(item.title, "xpuwlm-profile-title", true));
        copy.add_child(this._label(item.detail, "xpuwlm-profile-description", true));
        row.add_child(copy);
        row.add_child(this._label(item.status, `xpuwlm-status xpuwlm-status-${item.tone}`));
        return row;
    }

    _activityIcon(item) {
        const identity = String(item.id || "");
        if (identity.includes("event")) {
            return "x-office-calendar-symbolic";
        }
        if (identity.includes("picture")) {
            return "image-x-generic-symbolic";
        }
        if (identity.includes("organizer")) {
            return "folder-symbolic";
        }
        if (identity.includes("text")) {
            return "edit-select-all-symbolic";
        }
        return "folder-documents-symbolic";
    }

    _renderActivityControls(canClear) {
        if (this._confirmClearHistory) {
            const confirmation = this._box("xpuwlm-confirmation", true);
            confirmation.add_child(this._label(_("Clear recent activity?"), "xpuwlm-profile-title"));
            confirmation.add_child(this._label(
                _("Running jobs and runtime alerts are not stopped or dismissed."),
                "xpuwlm-profile-description",
                true,
            ));
            const controls = this._box("xpuwlm-event-controls");
            controls.add_child(this._eventAction(
                _("Cancel"), _("Cancel clearing activity history"), "clear-history-cancel",
                () => this._setClearConfirmation(false), true,
            ));
            controls.add_child(this._eventAction(
                _("Clear History"), _("Confirm clearing recent activity history"), "clear-history-confirm",
                () => this._clearActivity(), true, true,
            ));
            confirmation.add_child(controls);
            this._body.add_child(confirmation);
            return true;
        }
        const controls = this._box("xpuwlm-event-controls");
        const clear = this._eventAction(
            _("Clear History"), _("Clear recent activity history"), "clear-history",
            () => this._setClearConfirmation(true), canClear,
        );
        controls.add_child(clear);
        controls.add_child(this._box("xpuwlm-control-spacer", false, true));
        const refresh = this._eventAction(
            _("Refresh"), _("Refresh activity"), "activity-refresh", this._actions.refresh, true,
        );
        controls.add_child(refresh);
        controls.add_style_class_name("xpuwlm-activity-controls");
        controls.x_expand = true;
        this._body.add_child(controls);
        return true;
    }

    _setClearConfirmation(visible) {
        this._confirmClearHistory = visible === true;
        this._bodyKey = null;
        if (this._model !== null) {
            this.render(this._model);
        }
        return this._confirmClearHistory;
    }

    _clearActivity() {
        const cleared = this._actions.clearActivity();
        this._confirmClearHistory = false;
        this._bodyKey = null;
        if (this._model !== null) {
            this.render(this._model);
        }
        return cleared;
    }

    _renderSystem(model) {
        this._addSectionHeading(_("System"), "");
        this._addGroupHeading(_("Status"), "");
        for (const status of model.system.statuses) {
            this._body.add_child(this._statusRow(status));
        }
        this._addGroupHeading(_("Configuration"), "");
        const profiles = this._identify(this._button(
            "xpuwlm-tool-row",
            _("Open advanced workload profiles"),
            () => this._openDetail("profiles"),
        ), "system-profiles");
        const row = this._box("xpuwlm-tool-row-content", false, true);
        row.add_child(new this._St.Icon({
            icon_name: "xpuwlm-sliders-symbolic",
            icon_type: this._St.IconType.SYMBOLIC,
            icon_size: 24,
            style_class: "xpuwlm-row-icon",
        }));
        const copy = this._box("xpuwlm-profile-copy", true, true);
        copy.add_child(this._label(_("Advanced workload profiles"), "xpuwlm-profile-title"));
        copy.add_child(this._label(
            _("Enable, disable, and tune profile weights"),
            "xpuwlm-profile-description",
            true,
        ));
        row.add_child(copy);
        row.add_child(this._label("›", "xpuwlm-tool-chevron"));
        profiles.set_child(row);
        this._body.add_child(profiles);
        return true;
    }

    _statusRow(status) {
        const row = this._box("xpuwlm-state-row");
        if (status.icon) {
            row.add_child(new this._St.Icon({
                icon_name: status.icon,
                icon_type: this._St.IconType.SYMBOLIC,
                icon_size: 24,
                style_class: "xpuwlm-row-icon",
            }));
        }
        const copy = this._box("xpuwlm-profile-copy", true, true);
        copy.add_child(this._label(status.title, "xpuwlm-profile-title", true));
        copy.add_child(this._label(status.detail, "xpuwlm-profile-description", true));
        row.add_child(copy);
        row.add_child(this._label(status.status, `xpuwlm-status xpuwlm-status-${status.tone}`));
        return row;
    }

    _renderDiagnostics(model) {
        this._addSectionHeading(_("Diagnostics"), _("Live runtime and device information"));
        this._addGroupHeading(_("Health"), "");
        for (const status of model.diagnostics.health) {
            this._body.add_child(this._statusRow(status));
        }
        this._addGroupHeading(_("Setup"), "");
        const setup = this._identify(this._button(
            "xpuwlm-tool-row",
            format(_("Open setup details, %s"), model.diagnostics.setupStatus),
            () => this._openDetail("setup"),
        ), "diagnostics-setup");
        const setupRow = this._box("xpuwlm-tool-row-content", false, true);
        setupRow.add_child(new this._St.Icon({
            icon_name: "package-x-generic-symbolic",
            icon_type: this._St.IconType.SYMBOLIC,
            icon_size: 24,
            style_class: "xpuwlm-row-icon",
        }));
        const setupCopy = this._box("xpuwlm-profile-copy", true, true);
        setupCopy.add_child(this._label(
            format(_("Needs setup (%d)"), model.diagnostics.setupCount),
            "xpuwlm-profile-title",
        ));
        setupCopy.add_child(this._label(
            model.diagnostics.setupSummary,
            "xpuwlm-profile-description",
            true,
        ));
        setupRow.add_child(setupCopy);
        setupRow.add_child(this._label(
            model.diagnostics.setupStatus,
            `xpuwlm-status xpuwlm-status-${model.diagnostics.setupCount === 0 ? "healthy" : "watching"}`,
        ));
        setupRow.add_child(this._label("›", "xpuwlm-tool-chevron"));
        setup.set_child(setupRow);
        this._body.add_child(setup);
        this._addGroupHeading(_("Current state"), "");
        const current = this._box("xpuwlm-diagnostics-current", true);
        for (const item of model.diagnostics.current) {
            const metric = this._box("xpuwlm-diagnostics-metric");
            const name = this._label(item.label, "xpuwlm-metric-name");
            name.x_expand = true;
            metric.add_child(name);
            metric.add_child(this._label(item.value, "xpuwlm-metric-value"));
            current.add_child(metric);
        }
        this._body.add_child(current);
        this._addGroupHeading(_("Recent issues"), `${model.diagnostics.issues.length}`);
        if (model.diagnostics.issues.length === 0) {
            const healthy = this._box("xpuwlm-healthy-card");
            healthy.add_child(new this._St.Icon({
                icon_name: "emblem-ok-symbolic",
                icon_type: this._St.IconType.SYMBOLIC,
                icon_size: 24,
                style_class: "xpuwlm-healthy-icon",
            }));
            const copy = this._box("xpuwlm-profile-copy", true, true);
            copy.add_child(this._label(_("No problems detected"), "xpuwlm-profile-title", true));
            copy.add_child(this._label(
                _("Runtime and device are responding normally"),
                "xpuwlm-profile-description",
                true,
            ));
            healthy.add_child(copy);
            this._body.add_child(healthy);
        } else {
            for (const alert of model.diagnostics.issues) {
                this._body.add_child(this._alertCard(alert));
            }
        }
        if (this._diagnosticFeedback !== "") {
            this._body.add_child(this._label(
                this._diagnosticFeedback,
                "xpuwlm-control-feedback xpuwlm-control-pending",
                true,
            ));
        }
        this._body.add_child(this._diagnosticsActions(model.diagnostics.report));
        return true;
    }

    _diagnosticsActions(report) {
        const controls = this._box("xpuwlm-event-controls");
        controls.add_style_class_name("xpuwlm-diagnostics-actions");
        controls.x_expand = true;
        const openLogs = this._eventAction(
            _("Open logs"), _("Open workload service logs"), "diagnostics-logs",
            () => this._openLogs(), true,
        );
        const copyReport = this._eventAction(
            _("Copy report"), _("Copy diagnostics report"), "diagnostics-copy",
            () => this._copyReport(report), true,
        );
        const refresh = this._eventAction(
            _("Refresh"), _("Refresh diagnostics"), "diagnostics-refresh", this._actions.refresh, true,
        );
        for (const action of [openLogs, copyReport, refresh]) {
            action.x_expand = true;
            controls.add_child(action);
        }
        return controls;
    }

    _openLogs() {
        const opened = this._actions.openLogs();
        this._diagnosticFeedback = opened === false ? _("Could not open logs") : _("Logs opened");
        this._bodyKey = null;
        if (this._model !== null) {
            this.render(this._model);
        }
        return opened;
    }

    _copyReport(report) {
        const copied = this._actions.copyReport(report);
        this._diagnosticFeedback = copied === false ? _("Could not copy report") : _("Report copied");
        this._bodyKey = null;
        if (this._model !== null) {
            this.render(this._model);
        }
        return copied;
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
        if (model.policyPaused) {
            const resume = this._identify(
                this._button(
                    "xpuwlm-secondary-button xpuwlm-state-action",
                    _("Resume all workloads"),
                    this._actions.resumeAll,
                ),
                "resume-all",
            );
            resume.set_child(this._label(_("Resume all workloads"), "xpuwlm-button-label"));
            this._setButtonEnabled(resume, !this._controlPending);
            this._body.add_child(resume);
        }
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
        if (description) {
            copy.add_child(this._label(description, "xpuwlm-section-description", true));
        }
        heading.add_child(copy);
        this._body.add_child(heading);
        return heading;
    }

    _addGroupHeading(title, value) {
        const heading = this._box("xpuwlm-group-heading");
        const titleLabel = this._label(title, "xpuwlm-group-title");
        titleLabel.x_expand = true;
        heading.add_child(titleLabel);
        heading.add_child(this._label(value, "xpuwlm-group-value"));
        this._body.add_child(heading);
    }

    _setScreenStyle(screen) {
        for (const name of TAB_NAMES) {
            this._root.remove_style_class_name(`xpuwlm-screen-${name}`);
        }
        this._root.add_style_class_name(`xpuwlm-screen-${screen}`);
        return screen;
    }

    _hero(iconName, kicker, title, description, styleClass) {
        const hero = this._box(`xpuwlm-hero ${styleClass}`, true);
        hero.add_child(new this._St.Icon({
            icon_name: iconName,
            icon_type: this._St.IconType.SYMBOLIC,
            icon_size: 36,
            style_class: "xpuwlm-hero-icon",
            x_align: this._Clutter.ActorAlign.CENTER,
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
            x_fill: true,
        });
        button.set_accessible_name(accessibleName);
        this._setAccessibleRole(button, role);
        button.xpuwlmActionPending = false;
        button.connect("clicked", () => this._deferAction(button, callback));
        button.connect("key-focus-in", () => {
            this._focusedIdentity = button.xpuwlmIdentity === undefined
                ? null
                : button.xpuwlmIdentity;
        });
        return button;
    }

    // A callback commonly publishes state and rebuilds the body containing its
    // own button. Running it inside St.Button's `clicked` emission re-enters
    // Clutter actor teardown before Cinnamon has finished dispatching the
    // signal. One main-loop turn lets dispatch unwind first; the per-button
    // latch also collapses a double activation before that turn arrives.
    _deferAction(button, callback) {
        if (this._root === null || button.xpuwlmActionPending === true) {
            return false;
        }
        button.xpuwlmActionPending = true;
        let handle = null;
        const run = () => {
            if (handle !== null) {
                this._deferredActions.delete(handle);
            }
            button.xpuwlmActionPending = false;
            if (this._root === null) {
                return false;
            }
            callback();
            return false;
        };
        try {
            handle = this._actionScheduler.schedule(0, run);
        } catch (error) {
            button.xpuwlmActionPending = false;
            throw error;
        }
        if (handle !== null && button.xpuwlmActionPending) {
            this._deferredActions.add(handle);
        }
        return true;
    }

    _cancelDeferredActions() {
        const handles = [...this._deferredActions];
        this._deferredActions.clear();
        for (const handle of handles) {
            this._actionScheduler.cancel(handle);
        }
        return handles.length;
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
    IMMEDIATE_ACTION_SCHEDULER,
    jobDetail,
    MenuView,
    TAB_NAMES,
    destroyChildren,
    focusableControls,
    movedTabIndex,
    optionalAction,
    requireActionScheduler,
    requireAction,
    setStyleClass,
    tabKeyMove,
};
