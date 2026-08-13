"use strict";

const I18n = require("./i18n.js");

const {_, format, ngettext} = I18n;

class GenericWorkflowMenuView {
    _renderGenericWorkflowSurface(model) {
        if (model === null || model === undefined) {
            return false;
        }
        this._addSectionHeading(model.title, model.description);
        this._renderGenericUnavailable(model.unavailable);
        this._renderGenericConsent(model.consent);
        this._renderGenericProgress(model.progress);
        this._renderGenericWarning(model.warning);
        this._renderGenericResult(model.result, model.reviewOnly);
        this._renderGenericRetention(model.retention);
        this._renderGenericActions(model);
        return true;
    }

    _renderGenericUnavailable(unavailable) {
        if (!unavailable.visible) {
            return false;
        }
        this._addGroupHeading(_("Unavailable"), "");
        this._body.add_child(this._label(
            unavailable.detail || _("Required service, source, or hardware is unavailable"),
            "xpuwlm-run-note",
            true,
        ));
        return true;
    }

    _renderGenericConsent(consent) {
        if (!consent.visible) {
            return false;
        }
        const labels = {
            required: _("Consent required"),
            granted: _("Consent granted"),
            denied: _("Consent denied"),
            "not-required": _("Consent not required"),
        };
        this._addGroupHeading(_("Consent"), labels[consent.state]);
        this._body.add_child(this._label(
            consent.purpose, "xpuwlm-event-evidence", true,
        ));
        return true;
    }

    _renderGenericProgress(progress) {
        if (!progress.visible) {
            return false;
        }
        this._addGroupHeading(_("Progress"), progress.text);
        return true;
    }

    _renderGenericWarning(warning) {
        if (warning === "") {
            return false;
        }
        this._body.add_child(this._label(
            warning, "xpuwlm-control-feedback xpuwlm-control-error", true,
        ));
        return true;
    }

    _renderGenericResult(result, reviewOnly) {
        if (result === null) {
            return false;
        }
        this._addGroupHeading(
            reviewOnly ? _("Review result") : _("Result"),
            `${result.kind} · ${result.operationId}`,
        );
        if (reviewOnly) {
            this._body.add_child(this._label(
                _("Review only: no system action is performed from this result"),
                "xpuwlm-run-note",
                true,
            ));
        }
        for (const row of result.rows) {
            this._addGroupHeading(row.title, row.detail);
        }
        if (result.omitted > 0) {
            this._body.add_child(this._label(format(
                ngettext("%d additional evidence row omitted", "%d additional evidence rows omitted", result.omitted),
                result.omitted,
            ), "xpuwlm-run-note", true));
        }
        return true;
    }

    _renderGenericRetention(retention) {
        const count = format(
            ngettext("%d retained result", "%d retained results", retention.count),
            retention.count,
        );
        this._addGroupHeading(_("Retention"), count);
        this._body.add_child(this._label(
            retention.text, "xpuwlm-event-evidence", true,
        ));
        return true;
    }

    _renderGenericActions(model) {
        const controls = this._box("xpuwlm-event-controls");
        for (const action of model.actions) {
            const button = this._eventAction(
                action.label,
                action.label,
                `generic-${model.id}-${action.id}`,
                () => this._actions.dispatchGenericWorkflow(model.id, action.id, !action.pressed),
                action.enabled,
                action.id === "run-now" || action.id === "cancel",
            );
            if (action.id === "toggle-background") {
                this._setAccessibleRole(button, "TOGGLE_BUTTON");
                this._setAccessibleState(button, "CHECKED", action.pressed);
            }
            controls.add_child(button);
        }
        this._body.add_child(controls);
        return true;
    }
}

const GENERIC_RENDERER_NAMES = Object.freeze(
    Object.getOwnPropertyNames(GenericWorkflowMenuView.prototype)
        .filter((name) => name !== "constructor"),
);

function installGenericWorkflowRenderers(prototype) {
    for (const name of GENERIC_RENDERER_NAMES) {
        Object.defineProperty(
            prototype,
            name,
            Object.getOwnPropertyDescriptor(GenericWorkflowMenuView.prototype, name),
        );
    }
    return prototype;
}

module.exports = {
    GENERIC_RENDERER_NAMES,
    GenericWorkflowMenuView,
    installGenericWorkflowRenderers,
};
