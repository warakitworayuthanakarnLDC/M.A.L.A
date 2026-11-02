// M.A.L.A Chrome Extension - Background Service Worker
const DAEMON_URL = "ws://127.0.0.1:8765";
let socket = null;
let isConnected = false;
let reconnectInterval = null;
let heartbeatInterval = null;
let lockedTabId = null; // Strictly locked to one Gemini tab

async function verifyLockedTab() {
  if (!lockedTabId) return null;
  try {
    const tab = await chrome.tabs.get(lockedTabId);
    if (!tab) {
      console.log(`[M.A.L.A Background] Tab ${lockedTabId} no longer exists. Resetting lock.`);
      lockedTabId = null;
    }
  } catch (err) {
    console.log(`[M.A.L.A Background] Tab ${lockedTabId} not found (${err.message}). Resetting lock.`);
    lockedTabId = null;
  }
  return lockedTabId;
}

function connectDaemon() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  console.log("[M.A.L.A Background] Connecting to local daemon at", DAEMON_URL);
  
  try {
    socket = new WebSocket(DAEMON_URL);

    socket.onopen = () => {
      console.log("[M.A.L.A Background] WebSocket connection established.");
      isConnected = true;

      if (reconnectInterval) {
        clearInterval(reconnectInterval);
        reconnectInterval = null;
      }

      startHeartbeat();
      notifyAll({ type: "DAEMON_STATUS", connected: true, lockedTabId: lockedTabId });
    };

    socket.onmessage = async (event) => {
      try {
        const responseData = JSON.parse(event.data);
        
        // Ignore PONG heartbeat frames from daemon
        if (responseData.type === "PONG") {
          return;
        }

        console.log("[M.A.L.A Background] Received daemon payload:", responseData);

        // Verify locked tab exists before dispatching
        const activeLock = await verifyLockedTab();
        if (activeLock) {
          chrome.tabs.sendMessage(activeLock, { type: "DAEMON_RESPONSE", payload: responseData })
            .catch((err) => {
              console.warn(`[M.A.L.A Background] Failed to send response to locked tab ${activeLock}:`, err);
            });
        } else {
          console.warn("[M.A.L.A Background] Received daemon response but no Gemini tab is currently locked.");
        }
      } catch (err) {
        console.error("[M.A.L.A Background] Error parsing daemon message:", err);
      }
    };

    socket.onclose = () => {
      console.warn("[M.A.L.A Background] WebSocket disconnected. Retrying in 3s...");
      isConnected = false;
      stopHeartbeat();
      notifyAll({ type: "DAEMON_STATUS", connected: false });
      scheduleReconnect();
    };

    socket.onerror = (err) => {
      console.warn("[M.A.L.A Background] WebSocket connection issue detected.");
    };

  } catch (err) {
    console.error("[M.A.L.A Background] Failed to initialize WebSocket:", err);
    scheduleReconnect();
  }
}

function startHeartbeat() {
  stopHeartbeat();
  heartbeatInterval = setInterval(() => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "PING" }));
    }
  }, 15000); // 15 seconds keepalive
}

function stopHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}

function scheduleReconnect() {
  if (!reconnectInterval) {
    reconnectInterval = setInterval(() => {
      console.log("[M.A.L.A Background] Reconnecting to daemon...");
      connectDaemon();
    }, 3000);
  }
}

function forceReconnect() {
  console.log("[M.A.L.A Background] Forcing reconnect to daemon...");
  if (reconnectInterval) {
    clearInterval(reconnectInterval);
    reconnectInterval = null;
  }
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
  if (socket) {
    try {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      socket.close();
    } catch (e) {}
    socket = null;
  }
  isConnected = false;
  connectDaemon();
}

// Broadcast status to open popup views and Gemini tabs
function notifyAll(message) {
  chrome.runtime.sendMessage(message).catch(() => {});
  notifyTabs(message);
}

// Broadcast general status to all Gemini tabs
function notifyTabs(message) {
  chrome.tabs.query({ url: "https://gemini.google.com/*" }, (tabs) => {
    tabs.forEach((tab) => {
      chrome.tabs.sendMessage(tab.id, message).catch(() => {});
    });
  });
}

// If the locked tab is closed, automatically reset the lock until set manually
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === lockedTabId) {
    console.log(`[M.A.L.A Background] Locked tab (${tabId}) was closed. Resetting locked tab.`);
    lockedTabId = null;
    notifyAll({ type: "TAB_LOCK_STATE", isLocked: false, lockedTabId: null });
  }
});

// If the locked tab navigates away from Gemini, reset lock
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tabId === lockedTabId && changeInfo.url) {
    if (!changeInfo.url.includes("gemini.google.com")) {
      console.log(`[M.A.L.A Background] Locked tab (${tabId}) navigated away from Gemini. Resetting lock.`);
      lockedTabId = null;
      notifyAll({ type: "TAB_LOCK_STATE", isLocked: false, lockedTabId: null });
    }
  }
});

