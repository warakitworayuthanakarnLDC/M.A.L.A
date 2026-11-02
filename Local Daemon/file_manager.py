import asyncio
import logging
from pathlib import Path
from approval import request_approval

logging.basicConfig(level=logging.INFO, format="[%(asctime)s] %(levelname)s - %(message)s")


async def read_file_range(file_path: str, start_line: int = 1, end_line: int = 200) -> dict:
    """Reads a line-ranged slice from a local file and prepends 1-indexed line numbers[cite: 1]."""
    path = Path(file_path)
    if not path.is_file():
        return {
            "status": "ERROR",
            "output": f"File not found: {file_path}"
        }

    try:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines(keepends=True)
        total_lines = len(lines)

        # Convert to 1-based indexing for range slicing[cite: 1]
        start_idx = max(0, start_line - 1)
        end_idx = min(total_lines, end_line)

        selected_lines = lines[start_idx:end_idx]
        formatted_output = []

        for idx, line in enumerate(selected_lines, start=start_idx + 1):
            formatted_output.append(f"{idx:4d} | {line}")

        result_text = "".join(formatted_output)
        if not result_text:
            result_text = "(File region is empty)"

        return {
            "status": "SUCCESS",
            "total_lines": total_lines,
            "output": result_text
        }

    except Exception as e:
        logging.error(f"Error reading file {file_path}: {e}")
        return {
            "status": "ERROR",
            "output": f"Failed to read file: {str(e)}"
        }


async def write_file(file_path: str, content: str) -> dict:
    """Creates or overwrites a file with the given string content after user approval[cite: 1]."""
    path = Path(file_path)
    action_desc = f"File Path : {file_path}\nContent Preview ({len(content)} chars):\n{content[:200]}..."

    approved = await request_approval("WRITE_FILE", action_desc)
    if not approved:
        return {
            "status": "DENIED",
            "output": "File write operation denied by user."
        }

    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        logging.info(f"File successfully written: {file_path}")
        return {
            "status": "SUCCESS",
            "output": f"Successfully wrote {len(content)} characters to {file_path}"
        }
    except Exception as e:
        logging.error(f"Failed writing to file {file_path}: {e}")
        return {
            "status": "ERROR",
            "output": f"File write error: {str(e)}"
        }


async def apply_patch(file_path: str, search_block: str, replace_block: str) -> dict:
    """Applies a surgical search-and-replace patch block to an existing file[cite: 1]."""
    path = Path(file_path)
    if not path.is_file():
        return {
            "status": "ERROR",
            "output": f"File not found for patching: {file_path}"
        }

    patch_desc = (
        f"File Path : {file_path}\n"
        f"<<<<<<< SEARCH\n{search_block}\n"
        f"=======\n{replace_block}\n>>>>>>> REPLACE"
    )

    approved = await request_approval("PATCH_FILE", patch_desc)
    if not approved:
        return {
            "status": "DENIED",
            "output": "Patch application denied by user."
        }

    try:
        content = path.read_text(encoding="utf-8")

        if search_block not in content:
            logging.warning(f"Patch search block not found in {file_path}")
            return {
                "status": "ERROR",
                "output": "Patch failed: Exact 'SEARCH' block was not found in target file."
            }

        # Swap target search block once[cite: 1]
        updated_content = content.replace(search_block, replace_block, 1)
        path.write_text(updated_content, encoding="utf-8")
        logging.info(f"Successfully patched file: {file_path}")

        return {
            "status": "SUCCESS",
            "output": f"Successfully patched {file_path}"
        }
    except Exception as e:
        logging.error(f"Error patching file {file_path}: {e}")
        return {
            "status": "ERROR",
            "output": f"Patch error: {str(e)}"
        }