/* global chrome, EbbinghausScheduler, importScripts */

importScripts("scheduler.js");

const MENU_ID = "memory-card-save-selection";
const NATIVE_IMPORT_ALARM = "memory-card-native-import";
const NATIVE_HOST_NAME = "com.shiyi.card";
const DEFAULT_CARD_SETTINGS = {
  size: "medium",
  exposuresPerCard: 3
};
const DEFAULT_DATA = {
  cards: [],
  preferences: {
    dismissedOn: null,
    dailyAssignment: null,
    skippedOn: {},
    deckVersions: {},
    cardSettings: DEFAULT_CARD_SETTINGS,
    exposureProgress: null
  }
};

const SEARCH_DECK_VERSION = 1;
const SEARCH_KNOWLEDGE_CARDS = [
  {
    key: "ndcg",
    title: "NDCG@K 衡量什么？",
    content: "NDCG 衡量前 K 个结果的排序质量，同时考虑相关性等级和位置。DCG@K = Σ(2^relᵢ−1)/log₂(i+1)，再除以理想排序的 IDCG@K。结果通常在 0～1，越接近 1 越好。"
  },
  {
    key: "dcg-idcg",
    title: "DCG、IDCG 与位置折损",
    content: "DCG 用 log₂(i+1) 对越靠后的结果降权，因为用户更关注前排。IDCG 是同一批结果按相关性从高到低排列时的最大 DCG。用 DCG/IDCG 归一化后，不同查询才更容易比较。"
  },
  {
    key: "precision-recall",
    title: "Precision@K 与 Recall@K",
    content: "Precision@K = Top K 中相关结果数 ÷ K，关注前排结果够不够准；Recall@K = Top K 中相关结果数 ÷ 全部相关结果数，关注该找的结果找回了多少。提高召回率有时会牺牲精度。"
  },
  {
    key: "mrr",
    title: "MRR 适合评估什么？",
    content: "MRR 只关注第一个相关结果的位置：每个查询得分为 1/rank，再对查询取平均。第一个正确结果排第 1 得 1 分，排第 5 得 0.2 分。适合问答、导航搜索等只需一个正确答案的场景。"
  },
  {
    key: "map",
    title: "MAP 为什么比 MRR 更全面？",
    content: "AP 在每次命中相关结果的位置计算 Precision，并对该查询的相关结果取平均；MAP 再对所有查询的 AP 取平均。它关心多个相关结果的整体排序，而 MRR 只看第一次命中。"
  },
  {
    key: "bm25",
    title: "BM25 的核心原理",
    content: "BM25 是词法相关性模型：IDF 提高稀有词权重，词频饱和避免重复出现无限加分，文档长度归一化避免长文天然占优。k₁ 控制词频饱和速度，b 控制长度归一化强度。"
  },
  {
    key: "vector-search",
    title: "向量召回解决什么问题？",
    content: "向量召回把 Query 和文档编码成向量，用距离或相似度寻找语义接近的内容。它擅长同义表达和意图匹配，但可能忽略精确词、数字和专有名词，通常与 BM25 混合使用。"
  },
  {
    key: "cross-encoder",
    title: "Cross-Encoder 为什么用于精排？",
    content: "Cross-Encoder 把 Query 与候选文档一起输入模型，让注意力直接建模词间交互，因此比独立编码的双塔更准确；但每个候选都要单独推理，成本高，所以通常只精排召回阶段的 Top N。"
  },
  {
    key: "ranking-funnel",
    title: "搜索为什么采用召回—精排漏斗？",
    content: "召回阶段从海量候选中快速找出数百条，优先保证覆盖率；粗排和精排使用更复杂特征逐步缩小候选，优先保证排序质量。越靠后模型越重、候选越少，在效果与延迟之间平衡。"
  },
  {
    key: "offline-online",
    title: "NDCG 提升为何不等于业务提升？",
    content: "离线 NDCG 依赖标注相关性，无法完整反映位置偏差、延迟、商品供给和用户行为。离线提升需要再用 A/B 实验验证 CTR、转化率、零结果率和响应时间，避免指标与真实目标错位。"
  }
];

