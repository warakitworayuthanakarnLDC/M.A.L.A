import asyncio
import logging
from approval import request_approval

logging.basicConfig(level=logging.INFO, format="[%(asctime)s] %(levelname)s - %(message)s")


async def execute_shell_command(command: str, timeout: int = 30) -> dict:
    """Asynchronously executes a shell command with user approval and process timeouts."""
    approved = await request_approval("EXEC_SHELL", command)
    if not approved:
        return {
            "status": "DENIED",
            "output": "Command execution denied by user."
        }

    try:
        process = await asyncio.create_subprocess_shell(
            command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )

        try:
            stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=timeout)
            out_str = stdout.decode(errors="replace").strip()
            err_str = stderr.decode(errors="replace").strip()

            combined_output = out_str
            if err_str:
                combined_output += f"\n[STDERR]\n{err_str}" if combined_output else err_str

            if not combined_output:
                combined_output = "(Command executed successfully with no stdout/stderr output)"

            status = "SUCCESS" if process.returncode == 0 else "ERROR"
            return {
                "status": status,
                "returncode": process.returncode,
                "output": combined_output
            }

        except asyncio.TimeoutError:
            process.kill()
            await process.wait()
            logging.error(f"Command execution timed out after {timeout} seconds: {command}")
            return {
                "status": "TIMEOUT",
                "output": f"Command execution timed out after {timeout} seconds."
            }

    except Exception as e:
        logging.error(f"Failed to launch shell process '{command}': {e}")
        return {
            "status": "ERROR",
            "output": f"Execution error: {str(e)}"
        }