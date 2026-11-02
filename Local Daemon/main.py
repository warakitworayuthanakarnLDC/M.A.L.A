import asyncio
import logging
import signal
import sys
from server import MalaWebSocketServer
from protocol import process_message

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] %(levelname)s - %(message)s"
)


async def main() -> None:
    """Entry point for the M.A.L.A local daemon."""
    server = MalaWebSocketServer(host="127.0.0.1", port=8765)
    
    # Register protocol router from protocol.py
    server.set_handler(process_message)
    
    logging.info("Starting M.A.L.A Daemon Orchestrator...")
    
    # Platform-specific signal handling for graceful exit
    loop = asyncio.get_running_loop()
    if sys.platform != "win32":
        for sig in (signal.SIGINT, signal.SIGTERM):
            loop.add_signal_handler(sig, lambda: asyncio.create_task(shutdown(loop)))
    
    try:
        await server.start()
    except (asyncio.CancelledError, KeyboardInterrupt):
        logging.info("Shutdown signal received.")
    finally:
        logging.info("M.A.L.A Daemon shut down cleanly.")


async def shutdown(loop: asyncio.AbstractEventLoop) -> None:
    """Cancels running tasks and stops the event loop gracefully."""
    logging.info("Cleaning up background tasks...")
    tasks = [t for t in asyncio.all_tasks() if t is not asyncio.current_task()]
    for task in tasks:
        task.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)
    loop.stop()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n[M.A.L.A] Daemon stopped by user.")