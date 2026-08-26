/* global module */

const EbbinghausScheduler = (() => {
  const INTERVALS = [0, 1, 2, 4, 7, 15, 30, 60, 120, 240];

  function toDateKey(value = new Date()) {
    const date = value instanceof Date ? value : new Date(value);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function addDays(dateKey, days) {
    const [year, month, day] = dateKey.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    date.setDate(date.getDate() + days);
    return toDateKey(date);
  }

  function daysBetween(fromKey, toKey) {
    const [fromYear, fromMonth, fromDay] = fromKey.split("-").map(Number);
    const [toYear, toMonth, toDay] = toKey.split("-").map(Number);
    const from = Date.UTC(fromYear, fromMonth - 1, fromDay);
    const to = Date.UTC(toYear, toMonth - 1, toDay);
    return Math.round((to - from) / 86400000);
  }

  function nextReview(card, rating, reviewedOn = toDateKey()) {
    const currentStage = Number(card.stage || 0);
    let nextStage = currentStage;
    let waitDays = 1;

    if (rating === "forgot") {
      nextStage = 0;
      waitDays = 1;
    } else if (rating === "fuzzy") {
      nextStage = Math.max(1, currentStage);
      waitDays = Math.max(1, Math.round((INTERVALS[nextStage] || 1) * 0.6));
    } else {
      nextStage = Math.min(currentStage + 1, INTERVALS.length - 1);
      waitDays = INTERVALS[nextStage];
    }

    return {
      stage: nextStage,
      nextReviewOn: addDays(reviewedOn, waitDays),
      intervalDays: waitDays
    };
  }

  function orderCandidates(cards, today = toDateKey()) {
    return [...cards].sort((a, b) => {
      const aDue = a.nextReviewOn || a.createdOn || today;
      const bDue = b.nextReviewOn || b.createdOn || today;
      const overdueDifference = daysBetween(bDue, today) - daysBetween(aDue, today);
      if (overdueDifference !== 0) return overdueDifference;
      if ((a.lastShownOn || "") !== (b.lastShownOn || "")) {
        return (a.lastShownOn || "").localeCompare(b.lastShownOn || "");
      }
      return (a.createdAt || "").localeCompare(b.createdAt || "");
    });
  }

  return { INTERVALS, toDateKey, addDays, daysBetween, nextReview, orderCandidates };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = EbbinghausScheduler;
}
