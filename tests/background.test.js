const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

const projectRoot = path.resolve(__dirname, "..");
const stored = {
  cards: [
    makeCard("first", "2000-01-01T00:00:00.000Z"),
    makeCard("second", "2000-01-02T00:00:00.000Z")
  ],
  preferences: {
    dismissedOn: null,
    dailyAssignment: null,
    skippedOn: {},
    deckVersions: { searchPrinciples: 1 },
    cardSettings: { size: "medium", exposuresPerCard: 2 },
    exposureProgress: null
  }
};

const chrome = {
  runtime: {
    onInstalled: { addListener() {} },
    onStartup: { addListener() {} },
    onMessage: { addListener() {} },
    async sendNativeMessage() { return { ok: true, cards: [] }; }
  },
  contextMenus: {
    removeAll(callback) { callback?.(); },
    create() {},
    onClicked: { addListener() {} }
  },
  alarms: {
    create() {},
    onAlarm: { addListener() {} }
  },
  tabs: { sendMessage: async () => ({}) },
  storage: {
    local: {
      async get(keys) {
        return Object.fromEntries(keys.filter((key) => key in stored).map((key) => [key, clone(stored[key])]));
      },
      async set(values) {
        Object.assign(stored, clone(values));
      }
    }
  }
};

const context = vm.createContext({ chrome, console, crypto: webcrypto, Date, Set });
context.importScripts = () => {};
vm.runInContext(fs.readFileSync(path.join(projectRoot, "scheduler.js"), "utf8"), context);
vm.runInContext(fs.readFileSync(path.join(projectRoot, "background.js"), "utf8"), context);

(async () => {
  const firstExposure = await vm.runInContext("getDailyCard()", context);
  assert.equal(firstExposure.card.id, "first");
  assert.equal(firstExposure.exposureCount, 1);

  const secondExposure = await vm.runInContext("getDailyCard()", context);
  assert.equal(secondExposure.card.id, "first");
  assert.equal(secondExposure.exposureCount, 2);

  const rotated = await vm.runInContext("getDailyCard()", context);
  assert.equal(rotated.card.id, "second");
  assert.equal(rotated.exposureCount, 1);

  const settings = await vm.runInContext(
    "updateCardSettings({ size: 'large', exposuresPerCard: 99 })",
    context
  );
  assert.deepEqual({ ...settings.settings }, { size: "large", exposuresPerCard: 20 });

  console.log("background tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

function makeCard(id, createdAt) {
  return {
    id,
    title: id,
    content: id,
    createdAt,
    createdOn: "2000-01-01",
    nextReviewOn: "2000-01-01",
    lastReviewedOn: null,
    lastShownOn: null,
    stage: 0,
    archived: false
  };
}

function clone(value) {
  return structuredClone(value);
}
