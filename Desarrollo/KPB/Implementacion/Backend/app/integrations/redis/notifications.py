"""Publicacion de eventos de notificaciones en Redis, canal `user:{user_id}`."""

from __future__ import annotations

import json
import logging
import uuid
from functools import lru_cache

import redis
from pydantic import ValidationError

from app.config import get_auth_settings

logger = logging.getLogger(__name__)


def user_channel(user_id: uuid.UUID) -> str:
    return f"user:{user_id}"


class NotificationBus:
    """Entrega en tiempo real, sin garantia.

    Nunca lanza: la notificacion ya esta guardada y el cliente la recarga al
    reconectarse (CU08 EX5), asi que un fallo de Redis no debe afectar la peticion.
    """

    def __init__(self, client: redis.Redis | None) -> None:
        self._redis = client

    def publish(self, user_id: uuid.UUID, event: str, event_id: str, data: dict) -> None:
        if self._redis is None:
            return
        message = json.dumps({"event": event, "id": event_id, "data": data})
        try:
            self._redis.publish(user_channel(user_id), message)
        except redis.RedisError as error:
            logger.warning("No se pudo publicar %s: %s", event, type(error).__name__)


@lru_cache
def _client(redis_url: str) -> redis.Redis:
    return redis.Redis.from_url(
        redis_url, decode_responses=True, socket_connect_timeout=2, socket_timeout=2
    )


def get_notification_bus() -> NotificationBus:
    """Dependencia de FastAPI. Sin Redis configurado, no publica nada."""
    try:
        redis_url = get_auth_settings().redis_url
    except ValidationError:
        return NotificationBus(None)
    return NotificationBus(_client(redis_url))
