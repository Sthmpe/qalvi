"""Keep the current real-session worker alive briefly across a browser refresh."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable

REFRESH_GRACE_SECONDS = 120.0


class ReconnectGrace:
    def __init__(self, identity: str, expire: Callable[[], Awaitable[None]],
                 seconds: float = REFRESH_GRACE_SECONDS,
                 present: Callable[[], bool] | None = None):
        self.identity = identity
        self._expire = expire
        self._seconds = seconds
        # Authoritative room membership at expiry. Event order alone is not
        # trusted: a participant who is in the room is never timed out.
        self._present = present
        self._task: asyncio.Task[None] | None = None
        self._closed = False

    def disconnected(self, identity: str) -> bool:
        if self._closed or identity != self.identity:
            return False
        if self._task is None:
            self._task = asyncio.create_task(self._wait())
        return True

    def connected(self, identity: str) -> bool:
        if self._closed or identity != self.identity:
            return False
        if self._task is not None:
            self._task.cancel()
            self._task = None
        return True

    async def _wait(self) -> None:
        await asyncio.sleep(self._seconds)
        if self._present is not None and self._present():
            self._task = None
            return
        self._closed = True
        await self._expire()

    async def close(self) -> None:
        self._closed = True
        task, self._task = self._task, None
        if task is not None and task is not asyncio.current_task():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
