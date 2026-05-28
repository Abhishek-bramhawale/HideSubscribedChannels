const toggle = document.getElementById("toggle");
const blockedChannelsList = document.getElementById("blockedChannels");
const debugInfoBox = document.getElementById("debugInfo");

chrome.storage.sync.get(["enabled"], (result) => {
  toggle.checked = result.enabled === true;
});

function renderBlockedChannels(channels) {
  blockedChannelsList.innerHTML = "";

  if (!channels || channels.length === 0) {
    const emptyItem = document.createElement("li");
    emptyItem.className = "empty";
    emptyItem.textContent = "No blocked channels yet";
    blockedChannelsList.appendChild(emptyItem);
    return;
  }

  channels.forEach((channel) => {
    const item = document.createElement("li");
    item.textContent = channel;
    blockedChannelsList.appendChild(item);
  });
}

function renderDebugInfo(info) {
  if (!info) {
    debugInfoBox.textContent = "No debug data yet.";
    return;
  }

  debugInfoBox.textContent = JSON.stringify(info, null, 2);
}

chrome.storage.local.get(["blockedChannels", "debugInfo"], (result) => {
  renderBlockedChannels(result.blockedChannels || []);
  renderDebugInfo(result.debugInfo);
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;

  if (changes.blockedChannels) {
    renderBlockedChannels(changes.blockedChannels.newValue || []);
  }

  if (changes.debugInfo) {
    renderDebugInfo(changes.debugInfo.newValue);
  }
});

toggle.addEventListener("change", async () => {
  chrome.storage.sync.set({
    enabled: toggle.checked,
  });

  const tabs = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });

  const activeTab = tabs[0];
  const isYouTubeTab = /https:\/\/([a-z0-9-]+\.)?youtube\.com\//i.test(activeTab?.url || "");

  if (activeTab?.id && isYouTubeTab) {
    chrome.tabs.reload(activeTab.id);
  }
});