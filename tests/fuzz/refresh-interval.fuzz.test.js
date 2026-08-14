"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Cinnamon = require("../../files/cinnamon-xpuwlm@geraldo-netto/lib/cinnamon-runtime.js");

function settingsOf(value) {
    const writes = [];
    return {
        writes,
        getValue: () => value,
        setValue(key, next) {
            writes.push([key, next]);
            value = next;
        },
    };
}

function environmentOf(paths) {
    return {
        GLib: {
            get_home_dir: () => "/home/fuzz",
            get_user_config_dir: () => "/home/fuzz/.config",
        },
        Gio: {
            File: {
                new_for_path: (path) => ({query_exists: () => paths.has(path)}),
            },
        },
    };
}

test("fuzz: refresh restoration accepts exactly the bounded integer contract", () => {
    let seed = 0x58505552;
    for (let iteration = 0; iteration < 8_192; iteration += 1) {
        seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
        const candidate = (seed % 92) - 15;
        const current = 1 + ((seed >>> 8) % 60);
        const expected = candidate >= 1 && candidate <= 60;
        const projected = Cinnamon.migratedIdentitySettings({
            "refresh-interval": {value: candidate},
        });
        assert.deepEqual(
            projected,
            expected ? {"refresh-interval": candidate} : {},
        );

        const settings = settingsOf(current);
        assert.equal(
            Cinnamon.restoreCurrentRefreshInterval(settings, {
                "refresh-interval": candidate,
            }),
            expected && candidate !== current,
        );
        assert.deepEqual(
            settings.writes,
            expected && candidate !== current
                ? [["refresh-interval", candidate]]
                : [],
        );
    }
});

test("fuzz: modern settings win and legacy is used only when modern is absent", () => {
    let seed = 0x4944454e;
    for (let iteration = 0; iteration < 4_096; iteration += 1) {
        seed = (Math.imul(seed, 1_103_515_245) + 12_345) >>> 0;
        const uuid = `xpu-${seed}@vendor`;
        const instanceId = String((seed >>> 4) % 1_024);
        const modern = `/home/fuzz/.config/cinnamon/spices/${uuid}/${instanceId}.json`;
        const legacy = `/home/fuzz/.cinnamon/configs/${uuid}/${instanceId}.json`;
        const modernExists = Boolean(seed & 1);
        const legacyExists = Boolean(seed & 2);
        const paths = new Set();
        if (modernExists) {
            paths.add(modern);
        }
        if (legacyExists) {
            paths.add(legacy);
        }

        assert.equal(
            Cinnamon.currentAppletSettingsPath(uuid, instanceId, environmentOf(paths)),
            legacyExists && !modernExists ? legacy : modern,
        );
    }
});
