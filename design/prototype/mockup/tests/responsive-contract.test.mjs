import assert from "node:assert/strict";
import test from "node:test";

import * as Contract from "../responsive-contract.mjs";

test("contract resolves every supported screen and its selected tab", () => {
  const expectedTabs = {
    alerts: "alerts",
    clear: "alerts",
    overview: "overview",
    paused: "overview",
    profiles: "profiles",
    unavailable: "unavailable",
  };
  for (const screen of Contract.SCREEN_NAMES) {
    const state = Contract.resolvePrototypeState(`?screen=${screen}`);
    assert.equal(state.activeScreen, screen);
    assert.equal(state.tabScreen, expectedTabs[screen]);
    assert.equal(typeof state.screenLabel, "string");
    assert.equal(Object.isFrozen(state), true);
  }
});

test("contract resolves every explicit responsive reference layout", () => {
  for (const layout of Contract.LAYOUT_NAMES) {
    assert.equal(Contract.resolvePrototypeState(`?layout=${layout}`).activeLayout, layout);
  }
});

test("contract fails closed to the wide overview for unsupported input", () => {
  assert.deepEqual(Contract.resolvePrototypeState("?screen=missing&layout=folded"), {
    activeLayout: "wide",
    activeScreen: "overview",
    screenLabel: "overview",
    tabScreen: "overview",
  });
  assert.equal(Contract.resolvePrototypeState(null).activeScreen, "overview");
  assert.equal(Contract.resolvePrototypeState({toString: () => "screen=alerts"}).activeScreen, "overview");
  assert.equal(Contract.supportedValue("missing", Contract.LAYOUT_NAMES, "wide"), "wide");
  assert.equal(Contract.supportedValue("narrow", Contract.LAYOUT_NAMES, "wide"), "narrow");
});

test("fuzz: arbitrary query values cannot escape supported screens or layouts", () => {
  let seed = 0x58545055;
  for (let iteration = 0; iteration < 4_096; iteration += 1) {
    seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
    const query = `?screen=${seed.toString(36)}%20value&layout=${(seed ^ 0xa5a5a5a5).toString(36)}`;
    const state = Contract.resolvePrototypeState(query);
    assert.equal(Contract.SCREEN_NAMES.includes(state.activeScreen), true);
    assert.equal(Contract.LAYOUT_NAMES.includes(state.activeLayout), true);
    assert.equal(Contract.SCREEN_NAMES.includes(state.tabScreen), true);
  }
});
