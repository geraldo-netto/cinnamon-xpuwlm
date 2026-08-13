"use strict";

class FakeTimer {
    constructor() {
        this._next = 1;
        this.tasks = new Map();
        this.cancelled = [];
    }

    schedule(delayMs, callback) {
        const handle = this._next++;
        this.tasks.set(handle, {delayMs, callback});
        return handle;
    }

    cancel(handle) {
        this.cancelled.push(handle);
        return this.tasks.delete(handle);
    }

    fireDelay(delayMs) {
        const found = [...this.tasks].find(([, task]) => task.delayMs === delayMs);
        if (found === undefined) {
            return false;
        }
        const [handle, task] = found;
        this.tasks.delete(handle);
        task.callback();
        return true;
    }

    count(delayMs) {
        return [...this.tasks.values()].filter((task) => task.delayMs === delayMs).length;
    }
}

function leasePort(log, release = () => {}) {
    return {
        acquire: async (context) => {
            log.push(["acquire", context.priority, context.id]);
            return {release: () => {
                log.push(["release", context.priority, context.id]);
                release(context);
            }};
        },
    };
}

async function drain(execution, timer) {
    for (let iteration = 0; iteration < 100; iteration += 1) {
        timer.fireDelay(0);
        await new Promise((resolve) => globalThis.setImmediate(resolve));
        const state = execution.state();
        if (state.activeBackgroundId === null
            && state.queuedIds.length === 0
            && state.dispatchPending === false) {
            break;
        }
    }
    await execution.idle();
}

module.exports = {FakeTimer, leasePort, drain};
