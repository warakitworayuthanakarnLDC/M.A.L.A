// M.A.L.A Chrome Extension - Content Script (Google Gemini DOM Agent)
// Monitors Gemini chat output, extracts protocol delimiters, and injects execution results back into the editor.

(() => {
  console.log("[M.A.L.A Content Script] Loaded and active on Gemini.");

  let isEnabled = true;
  let isTabLocked = false;
  let titleEnforceInterval = null;
  let debounceTimer = null;
  let keepaliveTimer = null;
  let observer = null;
  const TITLE_PREFIX = "[M.A.L.A AGENT] ";

  // Gracefully shuts down and detaches this script if the extension was reloaded in chrome://extensions/
  function cleanupOrphanedScript() {
    if (keepaliveTimer) {
      clearInterval(keepaliveTimer);
      keepaliveTimer = null;
    }
    if (titleEnforceInterval) {
      clearInterval(titleEnforceInterval);
      titleEnforceInterval = null;
    }
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    console.warn("[M.A.L.A Content Script] Extension context was invalidated (extension reloaded). Listeners detached cleanly.");
  }

  // Safe wrapper for chrome.runtime.sendMessage that handles context invalidation without throwing uncaught errors
  function safeSendMessage(message, callback) {
    if (!chrome.runtime?.id) {
      cleanupOrphanedScript();
      return;
    }
    try {
      chrome.runtime.sendMessage(message, (res) => {
        if (chrome.runtime.lastError) {
          const errStr = chrome.runtime.lastError.message || "";
          if (errStr.includes("Extension context invalidated") || errStr.includes("Receiving end does not exist")) {
            cleanupOrphanedScript();
            return;
          }
        }
        if (callback) callback(res);
      });
    } catch (err) {
      cleanupOrphanedScript();
    }
  }

  // Keep background service worker alive and ensure WebSocket remains connected
  keepaliveTimer = setInterval(() => {
    safeSendMessage({ type: "KEEPALIVE" });
  }, 15000);

  // Check initial tab lock status from background
  safeSendMessage({ type: "CHECK_TAB_LOCK" }, (res) => {
    if (res && res.isLocked) {
      setLockState(true, false);
    }
  });

  // Regex patterns for protocol parsing
  const PATTERNS = {
    PS: /\|PS\|\s*([\s\S]*?)\s*\|PS\|/,
    // Supports Windows drive letters and optional :start-end line ranges
    READ: /\|READ\|\s*(.+?)(?::\s*(\d+)\s*-\s*(\d+))?\s*\|READ\|/,
    WRITE: /\|WRITE\|\s*([^\r\n|]+?)\s*?\r?\n([\s\S]*?)\|WRITE\|/,
    PATCH: /\|PATCH\|\s*([^\r\n|]+?)\s*?\r?\n[\s\S]*?<<<<<<< SEARCH\r?\n([\s\S]*?)\r?\n=======\r?\n([\s\S]*?)\r?\n>>>>>>> REPLACE[\s\S]*?\|PATCH\|/,
    ENDTASK: /\|ENDTASK\|\s*([\s\S]*?)\s*\|ENDTASK\|/
  };

  // 1. Observe DOM mutations with debouncing to prevent CPU spikes or recursive loops
  function initObserver() {
    if (observer) observer.disconnect();
    observer = new MutationObserver(() => {
      if (!isEnabled) return;
      if (!chrome.runtime?.id) {
        cleanupOrphanedScript();
        return;
      }
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(checkLatestMessage, 250);
    });

    observer.observe(document.body, { childList: true, subtree: true });
    console.log("[M.A.L.A Content Script] DOM MutationObserver attached.");
  }

  // Locates the top-level assistant message turn container
  function getLatestAssistantTurn() {
    // 1. Preferred: Gemini's custom <model-response> element
    const modelResponses = document.querySelectorAll('model-response');
    if (modelResponses.length > 0) {
      const latest = modelResponses[modelResponses.length - 1];
      return latest.querySelector('message-content') || latest.querySelector('.markdown') || latest;
    }

    // 2. Fallback: <message-content> elements
    const messageContents = document.querySelectorAll('message-content');
    if (messageContents.length > 0) {
      return messageContents[messageContents.length - 1];
    }

    // 3. Fallback: [data-message-author-role="model"]
    const roleModels = document.querySelectorAll('[data-message-author-role="model"]');
    if (roleModels.length > 0) {
      return roleModels[roleModels.length - 1];
    }

    // 4. Fallback: .markdown elements -> ascend to enclosing turn container
    const markdowns = document.querySelectorAll('.markdown');
    if (markdowns.length > 0) {
      const last = markdowns[markdowns.length - 1];
      const turnContainer = last.closest('model-response, message-content, [data-message-author-role="model"], .model-response-text');
      return turnContainer || last;
    }

    return null;
  }

  // 2. Extract and parse completed protocol commands
  function checkLatestMessage() {
    const latestNode = getLatestAssistantTurn();
    if (!latestNode) return;

    // Stream completion check: Wait until Gemini finishes generating (Stop button disappears)
    const hasStopButton = !!document.querySelector(
      'button[aria-label*="Stop" i], button[aria-label*="หยุด" i], button[jslog*="stop" i], button mat-icon[fonticon="stop"], button [data-icon="stop"]'
    );
    const isAriaBusy = latestNode.getAttribute('aria-busy') === 'true' || !!latestNode.closest('[aria-busy="true"]');
    if (hasStopButton || isAriaBusy) return;

    // Deduplication check: Do not execute processed elements twice
    if (latestNode.dataset.malaProcessed === "true") return;

    const text = latestNode.innerText || "";
    const commandPayload = parseProtocolText(text);

    if (!commandPayload) return;

    // Auto-lock check:
    if (!isTabLocked) {
      safeSendMessage({ type: "REQUEST_TAB_LOCK_OR_STATUS" }, (res) => {
        if (res && res.canAutoLock) {
          console.log("[M.A.L.A Content Script] Auto-locked to this tab for execution.");
          setLockState(true, true);
          latestNode.dataset.malaProcessed = "true";
          dispatchCommand(latestNode, commandPayload);
        } else {
          console.warn(`[M.A.L.A Content Script] Protocol block detected, but Tab #${res?.lockedTabId} is currently locked.`);
          showToast(
            `[M.A.L.A] Command detected! Click here to lock this tab and execute.`,
            true,
            () => {
              safeSendMessage({ type: "SET_LOCKED_TAB_FOR_SENDER" }, () => {
                setLockState(true, true);
                latestNode.dataset.malaProcessed = "true";
                dispatchCommand(latestNode, commandPayload);
              });
            }
          );
        }
      });
      return;
    }

    latestNode.dataset.malaProcessed = "true";
    dispatchCommand(latestNode, commandPayload);
  }

  function dispatchCommand(node, commandPayload) {
    // Handle Task Completion: Stop loop, do not inject feedback or click Send
    if (commandPayload.type === "END_TASK") {
      console.log("[M.A.L.A Content Script] Task completed by agent:", commandPayload.summary);
      showToast(`[M.A.L.A] Task Completed: ${commandPayload.summary}`);
      safeSendMessage({
        type: "TASK_COMPLETED",
        payload: commandPayload
      });
      return;
    }

    console.log("[M.A.L.A Content Script] Protocol block detected & dispatched:", commandPayload);
    showToast(`[M.A.L.A] Executing ${commandPayload.type}...`);

    safeSendMessage({
      type: "SEND_TO_DAEMON",
      payload: commandPayload
    }, (res) => {
      if (res && res.status === "ERROR") {
        console.error("[M.A.L.A Content Script] Failed to transmit command to background daemon.");
        showToast("[M.A.L.A] Failed to send command. Check daemon connection.");
      }
    });
  }

  // Sanitizes extracted code: removes markdown code fences, UI language badges, copy buttons, and caution warnings
  function cleanCodeContent(content) {
    if (!content) return "";
    let cleaned = content.trim();

    // Strip leading markdown code fence: e.g. ```python\n
    cleaned = cleaned.replace(/^```[a-zA-Z0-9_+-]*\r?\n/, '');

    // Strip leading Gemini UI artifact lines (language badges, copy buttons, caution notes)
    const uiArtifactPattern = /^(?:[a-zA-Z0-9_+-]+|content_copy|copy(?:\s+code)?|use\s+code\s+with\s+caution\.?|expand_more|expand_less)\s*$/i;
    const lines = cleaned.split(/\r?\n/);
    let startIdx = 0;
    while (startIdx < lines.length) {
      const line = lines[startIdx].trim();
      if (!line || uiArtifactPattern.test(line)) {
        startIdx++;
        continue;
      }
      break;
    }
    cleaned = lines.slice(startIdx).join('\n');

    // Strip trailing code fence: e.g. \n```
    cleaned = cleaned.replace(/\r?\n```\s*$/, '');
    return cleaned;
  }

  function parseProtocolText(text) {
    if (!text) return null;

    // 1. Task Completion (|ENDTASK|)
    const endMatch = text.match(PATTERNS.ENDTASK);
    if (endMatch) {
      return {
        type: "END_TASK",
        summary: endMatch[1].trim() || "Task completed successfully."
      };
    }

    // 2. Shell Command Execution (|PS|)
    const psMatch = text.match(PATTERNS.PS);
    if (psMatch) {
      let command = psMatch[1].trim();
      command = command.replace(/^```[a-zA-Z0-9_-]*\r?\n?/, '').replace(/\r?\n?```\s*$/, '').trim();
      return { type: "EXEC_SHELL", command: command };
    }

    // 3. Read File Range (|READ|)
    const readMatch = text.match(PATTERNS.READ);
    if (readMatch) {
      const filePath = readMatch[1].trim();
      const startLine = readMatch[2] ? parseInt(readMatch[2], 10) : 1;
      const endLine = readMatch[3] ? parseInt(readMatch[3], 10) : 200;
      return {
        type: "READ_FILE",
        path: filePath,
        start_line: startLine,
        end_line: endLine
      };
    }

    // 4. Patch File Block (|PATCH|)
    const patchMatch = text.match(PATTERNS.PATCH);
    if (patchMatch) {
      return {
        type: "PATCH_FILE",
        path: patchMatch[1].trim(),
        search: cleanCodeContent(patchMatch[2]),
        replace: cleanCodeContent(patchMatch[3])
      };
    }

    // 5. Overwrite/Write File (|WRITE|)
    const writeMatch = text.match(PATTERNS.WRITE);
    if (writeMatch) {
      return {
        type: "WRITE_FILE",
        path: writeMatch[1].trim(),
        content: cleanCodeContent(writeMatch[2])
      };
    }

    return null;
  }

  // 3. Receive messages from background / popup
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "DAEMON_RESPONSE") {
      if (!isTabLocked) return;
      const result = message.payload;
      console.log("[M.A.L.A Content Script] Processing daemon execution result:", result);
      
      const formattedFeedback = formatDaemonOutput(result);
      injectAndSend(formattedFeedback);
    } else if (message.type === "TAB_LOCK_STATE") {
      setLockState(message.isLocked, true);
    } else if (message.type === "INJECT_STARTING_PROMPT") {
      console.log("[M.A.L.A Content Script] Injecting starting prompt from popup...");
      injectAndSend(message.prompt);
      showToast("[M.A.L.A] Starting prompt injected & submitted.");
      sendResponse({ status: "INJECTED" });
    } else if (message.type === "TOGGLE_AGENT") {
      isEnabled = message.enabled;
      console.log(`[M.A.L.A Content Script] Agent state set to: ${isEnabled}`);
    }
  });

  function formatDaemonOutput(result) {
    const status = result.status || "UNKNOWN";
    const output = result.output || "(No output returned)";
    
    return `[M.A.L.A Execution Result - Status: ${status}]\n\`\`\`text\n${output}\n\`\`\``;
  }

  // 4. Inject formatted output into Gemini editor and click Send
  function injectAndSend(text) {
    const editor = document.querySelector('rich-textarea .ql-editor');
    if (!editor) {
      console.error("[M.A.L.A Content Script] Target editor 'rich-textarea .ql-editor' not found.");
      return;
    }

    editor.focus();

    // Clear existing children safely without violating Trusted Types innerHTML policy
    while (editor.firstChild) {
      editor.removeChild(editor.firstChild);
    }

    // Append text line-by-line using native DOM Node creation
    const lines = text.split('\n');
    lines.forEach((line) => {
      const p = document.createElement('p');
      p.textContent = line || '\u00A0'; // Non-breaking space for blank lines
      editor.appendChild(p);
    });

    // Notify Angular / Quill form state listeners
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    editor.dispatchEvent(new Event('change', { bubbles: true }));

    // Buffer to allow Angular reactivity to enable the Send button
    setTimeout(() => {
      const allButtons = Array.from(document.querySelectorAll('button'));
      const sendBtn = allButtons.find(btn => {
        const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
        const jslog = (btn.getAttribute('jslog') || '').toLowerCase();
        return (aria.includes('send') || aria.includes('ส่ง') || jslog.includes('send')) && !btn.disabled;
      }) || document.querySelector('rich-textarea button:not([disabled])');

      if (sendBtn) {
        console.log("[M.A.L.A Content Script] Submitting prompt...");
        sendBtn.click();
      } else {
        console.warn("[M.A.L.A Content Script] Active send button unavailable for auto-submit.");
      }
    }, 300);
  }

  // 5. Tab Lock Management & Document Title Customization
  function setLockState(locked, showNotification = true) {
    isTabLocked = locked;
    console.log(`[M.A.L.A Content Script] Tab locked state changed: ${isTabLocked}`);

    if (isTabLocked) {
      applyMalaTitle();
      if (!titleEnforceInterval) {
        titleEnforceInterval = setInterval(applyMalaTitle, 1000);
      }
      if (showNotification) {
        showToast("[M.A.L.A] This tab is now LOCKED for agent operations.");
      }
      // Check for any pending unexecuted command on this tab
      setTimeout(checkLatestMessage, 100);
    } else {
      if (titleEnforceInterval) {
        clearInterval(titleEnforceInterval);
        titleEnforceInterval = null;
      }
      restoreOriginalTitle();
      if (showNotification) {
        showToast("[M.A.L.A] Tab lock released.");
      }
    }
  }

  function applyMalaTitle() {
    if (!document.title.startsWith(TITLE_PREFIX)) {
      document.title = TITLE_PREFIX + document.title.replace(TITLE_PREFIX, "");
    }
  }

  function restoreOriginalTitle() {
    if (document.title.startsWith(TITLE_PREFIX)) {
      document.title = document.title.replace(TITLE_PREFIX, "");
    }
  }

  function showToast(message, isClickable = false, onClick = null) {
    const existing = document.getElementById('mala-toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.id = 'mala-toast';
    toast.textContent = message;
    toast.style.cssText = `position: fixed; bottom: 80px; right: 24px; background: #1e1e2e; color: #a6e3a1; border: 1px solid #a6e3a1; padding: 12px 20px; border-radius: 8px; z-index: 999999; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 14px; font-weight: 500; box-shadow: 0 4px 16px rgba(0,0,0,0.4); ${isClickable ? 'cursor: pointer;' : 'pointer-events: none;'}`;

    if (isClickable && onClick) {
      toast.addEventListener('click', () => {
        toast.remove();
        onClick();
      });
    }

    document.body.appendChild(toast);
    setTimeout(() => {
      if (document.body.contains(toast)) toast.remove();
    }, 7000);
  }

  initObserver();
})();
