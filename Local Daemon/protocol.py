import logging
from shell_executor import execute_shell_command
from file_manager import read_file_range, write_file, apply_patch

logging.basicConfig(level=logging.INFO, format="[%(asctime)s] %(levelname)s - %(message)s")


async def process_message(data: dict) -> dict:
    """Parses incoming WebSocket JSON payloads from the Chrome extension and routes to appropriate handlers[cite: 1]."""
    action_type = data.get("type", "").upper()
    logging.info(f"Processing action type: {action_type}")

    try:
        if action_type == "EXEC_SHELL":
            command = data.get("command", "")
            if not command:
                return {"status": "ERROR", "output": "Missing 'command' parameter."}
            timeout = data.get("timeout", 30)
            return await execute_shell_command(command, timeout=timeout)

        elif action_type == "READ_FILE":
            file_path = data.get("path", "")
            if not file_path:
                return {"status": "ERROR", "output": "Missing 'path' parameter."}
            start_line = int(data.get("start_line", 1))
            end_line = int(data.get("end_line", 200))
            return await read_file_range(file_path, start_line, end_line)

        elif action_type == "WRITE_FILE":
            file_path = data.get("path", "")
            content = data.get("content", "")
            if not file_path:
                return {"status": "ERROR", "output": "Missing 'path' parameter."}
            return await write_file(file_path, content)

        elif action_type == "PATCH_FILE":
            file_path = data.get("path", "")
            search_block = data.get("search", "")
            replace_block = data.get("replace", "")
            if not file_path or not search_block:
                return {"status": "ERROR", "output": "Missing required patch parameters ('path', 'search')."}
            return await apply_patch(file_path, search_block, replace_block)

        else:
            logging.warning(f"Received unknown action type: {action_type}")
            return {
                "status": "ERROR",
                "output": f"Unknown action type: '{action_type}'"
            }

    except Exception as e:
        logging.error(f"Error handling protocol message: {e}")
        return {
            "status": "ERROR",
            "output": f"Internal daemon error: {str(e)}"
        }