let searchDeckInstallPromise;
let nativeImportPromise;

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: "标记为知识点：%s",
      contexts: ["selection"]
    });
  });
  chrome.alarms.create(NATIVE_IMPORT_ALARM, { periodInMinutes: 1 });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(NATIVE_IMPORT_ALARM, { periodInMinutes: 1 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === NATIVE_IMPORT_ALARM) void importNativeSelections();
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || !info.selectionText) return;

  const content = cleanText(info.selectionText);
  await addCard({
    title: makeTitle(content),
    content,
    sourceUrl: info.pageUrl || tab?.url || "",
    sourceTitle: tab?.title || "",
    tags: []
  });

  if (tab?.id) {
    chrome.tabs.sendMessage(tab.id, { type: "KNOWLEDGE_SAVED" }).catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});

async function handleMessage(message) {
  await ensureSearchKnowledgeDeck();
  await importNativeSelections();
  switch (message.type) {
    case "ADD_CARD":
      return { card: await addCard(message.card || {}) };
    case "GET_DAILY_CARD":
      return getDailyCard();
    case "GET_NEXT_CARD":
      return getNextCard(message.cardId);
    case "GET_CARD_SETTINGS":
      return getCardSettings();
    case "UPDATE_CARD_SETTINGS":
      return updateCardSettings(message.settings || {});
    case "REVIEW_CARD":
      return reviewCard(message.cardId, message.rating);
    case "DISMISS_TODAY":
      return dismissToday();
    case "GET_LIBRARY":
      return getLibrary();
    case "UPDATE_CARD":
      return { card: await updateCard(message.card || {}) };
    case "DELETE_CARD":
      return deleteCard(message.cardId);
    case "RESET_TODAY":
      return resetToday();
    default:
      throw new Error("未知操作");
  }
}

function importNativeSelections() {
  if (!nativeImportPromise) {
    nativeImportPromise = pullNativeSelections().finally(() => {
      nativeImportPromise = null;
    });
  }
  return nativeImportPromise;
}

async function pullNativeSelections() {
  let response;
  try {
    response = await chrome.runtime.sendNativeMessage(NATIVE_HOST_NAME, { action: "pull" });
  } catch {
    return 0;
  }

  if (!response?.ok || !Array.isArray(response.cards) || !response.cards.length) return 0;
  const data = await getData();
  const existingIds = new Set(data.cards.map((card) => card.nativeId).filter(Boolean));
  const today = EbbinghausScheduler.toDateKey();
  const imported = response.cards
    .filter((item) => item?.id && item?.content && !existingIds.has(item.id))
    .map((item) => ({
      id: crypto.randomUUID(),
      nativeId: String(item.id),
      title: cleanText(item.title) || makeTitle(cleanText(item.content)),
      content: cleanText(item.content),
      tags: ["划词", "跨应用"],
      sourceUrl: "",
      sourceTitle: cleanText(item.sourceApp),
      createdAt: item.createdAt || new Date().toISOString(),
      updatedAt: item.createdAt || new Date().toISOString(),
      createdOn: today,
      nextReviewOn: today,
      lastReviewedOn: null,
      lastShownOn: null,
      stage: 0,
      reviewCount: 0,
      lapseCount: 0,
      archived: false
    }));

  if (!imported.length) return 0;
  data.cards.unshift(...imported);
  data.preferences.dismissedOn = null;
  data.preferences.dailyAssignment = null;
  await chrome.storage.local.set({ cards: data.cards, preferences: data.preferences });
  try {
    await chrome.runtime.sendNativeMessage(NATIVE_HOST_NAME, {
      action: "ack",
      ids: imported.map((card) => card.nativeId)
    });
  } catch {
    // Cards are deduplicated by nativeId if acknowledgement is retried later.
  }
  return imported.length;
}

