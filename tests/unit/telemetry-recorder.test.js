"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Diagnostics = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/diagnostics-view-model.js");
const Recorder = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/telemetry-recorder.js");

function recorder() {
    let elapsed = 0;
    const clock = () => {
        elapsed += 1000;
        return elapsed;
    };
    return new Recorder.TelemetryRecorder({clock});
}

function snapshot(overrides = {}) {
    return {
        metrics: {load: 42, queueDepth: 2, runningProfiles: 1},
        health: {runtime: "connected"},
        stale: false,
        ...overrides,
    };
}

test("nothing is recorded until the user turns the record on", () => {
    const subject = recorder();
    assert.equal(subject.consented(), false);
    assert.equal(subject.record(snapshot()), null);
    assert.deepEqual(subject.summary(), {
        consented: false, samples: 0, gaps: 0, retentionMs: Recorder.RETENTION_MS,
    });

    assert.equal(subject.setConsent(true), true);
    assert.equal(subject.setConsent(true), false, "already consented");
    assert.notEqual(subject.record(snapshot()), null);
    assert.equal(subject.summary().samples, 1);
});

// The whole point of the redactor is that consenting reveals nothing beyond
// the three figures the menu already shows.
test("only the three declared load figures are ever retained", () => {
    assert.deepEqual(Object.keys(Recorder.redactMetrics({
        load: 42,
        queueDepth: 2,
        runningProfiles: 1,
        hostname: "workstation",
        inputRoot: "/home/tester/pictures",
    })), ["load", "queue-depth", "running-profiles"]);

    assert.deepEqual(Recorder.redactMetrics({load: 42, queueDepth: 2, runningProfiles: 1}), {
        "load": 42,
        "queue-depth": 2,
        "running-profiles": 1,
    });
    assert.deepEqual(Recorder.redactMetrics(null), {
        "load": 0,
        "queue-depth": 0,
        "running-profiles": 0,
    });
    assert.deepEqual(Recorder.redactMetrics({load: Number.NaN, queueDepth: "2"}), {
        "load": 0,
        "queue-depth": 0,
        "running-profiles": 0,
    }, "a non-numeric figure is not smuggled through as text");
});

test("a snapshot the runtime could not produce is a recorded gap, not a silence", () => {
    assert.equal(Recorder.snapshotReason(snapshot()), null);
    assert.equal(Recorder.snapshotReason(snapshot({stale: true})), Recorder.STALE_REASON);
    assert.equal(
        Recorder.snapshotReason(snapshot({health: {runtime: "absent"}})),
        Recorder.UNAVAILABLE_REASON,
    );
    assert.equal(Recorder.snapshotReason({}), Recorder.UNAVAILABLE_REASON);

    const subject = recorder();
    subject.setConsent(true);
    subject.record(snapshot());
    subject.record(snapshot({health: {runtime: "absent"}}));
    subject.record(snapshot());

    const summary = subject.summary();
    assert.equal(summary.samples, 2);
    assert.equal(summary.gaps, 1, "the outage is evidence, not a missing reading");
});

test("a source stays lost until it recovers, so a gap is recorded once", () => {
    const subject = recorder();
    subject.setConsent(true);
    subject.record(snapshot({stale: true}));
    subject.record(snapshot({stale: true}));
    assert.equal(subject.summary().gaps, 2);

    // Recovery is implicit in the next good snapshot; without it the window
    // would refuse the capture outright.
    assert.notEqual(subject.record(snapshot()), null);
    assert.equal(subject.summary().samples, 1);
});

test("withdrawing consent clears what was kept rather than only stopping", () => {
    const subject = recorder();
    subject.setConsent(true);
    subject.record(snapshot());
    subject.record(snapshot());
    assert.equal(subject.summary().samples, 2);

    assert.equal(subject.setConsent(false), true);
    assert.deepEqual(subject.summary(), {
        consented: false, samples: 0, gaps: 0, retentionMs: Recorder.RETENTION_MS,
    });

    subject.setConsent(true);
    assert.equal(subject.summary().samples, 0, "consenting again starts an empty record");
});

