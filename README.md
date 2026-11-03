# M.A.L.A  Make Any LLM Agentic

![License](https://img.shields.io/badge/License-Proprietary%20(View%20%26%20Run%20Only)-red.svg)
![Python](https://img.shields.io/badge/Python-3.10%2B%20%7C%203.12-blue.svg?logo=python&logoColor=white)
![Chrome Extension](https://img.shields.io/badge/Manifest-V3-green.svg?logo=googlechrome&logoColor=white)
![WebSocket](https://img.shields.io/badge/WebSocket-ws%3A%2F%2F127.0.0.1%3A8765-orange.svg)
![Architecture](https://img.shields.io/badge/Architecture-Daemon%20%2B%20DOM%20Bridge-purple.svg)
![Self-Healing](https://img.shields.io/badge/Loop-Autonomous%20Self--Healing-brightgreen.svg)

**M.A.L.A (Make Any LLM Agentic)** is a local agent bridge that turns web-based LLMs into autonomous code-executing, self-healing local agents.

By pairing a Manifest V3 Chrome Extension with a lightweight Python Daemon over WebSockets, M.A.L.A allows web models to execute PowerShell commands, read file slices, overwrite files, apply surgical search-and-replace patches, and automatically heal from execution errors all without leaving the native browser interface.

---

## Architecture & How It Works

1. **DOM Monitoring:** `content.js` attaches a `MutationObserver` to watch assistant output nodes (`.markdown`). When streaming finishes (`aria-busy="false"`), it extracts protocol delimiter tags.

2. **WebSocket Relay:** The payload is sent via Chrome Runtime messaging to `background.js`, which transmits it over a persistent WebSocket connection to `ws://127.0.0.1:8765`. Execution and feedback are strictly locked to the single initiating Gemini tab.

3. **Keep-Alive Heartbeat:** `content.js` sends periodic keepalive signals to `background.js` to prevent Manifest V3 service worker termination during idle periods.

4. **Interactive Security Approval:** The Python daemon parses the command (`protocol.py`) and prompts the user in the daemon terminal (`approval.py`) for explicit confirmation (`y/n`). Approval is requested exactly once per command.

5. **Local Execution:**
   - Shell commands run via `powershell.exe -NoProfile -ExecutionPolicy Bypass`.
   - File edits and range reads are processed using standard Python file I/O routines (`file_manager.py`).

6. **Automated Feedback & Self-Healing:** The output (`stdout`/`stderr`) is sent back across the WebSocket to `content.js`, which injects the feedback block safely into Quill/Angular (`rich-textarea .ql-editor`) and clicks the active **Send** button.

   If an error occurs, the LLM reads the error stack trace, corrects its code, and re-executes.

7. **Task Completion:** When the goal is completed, the agent outputs `|ENDTASK| <summary> |ENDTASK|`, stopping the autonomous loop cleanly.

---

## Supported LLMs

M.A.L.A is designed to bridge any web-based LLM chat UI into a local agent.

| LLM Platform | Support Status | Notes |
|:---|:---:|:---|
| **Google Gemini** (`gemini.google.com`) | **Official / Primary** | Fully tested with DOM selectors (`rich-textarea .ql-editor`, `.markdown`, Angular form events). |
| **ChatGPT** (`chatgpt.com`) | Adaptable | Requires matching content script selectors for input textarea and response blocks. |
| **Claude** (`claude.ai`) | Adaptable | Requires matching content script selectors for input contenteditable and output nodes. |
| **DeepSeek / Custom Web UIs** | Adaptable | Works with any web frontend by updating container and input selectors in `content.js`. |

---

## Protocol Specification

M.A.L.A commands must be wrapped in strict protocol delimiters.

| Delimiter Syntax | Action Type | Description | Example |
|:---|:---|:---|:---|
| `\|PS\| <command> \|PS\|` | `EXEC_SHELL` | Executes a command via PowerShell. | `\|PS\| Get-ChildItem \|PS\|` |
| `\|READ\| <path>:<start>-<end> \|READ\|` | `READ_FILE` | Reads a line-numbered slice of a file. Supports Windows drive letters (`D:\...`). Line range is optional. | `\|READ\| D:\projects\app.py:1-50 \|READ\|` |
| `\|WRITE\| <path>\n<content>\n\|WRITE\|` | `WRITE_FILE` | Creates or overwrites a file. | See example below. |
| `\|PATCH\| <path>\n<<<<<<< SEARCH\n<old>\n=======\n<new>\n>>>>>>> REPLACE \|PATCH\|` | `PATCH_FILE` | Performs a surgical search-and-replace edit. | See example below. |
| `\|ENDTASK\| <summary> \|ENDTASK\|` | `END_TASK` | Signals that the task is finished and terminates the feedback loop. | `\|ENDTASK\| Fixed syntax errors and verified app.py compiles. \|ENDTASK\|` |

### Write Example

```text
|WRITE| D:\projects\app.py
import sys
print('Hello from M.A.L.A')
|WRITE|
```

### Patch Example

```text
|PATCH| D:\projects\src\config.py
<<<<<<< SEARCH
DEBUG = True
PORT = 8000
=======
DEBUG = False
PORT = 8765
>>>>>>> REPLACE |PATCH|
```

### End Task Example

```text
|ENDTASK|
Successfully implemented the Shunting Yard algorithm and verified execution.
|ENDTASK|
```

---

## Project Structure

```text
M.A.L.A/
├── Local Daemon/
│   ├── main.py              # Daemon entry point & orchestrator
│   ├── server.py            # Async WebSocket server with PING/PONG & disconnect monitoring
│   ├── protocol.py          # Command dispatcher & completion handler
│   ├── approval.py          # Interactive CLI prompt handler (asyncio.to_thread)
│   ├── shell_executor.py    # PowerShell subprocess manager with single-approval gate
│   └── file_manager.py      # Range reader, file writer, and patch applier
│
├── Extension/
│   ├── manifest.json        # Manifest V3 extension configuration
│   ├── background.js        # Service worker managing WebSocket transport & tab locking
│   ├── content.js           # Gemini DOM observer, parser, keepalive, and text injector
│   ├── assets/              # Extension icons (16px, 48px, 128px)
│   └── popup/
│       ├── popup.html       # Control panel UI
│       ├── popup.css        # Popup stylesheet
│       └── popup.js         # Master toggle & bound tab status display controller
│
└── Workspace/               # Default execution workspace for local agent operations
```

---

## Installation & Setup

### Prerequisites

- **OS:** Windows 10 / 11
- **Python:** Python 3.10+ (Python 3.12 recommended)
- **Browser:** Google Chrome (or any Chromium-based browser with Manifest V3 support)

### 1. Daemon Setup

Clone or place the project repository at your preferred path (e.g., `D:\projects\M.A.L.A`).

Open a terminal and launch the Python daemon:

**PowerShell**

```powershell
py "Local Daemon\main.py"
```

Confirm that the server starts successfully:

```text
[INFO] Starting M.A.L.A Daemon Orchestrator...
[INFO] M.A.L.A Daemon listening on ws://127.0.0.1:8765
```

### 2. Extension Installation

1. Open Google Chrome and navigate to `chrome://extensions/`.
2. Enable **Developer mode** using the toggle in the top-right corner.
3. Click **Load unpacked**.
4. Select the `Extension` directory (e.g., `D:\projects\M.A.L.A\Extension`).
5. Verify that the M.A.L.A icon appears in your extensions bar.

---

## Usage Guide

1. **Start the Daemon:** Ensure `py "Local Daemon\main.py"` is running in a terminal window.

2. **Open Gemini:** Navigate to [https://gemini.google.com](https://gemini.google.com).

3. **Check Connection Status:** Click the M.A.L.A extension icon in your Chrome toolbar. The status indicator should display **Daemon Connected** in green.

4. **Initialize System Prompt:** Paste the M.A.L.A System Initialization Prompt (below) into your first message to configure protocol awareness.

5. **Execute Tasks:** Issue task requests. When Gemini outputs protocol blocks, approve execution in your daemon terminal by typing `y` and pressing Enter.

---

## System Initialization Prompt

Paste the following into a fresh chat with Gemini to configure the model for M.A.L.A execution.
(The Complete prompt is also given in the repository as systemprompt.txt)

```text
[SYSTEM INSTRUCTION: M.A.L.A (Make Any LLM Agentic) INITIALIZATION]

You are now connected to a local workspace via the M.A.L.A bridge system. You have direct access to execute shell commands, read file slices, overwrite files, and apply surgical search-and-replace patches on the local machine using strict protocol delimiters.

### 1. Protocol Delimiters & Command Syntax

To interact with the local daemon, you MUST wrap actions in exact protocol tags:

Shell Execution:
|PS| <powershell_command> |PS|

Read File Line Range (Windows full paths supported):
|READ| <file_path>:<start_line>-<end_line> |READ|

Overwrite / Create File:
|WRITE| <file_path>
<full_file_content>
|WRITE|

Surgical Search-and-Replace Patch:
|PATCH| <file_path>
<<<<<<< SEARCH
<exact_existing_lines_to_replace>
=======
<new_replacement_lines>
>>>>>>> REPLACE |PATCH|

Task Completion (Signals that the goal is achieved and stops the loop):
|ENDTASK|
<summary_of_completed_work>
|ENDTASK|

### 2. Strict Output Formatting Rules (CRITICAL)

1. CODE FENCING FOR FILE CONTENTS:
   Always wrap the code content inside |WRITE| and |PATCH| in a standard code fence (```python ... ``` or ```text ... ```). This protects Python indentation, spaces, and special names (like __init__) from being mangled or stripped by the Markdown renderer.

   Example:
   |WRITE| D:\projects\app.py
   ```python
   import sys

   class Calculator:
       def __init__(self):
           self.value = 0
   ```
   |WRITE|

2. PRESERVE EXACT SYNTAX & INDENTATION:
   Write code with exact spaces and indentation.

3. ONE COMMAND PER MESSAGE:
   Output strictly ONE protocol command per message and wait for the daemon feedback before proceeding to the next step.

4. SELF-HEALING ERROR LOOP:
   When you receive [M.A.L.A Execution Result - Status: ERROR], read the returned stderr/stdout, analyse the stack trace, and issue a corrected protocol command.

5. SURGICAL EDITS:
   Prefer |PATCH| over full-file |WRITE| when editing existing code to save tokens and prevent regressions.

6. ABSOLUTE PATHS:
   Always use full absolute file paths starting with the drive letter (e.g., D:\projects\...).

7. COMPLETION:
   When you have confirmed that the objective is achieved (e.g., code tested and verified), output |ENDTASK| with a final summary. Do NOT output any further commands once the task is complete.

---

### INITIALIZATION REQUIREMENT (FIRST RESPONSE ONLY)

Acknowledge receipt of this system initialization prompt.

Do NOT issue any protocol delimiters yet. Instead, confirm you understand the M.A.L.A protocol and prompt the user to provide the following three setup parameters:

1. Objective:
   What task or project are we building/debugging today?

2. Working Directory:
   What is the root directory path for this session?

3. "Dietary Restrictions" (System Quirks & Environment Restrictions):
   Are there any specific environment requirements or hardware constraints?
```

---

## Security & Approval Model

- **Local Host Isolation:** The WebSocket server listens strictly on `127.0.0.1:8765`, preventing remote network access through the listening interface.
- **Human-in-the-Loop:** Every `EXEC_SHELL`, `WRITE_FILE`, and `PATCH_FILE` operation requires interactive terminal authorisation (`y/n`) before execution. Approval is asked exactly once per command.
- **Single-Tab Lock:** Execution and feedback injection are bound to the specific Gemini tab executing the task, preventing accidental interference across multiple open tabs.
- **Non-Destructive Reads:** `READ_FILE` operates strictly within designated line ranges to minimise memory footprint and token usage.

---

## License

**Proprietary License (View and Run Only)**

Copyright (c) M.A.L.A Project. All rights reserved.

Permission is hereby granted to any person obtaining a copy of this software and associated documentation files (the "Software") to view and execute the Software for personal, non-commercial, or evaluation purposes only.

Modifying, copying, redistributing, sublicensing, creating derivative works, or publishing spinoffs of this Software, in whole or in part, without prior written authorisation from the copyright holder is strictly prohibited.
