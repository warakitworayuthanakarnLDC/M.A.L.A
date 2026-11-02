import asyncio
import json
import logging
from typing import Callable, Optional, Awaitable
import websockets
from websockets.server import WebSocketServerProtocol

logging.basicConfig(level=logging.INFO, format="[%(asctime)s] %(levelname)s - %(message)s")


class MalaWebSocketServer:
    def __init__(self, host: str = "127.0.0.1", port: int = 8765):
        self.host = host
        self.port = port
        self.active_connection: Optional[WebSocketServerProtocol] = None
        self.message_handler: Optional[Callable[[dict], Awaitable[dict]]] = None

    def set_handler(self, handler: Callable[[dict], Awaitable[dict]]) -> None:
        """Registers the main request router (from protocol.py)."""
        self.message_handler = handler

    async def _connection_handler(self, websocket: WebSocketServerProtocol) -> None:
        """Handles incoming browser extension WebSocket connections."""
        self.active_connection = websocket
        logging.info(f"Extension connected from {websocket.remote_address}")

        try:
            async for raw_message in websocket:
                try:
                    data = json.loads(raw_message)
                    logging.info(f"Received action request: {data.get('type')}")

                    if self.message_handler:
                        response = await self.message_handler(data)
                        if response:
                            await websocket.send(json.dumps(response))
                    else:
                        await websocket.send(json.dumps({
                            "status": "ERROR",
                            "error": "No execution handler attached to server."
                        }))

                except json.JSONDecodeError:
                    logging.error("Received malformed JSON message from extension.")
                    await websocket.send(json.dumps({
                        "status": "ERROR",
                        "error": "Payload is not valid JSON."
                    }))

        except websockets.exceptions.ConnectionClosedError:
            logging.warning("Extension connection closed abruptly.")
        finally:
            self.active_connection = None
            logging.info("Extension disconnected.")

    async def start(self) -> None:
        """Starts the asynchronous WebSocket server listener loop."""
        async with websockets.serve(self._connection_handler, self.host, self.port):
            logging.info(f"M.A.L.A Daemon listening on ws://{self.host}:{self.port}")
            await asyncio.get_running_loop().create_future()