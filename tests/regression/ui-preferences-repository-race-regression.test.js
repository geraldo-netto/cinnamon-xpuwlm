"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Preferences = require(
    "../../files/cinnamon-xpuwlm@geraldo-netto/lib/ui-preferences-repository.js",
);

test("regression: portfolio and UI slices cannot replace each other with stale state", () => {
    const writes = [];
    const completions = [];
    const underlying = {
        load: () => ({
            portfolio: {paused: false, profiles: {first: {enabled: true, weight: 2}}},
            selectedTab: "overview",
            activityClearedAt: 0,
        }),
        save(state, callback) {
            writes.push(structuredClone(state));
            completions.push(callback);
            return true;
        },
    };
    const repositories = Preferences.partitionStateRepository(underlying);

    repositories.uiPreferences.save({selectedTab: "alerts", activityClearedAt: 42});
    repositories.portfolio.save({
        portfolio: {paused: true, profiles: {second: {enabled: false, weight: 3}}},
    });
    repositories.uiPreferences.save({selectedTab: "profiles", activityClearedAt: 84});

    assert.deepEqual(writes, [
        {
            portfolio: {paused: false, profiles: {first: {enabled: true, weight: 2}}},
            selectedTab: "alerts",
            activityClearedAt: 42,
        },
        {
            portfolio: {paused: true, profiles: {second: {enabled: false, weight: 3}}},
            selectedTab: "alerts",
            activityClearedAt: 42,
        },
        {
            portfolio: {paused: true, profiles: {second: {enabled: false, weight: 3}}},
            selectedTab: "profiles",
            activityClearedAt: 84,
        },
    ]);
    assert.equal(completions.every((callback) => callback === null), true);
});

test("regression: the UI repository preserves the exact composite file keys", () => {
    const stored = [];
    const repository = {
        load: () => null,
        save: (state) => stored.push(state),
    };
    const slices = Preferences.partitionStateRepository(repository);
    assert.deepEqual(slices.portfolio.load(), {portfolio: null});
    assert.deepEqual(slices.uiPreferences.load(), {
        selectedTab: null,
        activityClearedAt: null,
    });
    slices.uiPreferences.save({selectedTab: "setup", activityClearedAt: 7});
    assert.deepEqual(Object.keys(stored[0]).sort(), [
        "activityClearedAt", "portfolio", "selectedTab",
    ]);
    assert.equal(slices.portfolio.flush(), false);
    assert.throws(() => Preferences.partitionStateRepository(null), /repository/u);
});

test("regression: a failed composite read does not block a later preference repair", () => {
    const writes = [];
    const slices = Preferences.partitionStateRepository({
        load() { throw new Error("unreadable"); },
        save(state) { writes.push(state); },
    });
    assert.throws(() => slices.portfolio.load(), /unreadable/u);
    slices.uiPreferences.save({selectedTab: "overview", activityClearedAt: 0});
    assert.deepEqual(writes, [{
        portfolio: null,
        selectedTab: "overview",
        activityClearedAt: 0,
    }]);
});
