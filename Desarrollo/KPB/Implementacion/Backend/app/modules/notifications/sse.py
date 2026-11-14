"""Canal SSE de notificaciones: un canal Redis por usuario, 5 conexiones como maximo."""

from __future__ import annotations

import json
import uuid
from collections.abc import AsyncIterator

import anyio
import redis
from pydantic import ValidationError
from redis import asyncio as aioredis

from app.config import get_auth_settings
from app.core.errors import AppError
from app.integrations.redis.notifications import user_channel

MAX_CONNECTIONS = 5
HEARTBEAT_SECONDS = 25.0
CLEANUP_SECONDS = 2


def _unavailable() -> AppError:
    return AppError(
        503, "SERVICE_UNAVAILABLE", "El servicio no está disponible. Intenta más tarde."
    )


def get_stream_client() -> aioredis.Redis:
    """Dependencia de FastAPI: un cliente propio por stream, que `_events` cierra al terminar."""
    try:
        redis_url = get_auth_settings().redis_url
    except ValidationError as error:
        raise _unavailable() from error
    return aioredis.from_url(redis_url, decode_responses=True)


def format_event(raw: str) -> str:
    message = json.loads(raw)
    data = json.dumps(message["data"], ensure_ascii=False)
    return f"event: {message['event']}\nid: {message['id']}\ndata: {data}\n\n"


def _connection_key(user_id: uuid.UUID) -> str:
    return f"sse:connections:{user_id}"


def _connection_ttl(heartbeat: float) -> int:
    """Si el proceso muere sin limpiar, el contador se libera solo."""
    return int(heartbeat * 2) + 10


async def open_stream(
    client: aioredis.Redis,
    user_id: uuid.UUID,
    session_id: str,
    heartbeat: float,
) -> AsyncIterator[str]:
    """Reserva la conexion y se suscribe antes de responder, para no perder eventos."""
    key = _connection_key(user_id)
    try:
        connections = await client.incr(key)
        await client.expire(key, _connection_ttl(heartbeat))
        if connections > MAX_CONNECTIONS:
            await client.decr(key)
            await client.aclose()
            raise AppError(429, "RATE_LIMITED", "Demasiadas solicitudes. Intenta en un momento.")
        pubsub = client.pubsub()
        await pubsub.subscribe(user_channel(user_id))
    except redis.RedisError as error:
        await client.aclose()
        raise _unavailable() from error
    return _events(client, pubsub, key, session_id, heartbeat)


async def _events(
    client: aioredis.Redis,
    pubsub: aioredis.client.PubSub,
    connection_key: str,
    session_id: str,
    heartbeat: float,
) -> AsyncIterator[str]:
    """Genera el stream hasta que el cliente se desconecta o la sesion termina."""
    try:
        yield "retry: 3000\n\n"
        while True:
            message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=heartbeat)
            if message is not None:
                yield format_event(message["data"])
                continue
            # Sin renovar la sesion: escuchar no cuenta como actividad del usuario.
            if not await client.exists(f"session:{session_id}"):
                return
            await client.expire(connection_key, _connection_ttl(heartbeat))
            yield ": ping\n\n"
    except redis.RedisError:
        return  # El cliente se reconecta y recarga la bandeja.
    finally:
        # Protegido: al desconectarse el cliente, este generador queda cancelado.
        with anyio.move_on_after(CLEANUP_SECONDS, shield=True):
            try:
                await pubsub.aclose()
                if await client.decr(connection_key) <= 0:
                    await client.delete(connection_key)
            except redis.RedisError:
                pass  # El TTL libera el contador.
            finally:
                await client.aclose()
