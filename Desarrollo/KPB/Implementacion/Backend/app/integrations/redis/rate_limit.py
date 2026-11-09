"""Límite de solicitudes por usuario en ventanas de un minuto (OQ-P08, provisional)."""

from __future__ import annotations

import logging
import uuid

import redis
from pydantic import ValidationError

from app.config import get_auth_settings
from app.core.errors import AppError

logger = logging.getLogger(__name__)
WINDOW_SECONDS = 60


class RateLimiter:
    def __init__(self, client: redis.Redis | None) -> None:
        self._redis = client

    def hit(self, scope: str, user_id: uuid.UUID, limit: int) -> None:
        """Cuenta una solicitud; 429 si el usuario superó el límite del minuto.

        Si Redis no responde, se deja pasar: el límite protege costos, no datos.
        """
        if self._redis is None:
            return
        key = f"ratelimit:{scope}:{user_id}"
        try:
            count = self._redis.incr(key)
            if count == 1:
                self._redis.expire(key, WINDOW_SECONDS)
        except redis.RedisError as error:
            logger.warning("Rate limit no disponible: %s", type(error).__name__)
            return
        if count > limit:
            raise AppError(429, "RATE_LIMITED", "Demasiadas solicitudes. Intenta en un momento.")


def get_rate_limiter() -> RateLimiter:
    """Dependencia de FastAPI. Sin Redis configurado, no limita."""
    try:
        redis_url = get_auth_settings().redis_url
    except ValidationError:
        return RateLimiter(None)
    from app.integrations.redis.sessions import _client

    return RateLimiter(_client(redis_url))
