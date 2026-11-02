// M.A.L.A Chrome Extension - Background Service Worker
const DAEMON_URL = "ws://127.0.0.1:8765";
let socket = null;
let isConnected = false;
let reconnectInterval = null;
let heartbeatInterval = null;
let boundTabId = null; // Locks execution strictly to one Gemini tab

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
      notifyTabs({ type: "DAEMON_STATUS", connected: true, boundTabId: boundTabId });
    };

    socket.onmessage = (event) => {
      try {
        const responseData = JSON.parse(event.data);
        
        // Ignore PONG heartbeat frames from daemon
        if (responseData.type === "PONG") {
          return;
        }

        console.log("[M.A.L.A Background] Received daemon payload:", responseData);

        // Lock down feedback strictly to the single bound Gemini tab
        if (boundTabId) {
          chrome.tabs.sendMessage(boundTabId, { type: "DAEMON_RESPONSE", payload: responseData })
            .catch((err) => {
              console.warn(`[M.A.L.A Background] Failed to send response to bound tab ${boundTabId}:`, err);
            });
        } else {
          console.warn("[M.A.L.A Background] Received daemon response but no Gemini tab is currently bound.");
        }
      } catch (err) {
        console.error("[M.A.L.A Background] Error parsing daemon message:", err);
      }
    };

    socket.onclose = () => {
      console.warn("[M.A.L.A Background] WebSocket disconnected. Retrying in 3s...");
      isConnected = false;
      stopHeartbeat();
      notifyTabs({ type: "DAEMON_STATUS", connected: false });
      scheduleReconnect();
    };

    socket.onerror = (err) => {
      console.warn("[M.A.L.A Background] WebSocket connection issue detected.");
      socket.close();
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
  }, 15000); // 15 seconds keep-alive
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

// Broadcast general status (connected/disconnected) to all Gemini tabs
function notifyTabs(message) {
  chrome.tabs.query({ url: "https://gemini.google.com/*" }, (tabs) => {
    tabs.forEach((tab) => {
      chrome.tabs.sendMessage(tab.id, message).catch(() => {});
    });
  });
}

// Clean up bound tab if the user closes it
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === boundTabId) {
    console.log(`[M.A.L.A Background] Bound Gemini tab (${tabId}) was closed. Releasing tab lock.`);
    boundTabId = null;
  }
});

// Extension message router
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "KEEPALIVE") {
    // Keepalive ping from content script keeps service worker awake and ensures socket is connected
    if (!isConnected || !socket || socket.readyState !== WebSocket.OPEN) {
      connectDaemon();
    }
    sendResponse({ status: "ALIVE", connected: isConnected, boundTabId: boundTabId });
    return true;
  }

  if (request.type === "SEND_TO_DAEMON") {
    // Lock execution strictly to the tab initiating the command
    if (sender && sender.tab) {
      if (boundTabId && boundTabId !== sender.tab.id) {
        console.log(`[M.A.L.A Background] Tab ${sender.tab.id} attempted command while tab ${boundTabId} is bound. Updating bound tab.`);
      }
      boundTabId = sender.tab.id;
    }

    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(request.payload));
      sendResponse({ status: "SENT", boundTabId: boundTabId });
    } else {
      console.error("[M.A.L.A Background] Cannot send packet: WebSocket is disconnected. Attempting reconnect...");
      connectDaemon();
      sendResponse({ status: "ERROR", message: "Daemon WebSocket offline. Reconnecting..." });
    }
    return true;
  }

  if (request.type === "TASK_COMPLETED") {
    console.log("[M.A.L.A Background] Task completed signal received from tab:", sender?.tab?.id);
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(request.payload));
    }
    sendResponse({ status: "ACK" });
    return true;
  }

  if (request.type === "GET_DAEMON_STATUS") {
    sendResponse({ connected: isConnected, boundTabId: boundTabId });
    return true;
  }

  if (request.type === "RECONNECT_DAEMON") {
    connectDaemon();
    sendResponse({ status: "RECONNECTING" });
    return true;
  }

  return true;
});

connectDaemon();
