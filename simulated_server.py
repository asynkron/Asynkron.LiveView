#!/usr/bin/env python3
"""Tiny simulated LiveView server exposing the `/agent-feed` WebSocket.

This allows integration testing of `clihost.py` without running the full stack.
Use together with `tests/test_clihost_sim.py` or manually via:

    python simulated_server.py --port 8765

Then, in another shell:

    ./run_clihost.sh --url ws://127.0.0.1:8765/agent-feed -- python -u simple_agent.py

"""

import argparse
import asyncio
import json
import logging
import signal
import sys
import time
from typing import Set

import websockets

logger = logging.getLogger("simulated_server")


class SimulatedServer:
    def __init__(self, host: str, port: int) -> None:
        self.host = host
        self.port = port
        self._clients: Set[websockets.WebSocketServerProtocol] = set()
        self._server = None

    async def handler(self, websocket):
        logger.info("client connected")
        self._clients.add(websocket)
        try:
            await websocket.send(
                json.dumps(
                    {
                        "type": "hello",
                        "message": "Simulated server connected",
                        "timestamp": time.time(),
                    }
                )
            )
            async for message in websocket:
                logger.info("client -> server: %s", message)
        finally:
            self._clients.discard(websocket)
            logger.info("client disconnected")

    async def start(self) -> None:
        logger.info("starting websocket server on ws://%s:%d/agent-feed", self.host, self.port)
        self._server = await websockets.serve(self.handler, self.host, self.port)

    async def stop(self) -> None:
        logger.info("shutting down websocket server")
        if self._server is not None:
            self._server.close()
            await self._server.wait_closed()
            self._server = None

    async def broadcast_chat(self, text: str) -> None:
        if not self._clients:
            return
        payload = json.dumps({"type": "chat", "text": text, "timestamp": time.time()})
        await asyncio.gather(*[client.send(payload) for client in list(self._clients)])


async def _interactive(server: SimulatedServer) -> None:
    loop = asyncio.get_running_loop()
    stop_event = asyncio.Event()

    def handle_sigint(*_args) -> None:
        logger.info("received interrupt, shutting down")
        stop_event.set()

    loop.add_signal_handler(signal.SIGINT, handle_sigint)
    loop.add_signal_handler(signal.SIGTERM, handle_sigint)

    await server.start()

    async def broadcaster() -> None:
        idx = 1
        while not stop_event.is_set():
            await server.broadcast_chat(f"ping #{idx}")
            idx += 1
            await asyncio.sleep(1.0)

    broadcaster_task = asyncio.create_task(broadcaster())
    await stop_event.wait()
    broadcaster_task.cancel()
    try:
        await broadcaster_task
    except asyncio.CancelledError:
        pass
    await server.stop()


def main() -> None:
    parser = argparse.ArgumentParser(description="Simulated LiveView WebSocket server")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--log-level", default="INFO")
    args = parser.parse_args()

    logging.basicConfig(level=getattr(logging, args.log_level.upper(), logging.INFO))
    server = SimulatedServer(args.host, args.port)

    try:
        asyncio.run(_interactive(server))
    except KeyboardInterrupt:
        print("Interrupted", file=sys.stderr)


if __name__ == "__main__":
    main()
