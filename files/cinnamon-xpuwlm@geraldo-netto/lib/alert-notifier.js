"use strict";

const FailureReporter = require("./failure-reporter.js");
const I18n = require("./i18n.js");

const {_, format} = I18n;

const CRITICAL_SEVERITY = "critical";
const NOTIFY_FAILURE = "critical-notify";

function requireNotificationPort(candidate) {
    if (!candidate || typeof candidate.notify !== "function") {
        throw new TypeError("A notification port with notify is required");
    }
    return candidate;
}

function profileTitle(profiles, profileId) {
    const profile = profiles.find((candidate) => candidate.id === profileId);
    return profile ? profile.title : _("Unknown profile");
}

function notificationMessage(alert, profiles = []) {
    return {
        summary: format(_("XPU critical alert — %s"), profileTitle(profiles, alert.profileId)),
        body: alert.summary ? `${alert.title}. ${alert.summary}` : alert.title,
    };
}

function activeCriticalAlerts(alerts) {
    return alerts.filter(
        (alert) => alert.severity === CRITICAL_SEVERITY && alert.resolved !== true,
    );
}

// One desktop notification per critical alert occurrence. An alert that stays
// active is never repeated; an alert that resolves or disappears is forgotten,
// so the same identity notifies again when it reappears.
class CriticalAlertNotifier {
    constructor({notifications, errorReporter, clock = Date}) {
        this._notifications = requireNotificationPort(notifications);
        this._errors = FailureReporter.requireFailureReporter(errorReporter, "notification error");
        if (!clock || typeof clock.now !== "function") {
            throw new TypeError("A clock with now is required");
        }
        this._clock = clock;
        this._notified = new Set();
    }

    observe(alerts, profiles = []) {
        const active = activeCriticalAlerts(alerts);
        const pending = active.filter((alert) => !this._notified.has(alert.id));
        const activeIds = new Set(active.map((alert) => alert.id));
        for (const id of this._notified) {
            if (!activeIds.has(id)) {
                this._notified.delete(id);
            }
        }
        const delivered = [];
        for (const alert of pending) {
            if (this._deliver(alert, profiles)) {
                this._notified.add(alert.id);
                delivered.push(alert);
            }
        }
        return delivered;
    }

    dispose() {
        if (this._notified.size === 0) {
            return false;
        }
        this._notified.clear();
        return true;
    }

    // A failing notification is reported once and left unmarked, so the next
    // observation retries instead of silently dropping a critical alert.
    _deliver(alert, profiles) {
        try {
            this._notifications.notify(notificationMessage(alert, profiles));
            this._errors.recover(NOTIFY_FAILURE);
            return true;
        } catch (error) {
            this._errors.report(
                NOTIFY_FAILURE,
                `Could not show a critical notification: ${error}`,
                this._clock.now(),
            );
            return false;
        }
    }
}

module.exports = {
    CRITICAL_SEVERITY,
    activeCriticalAlerts,
    CriticalAlertNotifier,
    NOTIFY_FAILURE,
    notificationMessage,
    profileTitle,
    requireNotificationPort,
};
