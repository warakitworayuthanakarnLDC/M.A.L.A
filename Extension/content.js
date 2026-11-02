// M.A.L.A Chrome Extension - Content Script (Google Gemini DOM Agent)
// Monitors Gemini chat output, extracts protocol delimiters, and injects execution results back into the editor.

(() => {
  console.log("[M.A.L.A Content Script] Loaded and active on Gemini.");

  let isEnabled = true;

  // Keep background service worker alive and ensure WebSocket remains connected
  setInterval(() => {
    chrome.runtime.sendMessage({ type: "KEEPALIVE" }).catch(() => {});
  }, 15000);

  // Regex patterns for protocol parsing
  const PATTERNS = {
    PS: /\|PS\|\s*([\s\S]*?)\s*\|PS\|/,
    // Supports Windows drive letters and optional :start-end line ranges
    READ: /\|READ\|\s*(.+?)(?::\s*(\d+)\s*-\s*(\d+))?\s*\|READ\|/,
    WRITE: /\|WRITE\|\s*([^\r\n]+)\r?\n([\s\S]*?)\|WRITE\|/,
    PATCH: /\|PATCH\|\s*([^\r\n]+)\r?\n[\s\S]*?<<<<<<< SEARCH\r?\n([\s\S]*?)\r?\n=======\r?\n([\s\S]*?)\r?\n>>>>>>> REPLACE\s*\|PATCH\|/,
    ENDTASK: /\|ENDTASK\|\s*([\s\S]*?)\s*\|ENDTASK\|/
  };

  // 1. Observe DOM mutations for assistant responses
  function initObserver() {
    const observer = new MutationObserver(() => {
      if (!isEnabled) return;
      checkLatestMessage();
    });

    observer.observe(document.body, { childList: true, subtree: true });
    console.log("[M.A.L.A Content Script] DOM MutationObserver attached.");
  }

  // 2. Extract and parse completed protocol commands
  function checkLatestMessage() {
    const responseNodes = document.querySelectorAll('.markdown');
    if (!responseNodes.length) return;

    const latestNode = responseNodes[responseNodes.length - 1];

    // Stream completion check: Wait until Gemini sets aria-busy="false"
    const isBusy = latestNode.getAttribute('aria-busy') === 'true';
    if (isBusy) return;

    // Deduplication check: Do not execute processed elements twice
    if (latestNode.dataset.malaProcessed === "true") return;

    const text = latestNode.innerText;
    const commandPayload = parseProtocolText(text);

    if (commandPayload) {
      latestNode.dataset.malaProcessed = "true";

      // Handle Task Completion: Stop loop, do not inject feedback or click Send
      if (commandPayload.type === "END_TASK") {
        console.log("[M.A.L.A Content Script] Task completed by agent:", commandPayload.summary);
        showToast(`[M.A.L.A] Task Completed: ${commandPayload.summary}`);
        chrome.runtime.sendMessage({
          type: "TASK_COMPLETED",
          payload: commandPayload
        });
        return;
      }

      console.log("[M.A.L.A Content Script] Protocol block detected & dispatched:", commandPayload);

      chrome.runtime.sendMessage({
        type: "SEND_TO_DAEMON",
        payload: commandPayload
      }, (res) => {
        if (chrome.runtime.lastError || (res && res.status === "ERROR")) {
          console.error("[M.A.L.A Content Script] Failed to transmit command to background daemon.");
        }
      });
    }
  }

  function parseProtocolText(text) {
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
      // Defensively strip accidental markdown code block fences
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
        search: patchMatch[2],
        replace: patchMatch[3]
      };
    }

    // 5. Overwrite/Write File (|WRITE|)
    const writeMatch = text.match(PATTERNS.WRITE);
    if (writeMatch) {
      let content = writeMatch[2];
      // Defensively strip accidental markdown code block fences wrapping the content
      content = content.replace(/^```[a-zA-Z0-9_-]*\r?\n/, '').replace(/\r?\n```\s*$/, '');
      return {
        type: "WRITE_FILE",
        path: writeMatch[1].trim(),
        content: content
      };
    }

    return null;
  }

  // 3. Receive daemon results and format input feedback
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "DAEMON_RESPONSE") {
      const result = message.payload;
      console.log("[M.A.L.A Content Script] Processing daemon execution result:", result);
      
      const formattedFeedback = formatDaemonOutput(result);
      injectAndSend(formattedFeedback);
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
        return (aria.includes('send') || jslog.includes('send')) && !btn.disabled;
      }) || document.querySelector('rich-textarea button:not([disabled])');

      if (sendBtn) {
        console.log("[M.A.L.A Content Script] Submitting feedback prompt...");
        sendBtn.click();
      } else {
        console.error("[M.A.L.A Content Script] Active send button unavailable for submit.");
      }
    }, 250);
  }

  function showToast(message) {
    const existing = document.getElementById('mala-toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.id = 'mala-toast';
    toast.textContent = message;
    toast.style.cssText = "position: fixed; bottom: 80px; right: 24px; background: #1e1e2e; color: #a6e3a1; border: 1px solid #a6e3a1; padding: 12px 20px; border-radius: 8px; z-index: 999999; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 14px; font-weight: 500; box-shadow: 0 4px 16px rgba(0,0,0,0.4); pointer-events: none;";
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 7000);
  }

  initObserver();
})();
