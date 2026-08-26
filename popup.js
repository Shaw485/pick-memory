/* global chrome */

const form = document.getElementById("add-form");
const titleInput = document.getElementById("title");
const contentInput = document.getElementById("content");
const tagsInput = document.getElementById("tags");
const status = document.getElementById("status");
let currentTab = null;

initialize();

async function initialize() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab || null;
  if (!tab?.id) return;

  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: "GET_SELECTION" });
    if (response?.selection) {
      contentInput.value = response.selection;
      titleInput.value = makeTitle(response.selection);
    }
  } catch {
    // Internal browser pages do not allow content scripts.
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitButton = form.querySelector("button[type=submit]");
  submitButton.disabled = true;
  submitButton.textContent = "正在保存…";

  const response = await chrome.runtime.sendMessage({
    type: "ADD_CARD",
    card: {
      title: titleInput.value,
      content: contentInput.value,
      tags: tagsInput.value.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean),
      sourceUrl: currentTab?.url || "",
      sourceTitle: currentTab?.title || ""
    }
  });

  submitButton.disabled = false;
  submitButton.textContent = "加入复习队列";
  if (!response?.ok) return showStatus(response?.error || "保存失败", true);

  form.reset();
  showStatus("已保存，今天就会加入复习。", false);
});

document.getElementById("open-library").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

function showStatus(message, isError) {
  status.hidden = false;
  status.textContent = message;
  status.classList.toggle("error", isError);
}

function makeTitle(content) {
  const firstSentence = content.trim().split(/[。！？.!?\n]/)[0];
  return firstSentence.length > 34 ? `${firstSentence.slice(0, 34)}…` : firstSentence;
}