function ensureSearchKnowledgeDeck() {
  if (!searchDeckInstallPromise) searchDeckInstallPromise = installSearchKnowledgeDeck();
  return searchDeckInstallPromise;
}

async function installSearchKnowledgeDeck() {
  const data = await getData();
  const installedVersion = Number(data.preferences.deckVersions?.searchPrinciples || 0);
  if (installedVersion >= SEARCH_DECK_VERSION) return;

  const existingDeckKeys = new Set(data.cards.map((card) => card.deckKey).filter(Boolean));
  const today = EbbinghausScheduler.toDateKey();
  const now = Date.now();
  const newCards = SEARCH_KNOWLEDGE_CARDS
    .filter((item) => !existingDeckKeys.has(`search-principles:${item.key}`))
    .map((item, index) => ({
      id: crypto.randomUUID(),
      deckKey: `search-principles:${item.key}`,
      title: item.title,
      content: item.content,
      tags: ["搜索", "排序原理"],
      sourceUrl: "",
      sourceTitle: "",
      createdAt: new Date(now + index).toISOString(),
      updatedAt: new Date(now + index).toISOString(),
      createdOn: today,
      nextReviewOn: EbbinghausScheduler.addDays(today, index),
      lastReviewedOn: null,
      lastShownOn: null,
      stage: 0,
      reviewCount: 0,
      lapseCount: 0,
      archived: false
    }));

  data.cards.unshift(...newCards);
  data.preferences.deckVersions = {
    ...(data.preferences.deckVersions || {}),
    searchPrinciples: SEARCH_DECK_VERSION
  };
  data.preferences.dismissedOn = null;
  data.preferences.dailyAssignment = null;
  await chrome.storage.local.set({ cards: data.cards, preferences: data.preferences });
}

async function getData() {
  const stored = await chrome.storage.local.get(["cards", "preferences"]);
  const storedPreferences = stored.preferences || {};
  return {
    cards: Array.isArray(stored.cards) ? stored.cards : DEFAULT_DATA.cards,
    preferences: {
      ...DEFAULT_DATA.preferences,
      ...storedPreferences,
      cardSettings: normalizeCardSettings(storedPreferences.cardSettings)
    }
  };
}

