document.addEventListener('DOMContentLoaded', () => {
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const agentToggle = document.getElementById('agentToggle');
  const reconnectBtn = document.getElementById('reconnectBtn');

  // 1. Query daemon connection status on popup open
  updateDaemonStatus();

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

    // Broadcast toggle event to active Gemini tabs
    chrome.tabs.query({ url: "https://gemini.google.com/*" }, (tabs) => {
      tabs.forEach((tab) => {
        chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_AGENT", enabled: enabled }).catch(() => {});
      });
    });
  });

  // 4. Handle Manual Reconnect Button
  reconnectBtn.addEventListener('click', () => {
    statusText.textContent = "Connecting...";
    chrome.runtime.sendMessage({ type: "RECONNECT_DAEMON" }, () => {
      setTimeout(updateDaemonStatus, 600);
    });
  });

  function updateDaemonStatus() {
    chrome.runtime.sendMessage({ type: "GET_DAEMON_STATUS" }, (response) => {
      if (chrome.runtime.lastError || !response) {
        setOffline();
        return;
      }

      if (response.connected) {
        statusDot.classList.add('online');
        statusText.textContent = "Daemon Connected";
      } else {
        setOffline();
      }
    });
  }

  function setOffline() {
    statusDot.classList.remove('online');
    statusText.textContent = "Daemon Offline";
  }
});