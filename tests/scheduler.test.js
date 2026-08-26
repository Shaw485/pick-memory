const assert = require("node:assert/strict");
const scheduler = require("../scheduler.js");

const newCard = { stage: 0 };
assert.deepEqual(scheduler.nextReview(newCard, "remembered", "2026-08-26"), {
  stage: 1,
  nextReviewOn: "2026-08-27",
  intervalDays: 1
});

assert.deepEqual(scheduler.nextReview({ stage: 4 }, "remembered", "2026-08-26"), {
  stage: 5,
  nextReviewOn: "2026-09-10",
  intervalDays: 15
});

assert.deepEqual(scheduler.nextReview({ stage: 4 }, "fuzzy", "2026-08-26"), {
  stage: 4,
  nextReviewOn: "2026-08-30",
  intervalDays: 4
});

assert.deepEqual(scheduler.nextReview({ stage: 7 }, "forgot", "2026-08-26"), {
  stage: 0,
  nextReviewOn: "2026-08-27",
  intervalDays: 1
});

const ordered = scheduler.orderCandidates([
  { id: "recent", nextReviewOn: "2026-08-25", createdAt: "2026-08-01" },
  { id: "overdue", nextReviewOn: "2026-08-20", createdAt: "2026-08-02" }
], "2026-08-26");
assert.equal(ordered[0].id, "overdue");

console.log("scheduler tests passed");
