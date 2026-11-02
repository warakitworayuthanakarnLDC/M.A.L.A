import logging
from approval import request_approval
from shell_executor import execute_shell_command
from file_manager import read_file_range, write_file, apply_patch

logging.basicConfig(level=logging.INFO, format="[%(asctime)s] %(levelname)s - %(message)s")


async def handle_protocol_message(payload: dict) -> dict:
    """Dispatches incoming JSON protocol action payloads to corresponding handlers."""
    msg_type = payload.get("type")

    if msg_type == "EXEC_SHELL":
        command = payload.get("command", "")
        # Added 'await' here
        if not await request_approval("EXEC_SHELL", command):
            return {"status": "DENIED", "output": "Shell execution denied by user."}
        return await execute_shell_command(command)

    elif msg_type == "READ_FILE":
        path = payload.get("path", "")
        start = payload.get("start_line", 1)
        end = payload.get("end_line", 100)
        return await read_file_range(path, start, end)

    elif msg_type == "WRITE_FILE":
        path = payload.get("path", "")
        content = payload.get("content", "")
        return await write_file(path, content)

    elif msg_type == "PATCH_FILE":
        path = payload.get("path", "")
        search = payload.get("search", "")
        replace = payload.get("replace", "")
        return await apply_patch(path, search, replace)

    else:
        return {"status": "ERROR", "output": f"Unknown protocol action type: {msg_type}"}


process_message = handle_protocol_message