function normalizeCardSettings(input = {}) {
  const size = ["small", "medium", "large"].includes(input.size)
    ? input.size
    : DEFAULT_CARD_SETTINGS.size;
  const parsedExposures = Math.round(Number(input.exposuresPerCard));
  const exposuresPerCard = Number.isFinite(parsedExposures)
    ? Math.min(20, Math.max(1, parsedExposures))
    : DEFAULT_CARD_SETTINGS.exposuresPerCard;
  return { size, exposuresPerCard };
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function makeTitle(content) {
  const firstSentence = content.split(/[。！？.!?\n]/)[0].trim();
  if (!firstSentence) return "未命名知识点";
  return firstSentence.length > 34 ? `${firstSentence.slice(0, 34)}…` : firstSentence;
}

async function addCard(input) {
  const content = cleanText(input.content);
  if (!content) throw new Error("知识内容不能为空");

  const { cards, preferences } = await getData();
  const now = new Date().toISOString();
  const today = EbbinghausScheduler.toDateKey();
  const card = {
    id: crypto.randomUUID(),
    title: cleanText(input.title) || makeTitle(content),
    content,
    tags: Array.isArray(input.tags) ? input.tags.map(cleanText).filter(Boolean) : [],
    sourceUrl: String(input.sourceUrl || ""),
    sourceTitle: cleanText(input.sourceTitle),
    createdAt: now,
    updatedAt: now,
    createdOn: today,
    nextReviewOn: today,
    lastReviewedOn: null,
    lastShownOn: null,
    stage: 0,
    reviewCount: 0,
    lapseCount: 0,
    archived: false
  };

  cards.unshift(card);
  preferences.dismissedOn = null;
  preferences.dailyAssignment = null;
  await chrome.storage.local.set({ cards, preferences });
  return card;
}

async function getDailyCard() {
  const data = await getData();
  const today = EbbinghausScheduler.toDateKey();
  const settings = data.preferences.cardSettings;

  if (data.preferences.dismissedOn === today) {
    return { card: null, dismissed: true, stats: buildStats(data.cards, today), settings };
  }

  const assignedId = data.preferences.dailyAssignment?.date === today
    ? data.preferences.dailyAssignment.cardId
    : null;
  const assignedCard = data.cards.find((card) => card.id === assignedId && !card.archived);

  if (assignedCard && assignedCard.lastReviewedOn !== today && !hasReachedExposureLimit(data.preferences, assignedCard.id)) {
    const exposureCount = recordExposure(data.preferences, assignedCard.id);
    await chrome.storage.local.set({ preferences: data.preferences });
    return {
      card: assignedCard,
      mode: isDue(assignedCard, today) ? "review" : "refresh",
      stats: buildStats(data.cards, today),
      settings,
      exposureCount
    };
  }

  if (assignedCard && hasReachedExposureLimit(data.preferences, assignedCard.id)) {
    skipCardForToday(data.preferences, assignedCard.id, today);
  }

  const selection = selectCard(data.cards, data.preferences, today);
  if (!selection.card) {
    await chrome.storage.local.set({ preferences: data.preferences });
    return { card: null, dismissed: false, stats: buildStats(data.cards, today), settings };
  }

  selection.card.lastShownOn = today;
  data.preferences.dailyAssignment = { date: today, cardId: selection.card.id };
  const exposureCount = recordExposure(data.preferences, selection.card.id);
  await chrome.storage.local.set({ cards: data.cards, preferences: data.preferences });

  return { ...selection, stats: buildStats(data.cards, today), settings, exposureCount };
}

function hasReachedExposureLimit(preferences, cardId) {
  const progress = preferences.exposureProgress;
  return progress?.cardId === cardId
    && Number(progress.count || 0) >= preferences.cardSettings.exposuresPerCard;
}

function recordExposure(preferences, cardId) {
  const previous = preferences.exposureProgress?.cardId === cardId
    ? Number(preferences.exposureProgress.count || 0)
    : 0;
  const count = previous + 1;
  preferences.exposureProgress = { cardId, count };
  return count;
}

function skipCardForToday(preferences, cardId, today) {
  const skippedToday = new Set(preferences.skippedOn?.[today] || []);
  skippedToday.add(cardId);
  preferences.skippedOn = { [today]: [...skippedToday] };
  preferences.dailyAssignment = null;
  preferences.exposureProgress = null;
}

function selectCard(cards, preferences, today) {
  const skipped = new Set(preferences.skippedOn?.[today] || []);
  const active = cards.filter((card) => !card.archived && !skipped.has(card.id));
  const due = active.filter((card) => isDue(card, today) && card.lastReviewedOn !== today);
  const orderedDue = EbbinghausScheduler.orderCandidates(due, today);
  if (orderedDue.length) return { card: orderedDue[0], mode: "review" };

  const refresh = active
    .filter((card) => card.lastShownOn !== today && card.lastReviewedOn !== today)
    .sort((a, b) => {
      if ((a.lastShownOn || "") !== (b.lastShownOn || "")) {
        return (a.lastShownOn || "").localeCompare(b.lastShownOn || "");
      }
      return (a.lastReviewedOn || "").localeCompare(b.lastReviewedOn || "");
    });

  return { card: refresh[0] || null, mode: refresh.length ? "refresh" : "empty" };
}

async function getNextCard(cardId) {
  const data = await getData();
  const today = EbbinghausScheduler.toDateKey();
  if (cardId) {
    skipCardForToday(data.preferences, cardId, today);
  } else {
    data.preferences.dailyAssignment = null;
    data.preferences.exposureProgress = null;
  }
  await chrome.storage.local.set({ preferences: data.preferences });
  return getDailyCard();
}

async function getCardSettings() {
  const data = await getData();
  return { settings: data.preferences.cardSettings };
}

async function updateCardSettings(input) {
  const data = await getData();
  data.preferences.cardSettings = normalizeCardSettings({
    ...data.preferences.cardSettings,
    ...input
  });
  await chrome.storage.local.set({ preferences: data.preferences });
  return { settings: data.preferences.cardSettings };
}

async function reviewCard(cardId, rating) {
  if (!["forgot", "fuzzy", "remembered"].includes(rating)) throw new Error("无效的掌握程度");

  const data = await getData();
  const card = data.cards.find((item) => item.id === cardId);
  if (!card) throw new Error("没有找到这条知识");

  const today = EbbinghausScheduler.toDateKey();
  const schedule = EbbinghausScheduler.nextReview(card, rating, today);
  Object.assign(card, schedule, {
    lastReviewedOn: today,
    lastShownOn: today,
    reviewCount: Number(card.reviewCount || 0) + 1,
    lapseCount: Number(card.lapseCount || 0) + (rating === "forgot" ? 1 : 0),
    updatedAt: new Date().toISOString()
  });
  data.preferences.dailyAssignment = null;
  if (data.preferences.exposureProgress?.cardId === cardId) {
    data.preferences.exposureProgress = null;
  }
  await chrome.storage.local.set({ cards: data.cards, preferences: data.preferences });

  return { card, schedule, stats: buildStats(data.cards, today) };
}

async function dismissToday() {
  const data = await getData();
  data.preferences.dismissedOn = EbbinghausScheduler.toDateKey();
  await chrome.storage.local.set({ preferences: data.preferences });
  return { dismissed: true };
}

async function resetToday() {
  const data = await getData();
  data.preferences.dismissedOn = null;
  data.preferences.dailyAssignment = null;
  data.preferences.skippedOn = {};
  data.preferences.exposureProgress = null;
  await chrome.storage.local.set({ preferences: data.preferences });
  return { reset: true };
}

async function getLibrary() {
  const data = await getData();
  const today = EbbinghausScheduler.toDateKey();
  return { cards: data.cards, preferences: data.preferences, stats: buildStats(data.cards, today) };
}

async function updateCard(input) {
  const data = await getData();
  const card = data.cards.find((item) => item.id === input.id);
  if (!card) throw new Error("没有找到这条知识");
  const content = cleanText(input.content);
  if (!content) throw new Error("知识内容不能为空");

  Object.assign(card, {
    title: cleanText(input.title) || makeTitle(content),
    content,
    tags: Array.isArray(input.tags) ? input.tags.map(cleanText).filter(Boolean) : card.tags,
    archived: Boolean(input.archived),
    updatedAt: new Date().toISOString()
  });
  await chrome.storage.local.set({ cards: data.cards });
  return card;
}

async function deleteCard(cardId) {
  const data = await getData();
  const nextCards = data.cards.filter((card) => card.id !== cardId);
  if (nextCards.length === data.cards.length) throw new Error("没有找到这条知识");
  if (data.preferences.dailyAssignment?.cardId === cardId) data.preferences.dailyAssignment = null;
  if (data.preferences.exposureProgress?.cardId === cardId) data.preferences.exposureProgress = null;
  await chrome.storage.local.set({ cards: nextCards, preferences: data.preferences });
  return { deleted: true };
}

function isDue(card, today) {
  return (card.nextReviewOn || card.createdOn || today) <= today;
}

function buildStats(cards, today) {
  const active = cards.filter((card) => !card.archived);
  return {
    total: active.length,
    due: active.filter((card) => isDue(card, today) && card.lastReviewedOn !== today).length,
    reviewedToday: active.filter((card) => card.lastReviewedOn === today).length
  };
}
