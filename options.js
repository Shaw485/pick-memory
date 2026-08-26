/* global chrome */

const list = document.getElementById("card-list");
const empty = document.getElementById("empty");
const search = document.getElementById("search");
const filter = document.getElementById("filter");
const dialog = document.getElementById("editor");
const form = document.getElementById("edit-form");
let cards = [];
let stats = {};

loadLibrary();

async function loadLibrary() {
  const response = await chrome.runtime.sendMessage({ type: "GET_LIBRARY" });
  if (!response?.ok) return;
  cards = response.cards;
  stats = response.stats;
  render();
}

function render() {
  document.getElementById("stat-total").textContent = stats.total || 0;
  document.getElementById("stat-due").textContent = stats.due || 0;
  document.getElementById("stat-reviewed").textContent = stats.reviewedToday || 0;

  const query = search.value.trim().toLowerCase();
  const today = localDateKey();
  const visible = cards.filter((card) => {
    const matchesQuery = !query || [card.title, card.content, ...(card.tags || [])]
      .join(" ").toLowerCase().includes(query);
    const matchesFilter = filter.value === "all"
      || (filter.value === "active" && !card.archived)
      || (filter.value === "archived" && card.archived)
      || (filter.value === "due" && !card.archived && card.nextReviewOn <= today);
    return matchesQuery && matchesFilter;
  });

  list.innerHTML = visible.map(cardMarkup).join("");
  empty.hidden = visible.length > 0;
  list.querySelectorAll("[data-card-id]").forEach((button) => {
    button.addEventListener("click", () => openEditor(cards.find((card) => card.id === button.dataset.cardId)));
  });
}

function cardMarkup(card) {
  const tags = (card.tags || []).map((tag) => `<span>${escapeHtml(tag)}</span>`).join("");
  const schedule = card.archived
    ? "已归档"
    : card.nextReviewOn <= localDateKey()
      ? "今天复习"
      : `${formatDate(card.nextReviewOn)} 再见`;
  return `
    <button class="library-card" data-card-id="${card.id}">
      <div class="card-top"><span class="stage">第 ${Number(card.stage || 0) + 1} 阶段</span><span>${schedule}</span></div>
      <h2>${escapeHtml(card.title)}</h2>
      <p>${escapeHtml(card.content)}</p>
      <div class="card-bottom"><div class="tags">${tags}</div><span>复习 ${card.reviewCount || 0} 次</span></div>
    </button>`;
}

function openEditor(card = null) {
  document.getElementById("dialog-title").textContent = card ? "编辑知识" : "添加知识";
  document.getElementById("edit-id").value = card?.id || "";
  document.getElementById("edit-title").value = card?.title || "";
  document.getElementById("edit-content").value = card?.content || "";
  document.getElementById("edit-tags").value = (card?.tags || []).join(", ");
  document.getElementById("edit-archived").checked = Boolean(card?.archived);
  document.getElementById("archive-row").hidden = !card;
  document.getElementById("delete-card").hidden = !card;
  dialog.showModal();
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const id = document.getElementById("edit-id").value;
  const card = {
    id,
    title: document.getElementById("edit-title").value,
    content: document.getElementById("edit-content").value,
    tags: document.getElementById("edit-tags").value.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean),
    archived: document.getElementById("edit-archived").checked
  };
  const response = await chrome.runtime.sendMessage({ type: id ? "UPDATE_CARD" : "ADD_CARD", card });
  if (!response?.ok) return window.alert(response?.error || "保存失败");
  dialog.close();
  await loadLibrary();
});

document.getElementById("delete-card").addEventListener("click", async () => {
  const cardId = document.getElementById("edit-id").value;
  if (!cardId || !window.confirm("确定删除这条知识吗？此操作无法撤销。")) return;
  const response = await chrome.runtime.sendMessage({ type: "DELETE_CARD", cardId });
  if (!response?.ok) return window.alert(response?.error || "删除失败");
  dialog.close();
  await loadLibrary();
});

document.getElementById("add-new").addEventListener("click", () => openEditor());
document.getElementById("close-dialog").addEventListener("click", () => dialog.close());
document.getElementById("cancel-edit").addEventListener("click", () => dialog.close());
document.getElementById("show-card").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "RESET_TODAY" });
  window.alert("已恢复。刷新任意普通网页即可看到今日卡片。");
});
search.addEventListener("input", render);
filter.addEventListener("change", render);

function formatDate(dateKey) {
  const [, month, day] = dateKey.split("-");
  return `${Number(month)}月${Number(day)}日`;
}

function localDateKey() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", "\"": "&quot;"
  })[character]);
}
