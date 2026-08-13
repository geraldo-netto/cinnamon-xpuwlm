"use strict";

const TABS = Object.freeze(["overview", "profiles", "alerts", "setup"]);
const TAB_SET = new Set(TABS);
const STATE_SAVE_FAILURE = "state-save";

function sanitizeTab(value) {
    return TAB_SET.has(value) ? value : "overview";
}

function sanitizeActivityClearedAt(value) {
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function requireCompositeRepository(candidate) {
    if (!candidate || typeof candidate.load !== "function" || typeof candidate.save !== "function") {
        throw new TypeError("A profile repository with load/save is required");
    }
    return candidate;
}

function compositeState(candidate) {
    const source = candidate && typeof candidate === "object" ? candidate : {};
    return {
        portfolio: source.portfolio ?? null,
        selectedTab: source.selectedTab ?? null,
        activityClearedAt: source.activityClearedAt ?? null,
    };
}

// The on-disk document remains one atomic unit. Slice repositories share this
// cache so a preference write always carries the newest portfolio and a policy
// write always carries the newest preferences, even while an older write is
// still in flight in the file repository.
class CompositeStateCoordinator {
    constructor(repository) {
        this._repository = requireCompositeRepository(repository);
        this._state = null;
    }

    load() {
        if (this._state === null) {
            // Keep a writable baseline if the read throws. The manager still
            // reports that load failure, while a later user action may recover
            // by replacing the unreadable document with valid state.
            this._state = compositeState(null);
            this._state = compositeState(this._repository.load());
        }
        return {...this._state};
    }

    save(patch, callback = null) {
        this._state = {...this.load(), ...patch};
        return this._repository.save({...this._state}, callback);
    }

    flush() {
        return typeof this._repository.flush === "function"
            ? this._repository.flush()
            : false;
    }
}

class PortfolioStateRepository {
    constructor(coordinator) {
        this._coordinator = coordinator;
    }

    load() {
        return {portfolio: this._coordinator.load().portfolio};
    }

    save(state, callback = null) {
        return this._coordinator.save({portfolio: state.portfolio}, callback);
    }

    flush() {
        return this._coordinator.flush();
    }
}

class UiPreferencesRepository {
    constructor(coordinator) {
        this._coordinator = coordinator;
    }

    load() {
        const state = this._coordinator.load();
        return {
            selectedTab: state.selectedTab,
            activityClearedAt: state.activityClearedAt,
        };
    }

    save(preferences, callback = null) {
        return this._coordinator.save({
            selectedTab: preferences.selectedTab,
            activityClearedAt: preferences.activityClearedAt,
        }, callback);
    }
}

function partitionStateRepository(repository) {
    const coordinator = new CompositeStateCoordinator(repository);
    return {
        portfolio: new PortfolioStateRepository(coordinator),
        uiPreferences: new UiPreferencesRepository(coordinator),
    };
}

function persistState(repository, state, errorReporter, clock) {
    let completed = false;
    const completion = (error) => {
        completed = true;
        if (error) {
            errorReporter.report(
                STATE_SAVE_FAILURE,
                `Could not save applet state: ${error}`,
                clock.now(),
            );
        } else {
            errorReporter.recover(STATE_SAVE_FAILURE);
        }
    };
    try {
        const asynchronous = repository.save(state, completion);
        if (asynchronous !== true && !completed) {
            errorReporter.recover(STATE_SAVE_FAILURE);
        }
    } catch (error) {
        completion(error);
    }
}

module.exports = {
    CompositeStateCoordinator,
    PortfolioStateRepository,
    STATE_SAVE_FAILURE,
    TABS,
    UiPreferencesRepository,
    compositeState,
    partitionStateRepository,
    persistState,
    requireCompositeRepository,
    sanitizeActivityClearedAt,
    sanitizeTab,
};