test("a state that is not a snapshot is ignored instead of throwing", () => {
    const subject = recorder();
    subject.setConsent(true);
    assert.equal(subject.record(null), null);
    assert.equal(subject.record("snapshot"), null);
    assert.equal(subject.summary().samples, 0);
});

test("the default recorder reads elapsed time without being handed a clock", () => {
    const subject = new Recorder.TelemetryRecorder();
    subject.setConsent(true);
    assert.notEqual(subject.record(snapshot()), null);
    assert.equal(subject.summary().samples, 1);
});

test("an injected window is used rather than a second one being built", () => {
    const calls = [];
    const window = {
        consented: () => true,
        setConsent: (value) => calls.push(["consent", value]),
        capture: (...args) => calls.push(["capture", ...args]),
        markMissing: (...args) => calls.push(["missing", ...args]),
        recover: (...args) => calls.push(["recover", ...args]),
        replay: () => ({entries: [{kind: "sample"}, {kind: "missing"}, {kind: "recovered"}]}),
    };
    const subject = new Recorder.TelemetryRecorder({window});
    subject.setConsent(true);
    subject.record(snapshot());
    assert.deepEqual(calls[0], ["consent", true]);
    assert.deepEqual(calls[1], ["recover", Recorder.SOURCE_ID]);
    assert.deepEqual(subject.summary(), {
        consented: true, samples: 1, gaps: 1, retentionMs: Recorder.RETENTION_MS,
    });
});

test("the diagnostics row states what is kept, and for how long", () => {
    const off = Diagnostics.telemetryHealth({consented: false, samples: 0, gaps: 0, retentionMs: 0});
    assert.equal(off.status, "Off");
    assert.match(off.detail, /No load figures are being kept/u);
    assert.equal(off.tone, "healthy");

    const on = Diagnostics.telemetryHealth({
        consented: true, samples: 12, gaps: 0, retentionMs: Recorder.RETENTION_MS,
    });
    assert.equal(on.status, "12 readings");
    assert.match(on.detail, /Load, queue depth, and running profiles/u);
    assert.match(on.detail, /10 minutes/u);
    assert.equal(on.tone, "healthy");

    const singular = Diagnostics.telemetryHealth({
        consented: true, samples: 1, gaps: 2, retentionMs: 60_000,
    });
    assert.equal(singular.status, "1 reading");
    assert.match(singular.detail, /1 minute\./u);
    assert.equal(singular.tone, "attention", "recorded outages are worth surfacing");

    assert.equal(Diagnostics.telemetryHealth(null).status, "Off");
    assert.equal(Diagnostics.telemetryHealth("nonsense").status, "Off");
});

// Live regression: the health list carried the record but the copyable report
// did not, so the report could not answer whether anything was being kept.
test("the copyable diagnostics report states the record's status too", () => {
    const state = {
        device: {available: true, name: "AMD GPU", reason: ""},
        health: {device: "present", runtime: "connected", detail: ""},
        generatedAt: 1_700_000_000_000,
        attentionCount: 0,
        telemetry: {consented: true, samples: 5, gaps: 0, retentionMs: Recorder.RETENTION_MS},
    };
    const report = Diagnostics.diagnosticsReport(
        state,
        [],
        {activeCount: 0},
        {sections: []},
        {available: true},
        1_700_000_000_000,
    );
    assert.match(report, /Local load record: 5 readings/u);

    const off = Diagnostics.diagnosticsReport(
        {...state, telemetry: {consented: false, samples: 0, gaps: 0, retentionMs: 0}},
        [], {activeCount: 0}, {sections: []}, {available: true}, 1_700_000_000_000,
    );
    assert.match(off, /Local load record: Off/u);
});
