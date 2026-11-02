// M.A.L.A Chrome Extension - Background Service Worker
const DAEMON_URL = "ws://127.0.0.1:8765";
let socket = null;
let isConnected = false;
let reconnectInterval = null;
let heartbeatInterval = null;

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

      // Start 20s Keep-Alive Heartbeat to prevent Manifest V3 Service Worker sleep
      startHeartbeat();

      notifyTabs({ type: "DAEMON_STATUS", connected: true });
    };

    socket.onmessage = (event) => {
      try {
        const responseData = JSON.parse(event.data);
        
        // Ignore PONG heartbeat frames from the daemon
        if (responseData.type === "PONG") {
          return;
        }

        console.log("[M.A.L.A Background] Received daemon payload:", responseData);
        notifyTabs({ type: "DAEMON_RESPONSE", payload: responseData });
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
  }, 20000); // 20 seconds keeps Chrome MV3 SW active
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
      console.log("[M.A.L.A Background] Reconnecting...");
      connectDaemon();
    }, 3000);
  }
}

function notifyTabs(message) {
  chrome.tabs.query({ url: "https://gemini.google.com/*" }, (tabs) => {
    tabs.forEach((tab) => {
      chrome.tabs.sendMessage(tab.id, message).catch(() => {});
    });
  });
}

// Extension message router
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "SEND_TO_DAEMON") {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(request.payload));
      sendResponse({ status: "SENT" });
    } else {
      console.error("[M.A.L.A Background] Cannot send packet: WebSocket is disconnected.");
      sendResponse({ status: "ERROR", message: "Daemon WebSocket offline." });
    }
  } else if (request.type === "GET_DAEMON_STATUS") {
    sendResponse({ connected: isConnected });
  } else if (request.type === "RECONNECT_DAEMON") {
    connectDaemon();
    sendResponse({ status: "RECONNECTING" });
  }
  return true;
});

connectDaemon();