// Extension message router
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  (async () => {
    if (request.type === "KEEPALIVE") {
      if (!isConnected || !socket || socket.readyState !== WebSocket.OPEN) {
        connectDaemon();
      }
      const activeLock = await verifyLockedTab();
      sendResponse({ status: "ALIVE", connected: isConnected, lockedTabId: activeLock });
      return;
    }

    if (request.type === "CHECK_TAB_LOCK") {
      const activeLock = await verifyLockedTab();
      const isSenderLocked = (sender.tab && sender.tab.id === activeLock);
      sendResponse({ isLocked: !!isSenderLocked, lockedTabId: activeLock });
      return;
    }

    if (request.type === "REQUEST_TAB_LOCK_OR_STATUS") {
      const activeLock = await verifyLockedTab();
      const senderTabId = sender?.tab?.id;
      if (!activeLock) {
        // No tab currently locked: auto-lock to sender
        lockedTabId = senderTabId || null;
        console.log(`[M.A.L.A Background] Auto-locked to tab ${lockedTabId}`);
        notifyAll({ type: "TAB_LOCK_STATE", isLocked: true, lockedTabId: lockedTabId });
        sendResponse({ canAutoLock: true, lockedTabId: lockedTabId });
      } else if (activeLock === senderTabId) {
        sendResponse({ canAutoLock: true, lockedTabId: lockedTabId });
      } else {
        sendResponse({ canAutoLock: false, lockedTabId: activeLock });
      }
      return;
    }

    if (request.type === "SET_LOCKED_TAB") {
      const previousLockedTab = lockedTabId;
      const newLockedTab = request.tabId;

      if (previousLockedTab && previousLockedTab !== newLockedTab) {
        chrome.tabs.sendMessage(previousLockedTab, { type: "TAB_LOCK_STATE", isLocked: false }).catch(() => {});
      }

      lockedTabId = newLockedTab;
      console.log(`[M.A.L.A Background] Tab lock manually set to: ${lockedTabId}`);

      if (lockedTabId) {
        chrome.tabs.sendMessage(lockedTabId, { type: "TAB_LOCK_STATE", isLocked: true }).catch(() => {});
      }

      notifyAll({ type: "TAB_LOCK_STATE", isLocked: true, lockedTabId: lockedTabId });
      sendResponse({ status: "UPDATED", lockedTabId: lockedTabId });
      return;
    }

    if (request.type === "SET_LOCKED_TAB_FOR_SENDER") {
      const senderTabId = sender?.tab?.id;
      if (senderTabId) {
        const previousLockedTab = lockedTabId;
        if (previousLockedTab && previousLockedTab !== senderTabId) {
          chrome.tabs.sendMessage(previousLockedTab, { type: "TAB_LOCK_STATE", isLocked: false }).catch(() => {});
        }
        lockedTabId = senderTabId;
        console.log(`[M.A.L.A Background] Tab lock claimed by sender tab: ${lockedTabId}`);
        chrome.tabs.sendMessage(lockedTabId, { type: "TAB_LOCK_STATE", isLocked: true }).catch(() => {});
        notifyAll({ type: "TAB_LOCK_STATE", isLocked: true, lockedTabId: lockedTabId });
        sendResponse({ status: "UPDATED", lockedTabId: lockedTabId });
      } else {
        sendResponse({ status: "ERROR" });
      }
      return;
    }

    if (request.type === "SEND_TO_DAEMON") {
      const activeLock = await verifyLockedTab();
      const senderTabId = sender?.tab?.id;

      // Auto-lock if none locked
      if (!activeLock && senderTabId) {
        lockedTabId = senderTabId;
        console.log(`[M.A.L.A Background] Auto-locking to tab ${lockedTabId} on first command.`);
        notifyAll({ type: "TAB_LOCK_STATE", isLocked: true, lockedTabId: lockedTabId });
      } else if (activeLock && senderTabId !== activeLock) {
        console.warn(`[M.A.L.A Background] Rejected command from tab ${senderTabId}. Active locked tab is ${activeLock}.`);
        sendResponse({ status: "REJECTED", message: `Tab is not the locked M.A.L.A tab (${activeLock}).` });
        return;
      }

      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(request.payload));
        sendResponse({ status: "SENT", lockedTabId: lockedTabId });
      } else {
        console.error("[M.A.L.A Background] Cannot send packet: WebSocket is disconnected. Reconnecting...");
        connectDaemon();
        sendResponse({ status: "ERROR", message: "Daemon WebSocket offline. Reconnecting..." });
      }
      return;
    }

    if (request.type === "TASK_COMPLETED") {
      console.log("[M.A.L.A Background] Task completed signal received from tab:", sender?.tab?.id);
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(request.payload));
      }
      sendResponse({ status: "ACK" });
      return;
    }

    if (request.type === "GET_DAEMON_STATUS") {
      const activeLock = await verifyLockedTab();
      sendResponse({ connected: isConnected, lockedTabId: activeLock });
      return;
    }

    if (request.type === "RECONNECT_DAEMON") {
      forceReconnect();
      sendResponse({ status: "RECONNECTING" });
      return;
    }
  })();

  return true; // Asynchronous sendResponse
});

connectDaemon();
