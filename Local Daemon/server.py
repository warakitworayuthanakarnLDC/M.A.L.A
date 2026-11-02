import asyncio
import json
import logging
import websockets
from protocol import handle_protocol_message

logging.basicConfig(level=logging.INFO, format="[%(asctime)s] %(levelname)s - %(message)s")


class MALAServer:
    def __init__(self, host: str = "127.0.0.1", port: int = 8765):
        self.host = host
        self.port = port
        self.handler_func = None

    def set_handler(self, handler_func):
        """Registers the protocol dispatch function from main.py."""
        self.handler_func = handler_func

    async def handler(self, websocket):
        client_address = websocket.remote_address
        logging.info(f"Extension connected from {client_address}")

        try:
            async for message in websocket:
                try:
                    payload = json.loads(message)
                except json.JSONDecodeError:
                    logging.error("Received malformed JSON packet from extension.")
                    await websocket.send(
                        json.dumps({
                            "status": "ERROR",
                            "output": "Invalid JSON format received by daemon."
                        })
                    )
                    continue

                # 1. Heartbeat Handler: Intercept PING packets and reply with PONG
                if payload.get("type") == "PING":
                    await websocket.send(json.dumps({"type": "PONG"}))
                    continue

                # 2. Command Dispatch: Pass payload through registered handler
                logging.info(f"Processing command type: {payload.get('type')}")
                if self.handler_func:
                    response = await self.handler_func(payload)
                else:
                    response = await handle_protocol_message(payload)
                
                await websocket.send(json.dumps(response))

        except websockets.exceptions.ConnectionClosedOK:
            logging.info(f"Extension disconnected cleanly: {client_address}")
        except websockets.exceptions.ConnectionClosedError as e:
            logging.warning(f"Extension connection closed unexpectedly ({e.code}): {client_address}")
        except Exception as e:
            logging.error(f"Unexpected server error during handling: {e}")

    async def start(self):
        logging.info(f"M.A.L.A Daemon listening on ws://{self.host}:{self.port}")
        async with websockets.serve(self.handler, self.host, self.port):
            await asyncio.Future()


# Class alias to satisfy main.py imports
MalaWebSocketServer = MALAServer


def run_server():
    server = MALAServer()
    asyncio.run(server.start())


if __name__ == "__main__":
    run_server()