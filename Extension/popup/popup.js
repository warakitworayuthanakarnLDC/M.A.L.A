document.addEventListener('DOMContentLoaded', () => {
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const agentToggle = document.getElementById('agentToggle');
  const reconnectBtn = document.getElementById('reconnectBtn');
  const lockTabBtn = document.getElementById('lockTabBtn');
  const injectPromptBtn = document.getElementById('injectPromptBtn');
  const tabLockBox = document.getElementById('tabLockBox');
  const tabLockIndicator = document.getElementById('tabLockIndicator');
  const tabLockText = document.getElementById('tabLockText');

  let currentTab = null;
  let activeLockedTabId = null;

  // 1. Get active tab info and daemon status
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs && tabs.length > 0) {
      currentTab = tabs[0];
    }
    updateDaemonStatus();
  });

  // 2. Restore active agent state toggle preference
  chrome.storage.local.get(['malaEnabled'], (result) => {
    if (result.malaEnabled !== undefined) {
      agentToggle.checked = result.malaEnabled;
    }
  });

  // 3. Handle Master Switch Toggle changes
  agentToggle.addEventListener('change', () => {
    const enabled = agentToggle.checked;
    chrome.storage.local.set({ malaEnabled: enabled });

    // Broadcast toggle event to Gemini tabs
    chrome.tabs.query({ url: "https://gemini.google.com/*" }, (tabs) => {
      tabs.forEach((tab) => {
        chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_AGENT", enabled: enabled }).catch(() => {});
      });
    });
  });

  // 4. Handle Lock Current Tab Button
  lockTabBtn.addEventListener('click', () => {
    if (!currentTab || !currentTab.url || !currentTab.url.includes("gemini.google.com")) {
      statusText.textContent = "Please select a Gemini tab!";
      return;
    }

    if (activeLockedTabId === currentTab.id) {
      // Toggle off / Unlock
      chrome.runtime.sendMessage({ type: "SET_LOCKED_TAB", tabId: null }, () => {
        updateDaemonStatus();
      });
    } else {
      // Lock to current tab
      chrome.runtime.sendMessage({ type: "SET_LOCKED_TAB", tabId: currentTab.id }, () => {
        updateDaemonStatus();
      });
    }
  });

  // 5. Handle Inject Starting Prompt Button
  injectPromptBtn.addEventListener('click', async () => {
    if (!currentTab || !currentTab.url || !currentTab.url.includes("gemini.google.com")) {
      statusText.textContent = "Please select a Gemini tab!";
      return;
    }

    injectPromptBtn.disabled = true;
    injectPromptBtn.textContent = "Injecting...";

    try {
      const promptUrl = chrome.runtime.getURL('systemprompt.txt');
      const response = await fetch(promptUrl);
      const promptText = await response.text();

      // Automatically lock current tab if not locked
      if (activeLockedTabId !== currentTab.id) {
        await new Promise((resolve) => {
          chrome.runtime.sendMessage({ type: "SET_LOCKED_TAB", tabId: currentTab.id }, resolve);
        });
      }

      chrome.tabs.sendMessage(currentTab.id, {
        type: "INJECT_STARTING_PROMPT",
        prompt: promptText
      }, (res) => {
        injectPromptBtn.disabled = false;
        injectPromptBtn.textContent = "Inject starting prompt";

        if (chrome.runtime.lastError) {
          statusText.textContent = "Failed. Refresh Gemini tab.";
        } else {
          statusText.textContent = "Starting prompt injected!";
          updateDaemonStatus();
        }
      });
    } catch (err) {
      console.error("[M.A.L.A Popup] Failed to inject prompt:", err);
      injectPromptBtn.disabled = false;
      injectPromptBtn.textContent = "Inject starting prompt";
      statusText.textContent = "Error reading prompt file.";
    }
  });

  // 6. Handle Manual Reconnect Button
  reconnectBtn.addEventListener('click', () => {
    statusText.textContent = "Connecting...";
    chrome.runtime.sendMessage({ type: "RECONNECT_DAEMON" }, () => {
      setTimeout(updateDaemonStatus, 500);
      setTimeout(updateDaemonStatus, 1500);
      setTimeout(updateDaemonStatus, 3000);
    });
  });

  // 7. Listen for real-time status broadcasts while popup is open
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "DAEMON_STATUS") {
      updateDaemonStatus();
    }
  });

  function updateDaemonStatus() {
    chrome.runtime.sendMessage({ type: "GET_DAEMON_STATUS" }, (response) => {
      if (chrome.runtime.lastError || !response) {
        setOffline();
        return;
      }

      activeLockedTabId = response.lockedTabId;

      if (response.connected) {
        statusDot.classList.add('online');
        statusText.textContent = "Daemon Connected";
      } else {
        setOffline();
      }

      updateLockUI();
    });
  }

  function updateLockUI() {
    const isGemini = currentTab && currentTab.url && currentTab.url.includes("gemini.google.com");

    if (activeLockedTabId && currentTab && activeLockedTabId === currentTab.id) {
      tabLockBox.classList.add('active');
      tabLockIndicator.textContent = "🔒";
      tabLockText.textContent = `Locked: This Tab (#${currentTab.id})`;
      lockTabBtn.textContent = "Unlock this tab";
      lockTabBtn.classList.add('is-locked');
    } else if (activeLockedTabId) {
      tabLockBox.classList.remove('active');
      tabLockIndicator.textContent = "🔒";
      tabLockText.textContent = `Locked: Tab #${activeLockedTabId}`;
      lockTabBtn.textContent = isGemini ? "Switch lock to this tab" : "Lock current tab";
      lockTabBtn.classList.remove('is-locked');
    } else {
      tabLockBox.classList.remove('active');
      tabLockIndicator.textContent = "🔓";
      tabLockText.textContent = "Locked Tab: None";
      lockTabBtn.textContent = "Lock current tab";
      lockTabBtn.classList.remove('is-locked');
    }
  }

  function setOffline() {
    statusDot.classList.remove('online');
    statusText.textContent = "Daemon Offline";
  }
});
