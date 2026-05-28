let enabled = false;
let observer = null;
let blockedChannels = new Set();
let subscribedChannels = new Set();
let subscribedChannelPaths = new Set();
let pendingStorageWrite = null;
let showMoreExpanded = false;

chrome.storage.sync.get(["enabled"], (result) => {
  enabled = result.enabled === true;
  if (enabled) {
    init();
  } else {
    clearBlockedChannels();
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "sync" || !changes.enabled) return;

  enabled = changes.enabled.newValue === true;
  location.reload();
});

function isHomepage() {
  return location.pathname === "/";
}

function persistBlockedChannels() {
  if (pendingStorageWrite) {
    clearTimeout(pendingStorageWrite);
  }

  pendingStorageWrite = setTimeout(() => {
    chrome.storage.local.set({
      blockedChannels: Array.from(blockedChannels).sort(),
    });
    pendingStorageWrite = null;
  }, 200);
}

function clearBlockedChannels() {
  blockedChannels = new Set();
  chrome.storage.local.set({
    blockedChannels: [],
    debugInfo: {
      state: "disabled",
      host: location.host,
      path: location.pathname,
      lastRun: new Date().toISOString(),
    },
  });
}

function getChannelName(video) {
  const directName = video
    .querySelector(
      "#channel-name a, #channel-name yt-formatted-string, ytd-channel-name a, ytd-channel-name yt-formatted-string, #byline a, #byline-container a"
    )
    ?.textContent?.trim();

  if (directName) return directName;

  // Fallback: infer channel label from any channel-like endpoint within the card.
  const channelLink = getChannelLinkElement(video);
  return channelLink?.textContent?.trim();
}

function normalizeChannelName(name) {
  return (name || "").trim().toLowerCase();
}

function isLikelyChannelPath(href) {
  return (
    href.startsWith("/@") ||
    href.startsWith("/channel/") ||
    href.startsWith("/c/") ||
    href.startsWith("/user/")
  );
}

function normalizeChannelPath(pathValue) {
  if (!pathValue) return "";

  try {
    const parsedUrl = new URL(pathValue, location.origin);
    const cleanPath = parsedUrl.pathname.replace(/\/+$/, "");
    const parts = cleanPath.split("/").filter(Boolean);
    if (parts.length < 2) return "";

    if (parts[0].startsWith("@")) {
      return `/${parts[0].toLowerCase()}`;
    }

    if (["channel", "c", "user"].includes(parts[0])) {
      return `/${parts[0].toLowerCase()}/${parts[1].toLowerCase()}`;
    }
  } catch (error) {
    return "";
  }

  return "";
}

function getChannelLinkElement(video) {
  const candidateLinks = video.querySelectorAll('a[href], yt-formatted-string a[href]');

  for (const link of candidateLinks) {
    const href = link.getAttribute("href") || "";
    if (isLikelyChannelPath(href)) {
      return link;
    }
  }

  return null;
}

function collectSubscribedFromGuideDom() {
  const sidebarLinks = document.querySelectorAll(
    'ytd-guide-entry-renderer a#endpoint[href], ytd-guide-entry-renderer a[href], tp-yt-paper-item a[href]'
  );

  const nextSet = new Set();
  const nextPaths = new Set();
  sidebarLinks.forEach((link) => {
    const href = link.getAttribute("href") || "";
    if (!isLikelyChannelPath(href)) return;

    const textFromTitle = link.getAttribute("title");
    const textFromChild = link.querySelector("#text, yt-formatted-string")?.textContent;
    const textFromLink = link.textContent;
    const name = normalizeChannelName(textFromTitle || textFromChild || textFromLink);

    if (name) {
      nextSet.add(name);
    }

    const normalizedPath = normalizeChannelPath(href);
    if (normalizedPath) {
      nextPaths.add(normalizedPath);
    }
  });

  return { names: nextSet, paths: nextPaths };
}

function expandSubscriptionsShowMoreIfNeeded() {
  const showMoreNodes = document.querySelectorAll(
    "ytd-guide-entry-renderer yt-formatted-string.title, ytd-guide-collapsible-section-entry-renderer yt-formatted-string.title"
  );

  let found = 0;
  let clicked = 0;

  showMoreNodes.forEach((node) => {
    const label = node.textContent?.trim().toLowerCase();
    if (label !== "show more") return;
    found += 1;

    const entry =
      node.closest("ytd-guide-entry-renderer") ||
      node.closest("ytd-guide-collapsible-section-entry-renderer");
    const endpoint =
      entry?.querySelector("a#endpoint, tp-yt-paper-item, yt-formatted-string.title");

    if (endpoint && !showMoreExpanded) {
      endpoint.click();
      clicked += 1;
    }
  });

  if (clicked > 0) {
    showMoreExpanded = true;
  }

  return { showMoreFound: found, showMoreClicked: clicked };
}

