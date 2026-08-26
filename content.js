/* global chrome */

(() => {
  if (window.top !== window || document.getElementById("memory-card-extension-root")) return;

  const root = document.createElement("div");
  root.id = "memory-card-extension-root";
  const shadow = root.attachShadow({ mode: "open" });
  document.documentElement.appendChild(root);

  const selectionRoot = document.createElement("div");
  selectionRoot.id = "memory-card-selection-root";
  const selectionShadow = selectionRoot.attachShadow({ mode: "open" });
  document.documentElement.appendChild(selectionRoot);

  const state = {
    card: null,
    mode: "review",
    stats: null,
    settings: { size: "medium", exposuresPerCard: 3 }
  };
  let selectedText = "";

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "GET_SELECTION") {
      sendResponse({ selection: String(window.getSelection() || "").trim() });
    }
    if (message.type === "KNOWLEDGE_SAVED") showToast("已加入复习队列");
  });

  setupSelectionLearning();
  initialize();

  function setupSelectionLearning() {
    document.addEventListener("mouseup", (event) => {
      if (event.composedPath().includes(selectionRoot)) return;
      window.setTimeout(showSelectionAction, 20);
    }, true);
    document.addEventListener("mousedown", (event) => {
      if (!event.composedPath().includes(selectionRoot)) hideSelectionAction();
    }, true);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") hideSelectionAction();
    }, true);
    window.addEventListener("scroll", hideSelectionAction, true);
  }

  function showSelectionAction() {
    const selection = window.getSelection();
    const text = String(selection || "").replace(/\s+/g, " ").trim();
    if (!text || text.length < 2 || !selection.rangeCount || selection.isCollapsed) {
      hideSelectionAction();
      return;
    }

    const range = selection.getRangeAt(0);
    const rects = range.getClientRects();
    const rect = rects.length ? rects[rects.length - 1] : range.getBoundingClientRect();
    if (!rect || (!rect.width && !rect.height)) return hideSelectionAction();

    selectedText = text.slice(0, 5000);
    const bubbleWidth = 44;
    const bubbleHeight = 24;
    const left = Math.max(8, Math.min(
      window.innerWidth - bubbleWidth - 8,
      rect.left + (rect.width / 2) - (bubbleWidth / 2)
    ));
    let top = rect.top - bubbleHeight - 7;
    if (top < 8) top = rect.bottom + 7;

    selectionShadow.innerHTML = `
      <style>${selectionStyles}</style>
      <button class="learn" style="left:${Math.round(left)}px;top:${Math.round(top)}px" aria-label="将选中文字加入知识库">学习</button>`;
    selectionShadow.querySelector(".learn").addEventListener("click", saveSelection);
  }

  async function saveSelection() {
    const button = selectionShadow.querySelector(".learn");
    if (!button || !selectedText) return;
    button.disabled = true;
    button.textContent = "加入中";

    const response = await send({
      type: "ADD_CARD",
      card: {
        content: selectedText,
        tags: ["划词"],
        sourceUrl: location.href,
        sourceTitle: document.title
      }
    });

    if (!response?.ok) {
      button.disabled = false;
      button.textContent = "重试";
      return;
    }

    button.textContent = "已加入 ✓";
    button.classList.add("saved");
    window.setTimeout(hideSelectionAction, 850);
  }

  function hideSelectionAction() {
    selectedText = "";
    selectionShadow.innerHTML = "";
  }

  async function initialize() {
    const response = await send({ type: "GET_DAILY_CARD" });
    if (response?.ok && response.card) {
      state.card = response.card;
      state.mode = response.mode;
      state.stats = response.stats;
      state.settings = response.settings || state.settings;
      renderCard();
    }
  }

  function renderCard() {
    shadow.innerHTML = `
      <style>${styles}</style>
      <aside class="memory-card" data-size="${state.settings.size}" role="complementary" aria-label="今日知识卡片">
        <button class="icon-button close" aria-label="今天不再显示" title="今天不再显示">×</button>
        <div class="prompt"><p>${escapeHtml(state.card.content)}</p></div>
        ${ratingMarkup()}
        <div class="footer">
          <button class="settings-toggle" aria-expanded="false">设置</button>
          <div class="footer-actions">
            <button class="delete-card">删除</button>
          </div>
        </div>
        ${settingsMarkup()}
      </aside>`;

    shadow.querySelector(".close").addEventListener("click", dismissToday);
    shadow.querySelector(".settings-toggle").addEventListener("click", toggleSettings);
    shadow.querySelector(".card-size").addEventListener("change", saveCardSize);
    shadow.querySelector(".exposure-limit").addEventListener("change", saveExposureLimit);
    shadow.querySelector(".delete-card").addEventListener("click", deleteCurrentCard);
    shadow.querySelectorAll("[data-rating]").forEach((button) => {
      button.addEventListener("click", () => review(button.dataset.rating));
    });
  }

  function ratingMarkup() {
    return `
      <div class="ratings">
        <button data-rating="forgot"><b>忘了</b><small>明天再见</small></button>
        <button data-rating="fuzzy"><b>模糊</b><small>缩短间隔</small></button>
        <button data-rating="remembered" class="remembered"><b>记得</b><small>拉长间隔</small></button>
      </div>`;
  }

  function settingsMarkup() {
    const sizeOptions = [
      ["small", "小"],
      ["medium", "中"],
      ["large", "大"]
    ].map(([value, label]) => (
      `<option value="${value}"${state.settings.size === value ? " selected" : ""}>${label}</option>`
    )).join("");

    return `
      <div class="settings-panel" hidden>
        <label>
          <span>卡片大小</span>
          <select class="card-size" aria-label="卡片大小">${sizeOptions}</select>
        </label>
        <label>
          <span>曝光</span>
          <span class="exposure-control">
            <input class="exposure-limit" type="number" min="1" max="20" step="1" value="${state.settings.exposuresPerCard}" aria-label="自动切换前的曝光次数">
            <span>次后下一张</span>
          </span>
        </label>
      </div>`;
  }

  function toggleSettings() {
    const panel = shadow.querySelector(".settings-panel");
    const button = shadow.querySelector(".settings-toggle");
    const willOpen = panel.hidden;
    panel.hidden = !willOpen;
    button.setAttribute("aria-expanded", String(willOpen));
  }

  async function saveCardSize(event) {
    await updateSettings({ size: event.target.value });
  }

  async function saveExposureLimit(event) {
    const value = Math.min(20, Math.max(1, Math.round(Number(event.target.value) || 1)));
    event.target.value = String(value);
    await updateSettings({ exposuresPerCard: value });
  }

  async function updateSettings(settings) {
    const response = await send({ type: "UPDATE_CARD_SETTINGS", settings });
    if (!response?.ok) return showToast(response?.error || "设置保存失败");
    state.settings = response.settings;
    const card = shadow.querySelector(".memory-card");
    if (card) card.dataset.size = state.settings.size;
    const sizeSelect = shadow.querySelector(".card-size");
    const exposureInput = shadow.querySelector(".exposure-limit");
    if (sizeSelect) sizeSelect.value = state.settings.size;
    if (exposureInput) exposureInput.value = String(state.settings.exposuresPerCard);
  }

  async function review(rating) {
    const response = await send({ type: "REVIEW_CARD", cardId: state.card.id, rating });
    if (!response?.ok) return showToast(response?.error || "保存失败");
    if (rating === "remembered") {
      const next = await send({ type: "GET_DAILY_CARD" });
      if (!next?.ok || !next.card) {
        showComplete("今天的卡片都看过了");
        return;
      }
      state.card = next.card;
      state.mode = next.mode;
      state.stats = next.stats;
      state.settings = next.settings || state.settings;
      renderCard();
      return;
    }
    const date = response.schedule.nextReviewOn.slice(5).replace("-", "月") + "日";
    showComplete(`已安排在 ${date} 再见`);
  }

  async function deleteCurrentCard() {
    const response = await send({ type: "DELETE_CARD", cardId: state.card.id });
    if (!response?.ok) return showToast(response?.error || "删除失败");

    const next = await send({ type: "GET_DAILY_CARD" });
    if (!next?.ok || !next.card) {
      showComplete("已删除，今天没有更多卡片");
      return;
    }
    state.card = next.card;
    state.mode = next.mode;
    state.stats = next.stats;
    state.settings = next.settings || state.settings;
    renderCard();
  }

  async function dismissToday() {
    await send({ type: "DISMISS_TODAY" });
    shadow.innerHTML = "";
  }

  function showComplete(message) {
    shadow.innerHTML = `
      <style>${styles}</style>
      <aside class="memory-card complete" role="status">
        <div class="check">✓</div>
        <h2>${escapeHtml(message)}</h2>
        <p>一点点记住，时间会替你加深它。</p>
        <button class="continue">再来一张</button>
      </aside>`;
    shadow.querySelector(".continue").addEventListener("click", async () => {
      const response = await send({ type: "GET_DAILY_CARD" });
      if (!response?.card) {
        shadow.innerHTML = "";
        return;
      }
      state.card = response.card;
      state.mode = response.mode;
      state.stats = response.stats;
      state.settings = response.settings || state.settings;
      renderCard();
    });
    window.setTimeout(() => {
      shadow.querySelector(".memory-card")?.classList.add("settled");
    }, 2600);
  }

  function showToast(message) {
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = message;
    if (!shadow.querySelector("style")) shadow.innerHTML = `<style>${styles}</style>`;
    shadow.appendChild(toast);
    window.setTimeout(() => toast.remove(), 2200);
  }

  function send(message) {
    return chrome.runtime.sendMessage(message).catch(() => null);
  }

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>'"]/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", "\"": "&quot;"
    })[character]);
  }

  const styles = `
    :host { all: initial; }
    *, *::before, *::after { box-sizing: border-box; }
    button { font: inherit; }
    .memory-card {
      position: fixed; left: 16px; bottom: 16px; z-index: 2147483647;
      width: min(280px, calc(100vw - 22px)); padding: 9px 11px 8px;
      color: #25312b; background: rgba(252, 250, 244, .97);
      border: 1px solid rgba(58, 79, 67, .14); border-radius: 14px;
      box-shadow: 0 12px 38px rgba(28, 42, 34, .18), 0 2px 6px rgba(28, 42, 34, .07);
      font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.45; animation: memory-card-in .38s cubic-bezier(.2,.8,.2,1);
      backdrop-filter: blur(16px);
    }
    .memory-card[data-size="small"] { width: min(240px, calc(100vw - 22px)); }
    .memory-card[data-size="medium"] { width: min(280px, calc(100vw - 22px)); }
    .memory-card[data-size="large"] { width: min(340px, calc(100vw - 22px)); }
    .memory-card[data-size="small"] .prompt p { max-height: 82px; }
    .memory-card[data-size="large"] .prompt p { max-height: 152px; }
    .footer { display: flex; align-items: center; justify-content: space-between; }
    .icon-button { border: 0; background: transparent; color: #7b837f; cursor: pointer; font-size: 18px; line-height: 1; }
    .close { position: absolute; top: 7px; right: 8px; padding: 0; }
    .prompt { min-height: 0; }
    .prompt p { max-height: 112px; margin: 0 18px 0 0; overflow: auto; color: #445149; font-size: 10px; line-height: 1.28; white-space: pre-wrap; }
    .ratings { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; margin-top: 4px; }
    .ratings button { padding: 2px 3px; border: 1px solid #d9ddd9; border-radius: 6px; color: #4a5550; background: #fff; cursor: pointer; line-height: 1.05; }
    .ratings button:hover { border-color: #7aa28c; transform: translateY(-1px); }
    .ratings .remembered { color: #fff; border-color: #2f7255; background: #2f7255; }
    .ratings b, .ratings small { display: block; }
    .ratings b { font-size: 9px; line-height: 1.05; }
    .ratings small { margin-top: 0; opacity: .7; font-size: 7px; line-height: 1.05; }
    .footer { margin-top: 4px; padding-top: 3px; border-top: 1px solid #e5e5df; color: #8a918d; font-size: 8px; }
    .footer-actions { display: flex; align-items: center; gap: 9px; }
    .delete-card, .settings-toggle { padding: 0; border: 0; color: #65736c; background: transparent; cursor: pointer; font-size: 9px; }
    .delete-card { color: #a0645b; }
    .settings-toggle[aria-expanded="true"] { color: #2f7255; }
    .settings-panel { margin-top: 4px; padding-top: 4px; border-top: 1px solid #e5e5df; }
    .settings-panel[hidden] { display: none; }
    .settings-panel label { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 22px; color: #65736c; font-size: 9px; }
    .settings-panel select, .settings-panel input { height: 20px; border: 1px solid #d9ddd9; border-radius: 5px; color: #445149; background: #fff; font: 9px/18px inherit; outline: none; }
    .settings-panel select { width: 48px; padding: 0 4px; }
    .settings-panel input { width: 34px; padding: 0 3px; text-align: center; }
    .settings-panel select:focus, .settings-panel input:focus { border-color: #7aa28c; }
    .exposure-control { display: flex; align-items: center; gap: 4px; }
    .complete { text-align: center; }
    .complete .check { width: 30px; height: 30px; margin: 2px auto 8px; border-radius: 50%; color: #fff; background: #2f7255; font: 18px/30px sans-serif; }
    .complete h2 { margin: 0; color: #17231d; font-family: ui-serif, Georgia, serif; font-size: 12px; line-height: 1.2; font-weight: 650; }
    .complete p { margin: 6px 0 10px; color: #77807b; font-size: 10px; }
    .continue { padding: 6px 10px; border: 1px solid #cbd4ce; border-radius: 7px; color: #2f7255; background: transparent; cursor: pointer; font-size: 10px; }
    .settled { opacity: .78; }
    .toast { position: fixed; left: 16px; bottom: 16px; z-index: 2147483647; padding: 8px 11px; border-radius: 8px; color: #fff; background: #25312b; box-shadow: 0 8px 24px rgba(0,0,0,.18); font: 11px/1.4 Inter, sans-serif; animation: memory-card-in .25s ease-out; }
    @keyframes memory-card-in { from { opacity: 0; transform: translateY(12px) scale(.98); } }
    @media (prefers-reduced-motion: reduce) { .memory-card, .toast { animation: none; } }
  `;

  const selectionStyles = `
    :host { all: initial; }
    *, *::before, *::after { box-sizing: border-box; }
    .learn {
      position: fixed; z-index: 2147483647; min-width: 44px; height: 24px; padding: 0 7px;
      border: 1px solid rgba(255,255,255,.26); border-radius: 12px;
      color: #fff; background: #2f7255; box-shadow: 0 5px 16px rgba(25, 48, 36, .24);
      font: 600 12px/22px Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      text-align: center; cursor: pointer; user-select: none;
      animation: learn-in .14s ease-out;
    }
    .learn:hover { background: #285f48; transform: translateY(-1px); }
    .learn:disabled { cursor: wait; opacity: .86; }
    .learn.saved { min-width: 64px; background: #25312b; }
    @keyframes learn-in { from { opacity: 0; transform: translateY(3px) scale(.96); } }
    @media (prefers-reduced-motion: reduce) { .learn { animation: none; } }
  `;
})();