function walkObjectForChannels(value, outputSet, outputPaths) {
  if (!value || typeof value !== "object") return;

  if (Array.isArray(value)) {
    value.forEach((item) => walkObjectForChannels(item, outputSet, outputPaths));
    return;
  }

  const browseEndpoint = value.browseEndpoint;
  const titleRuns = value.title?.runs;
  const titleText = value.title?.simpleText || titleRuns?.[0]?.text || "";
  const canonicalBaseUrl = browseEndpoint?.canonicalBaseUrl || "";
  const browseId = browseEndpoint?.browseId || "";
  const isChannel =
    canonicalBaseUrl.startsWith("/@") ||
    browseId.startsWith("UC") ||
    value.icon?.iconType === "SUBSCRIPTIONS";

  if (isChannel && titleText) {
    outputSet.add(normalizeChannelName(titleText));
  }

  const normalizedPath = normalizeChannelPath(canonicalBaseUrl);
  if (normalizedPath) {
    outputPaths.add(normalizedPath);
  }

  Object.keys(value).forEach((key) => {
    walkObjectForChannels(value[key], outputSet, outputPaths);
  });
}

function collectSubscribedFromInitialData() {
  const nextSet = new Set();
  const nextPaths = new Set();
  const initialData = window.ytInitialData;
  if (!initialData) {
    return { names: nextSet, paths: nextPaths };
  }

  walkObjectForChannels(initialData, nextSet, nextPaths);
  return { names: nextSet, paths: nextPaths };
}

function updateSubscribedChannels() {
  const expandStats = expandSubscriptionsShowMoreIfNeeded();
  const domResult = collectSubscribedFromGuideDom();
  const dataResult = collectSubscribedFromInitialData();
  const mergedNames = new Set([...domResult.names, ...dataResult.names]);
  const mergedPaths = new Set([...domResult.paths, ...dataResult.paths]);

  if (mergedNames.size > 0 || mergedPaths.size > 0) {
    subscribedChannels = mergedNames;
    subscribedChannelPaths = mergedPaths;
  }

  return {
    ...expandStats,
    showMoreExpanded,
    domNameCount: domResult.names.size,
    dataNameCount: dataResult.names.size,
    mergedNameCount: subscribedChannels.size,
    domPathCount: domResult.paths.size,
    dataPathCount: dataResult.paths.size,
    mergedPathCount: subscribedChannelPaths.size,
  };
}

function getVideoChannelPath(video) {
  const channelLink =
    video.querySelector("#channel-name a[href], ytd-channel-name a[href], #byline a[href], #byline-container a[href]") ||
    getChannelLinkElement(video);
  const href = channelLink?.getAttribute("href") || "";
  return normalizeChannelPath(href);
}

function hideSubscribedVideos() {
  if (!enabled || !isHomepage()) return;

  const subscribedStats = updateSubscribedChannels();
  if (subscribedChannels.size === 0 && subscribedChannelPaths.size === 0) {
    chrome.storage.local.set({
      debugInfo: {
        state: "no_subscriptions_found",
        host: location.host,
        path: location.pathname,
        lastRun: new Date().toISOString(),
        ...subscribedStats,
      },
    });
    return;
  }

  const videos = document.querySelectorAll(
    "ytd-rich-item-renderer, ytm-rich-item-renderer, ytm-compact-video-renderer"
  );
  let updatedList = false;
  let hiddenCount = 0;
  let nameMatchCount = 0;
  let pathMatchCount = 0;
  let missingNameCount = 0;
  let missingPathCount = 0;

  videos.forEach((video) => {
    const channelName = getChannelName(video);
    const normalizedChannelName = normalizeChannelName(channelName);
    const channelPath = getVideoChannelPath(video);

    if (!normalizedChannelName) missingNameCount += 1;
    if (!channelPath) missingPathCount += 1;

    const isNameMatch = normalizedChannelName && subscribedChannels.has(normalizedChannelName);
    const isPathMatch = channelPath && subscribedChannelPaths.has(channelPath);

    if (isNameMatch || isPathMatch) {
      video.style.display = "none";
      hiddenCount += 1;
      if (isNameMatch) nameMatchCount += 1;
      if (isPathMatch) pathMatchCount += 1;

      if (channelName && !blockedChannels.has(channelName)) {
        blockedChannels.add(channelName);
        updatedList = true;
      }
    } else {
      video.style.removeProperty("display");
    }
  });

  if (updatedList) {
    persistBlockedChannels();
  }

  chrome.storage.local.set({
    debugInfo: {
      state: "active",
      host: location.host,
      path: location.pathname,
      lastRun: new Date().toISOString(),
      scannedVideos: videos.length,
      hiddenCount,
      nameMatchCount,
      pathMatchCount,
      missingNameCount,
      missingPathCount,
      blockedChannelsCount: blockedChannels.size,
      sampleBlockedChannels: Array.from(blockedChannels).slice(0, 8),
      sampleSubscribedNames: Array.from(subscribedChannels).slice(0, 8),
      sampleSubscribedPaths: Array.from(subscribedChannelPaths).slice(0, 8),
      ...subscribedStats,
    },
  });
}

function init() {
  if (!isHomepage()) {
    chrome.storage.local.set({
      debugInfo: {
        state: "not_homepage",
        host: location.host,
        path: location.pathname,
        lastRun: new Date().toISOString(),
      },
    });
    return;
  }

  if (observer) {
    observer.disconnect();
  }

  observer = new MutationObserver(() => {
    hideSubscribedVideos();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  hideSubscribedVideos();
}