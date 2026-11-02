"""Sesiones en Redis con 20 min de inactividad (BR-011).

Claves:
    session:{sid}           -> JSON {user_id, created_at, last_activity_at, ip, user_agent}
    session:user:{user_id}  -> SET con los sid del usuario
"""

import json
import secrets
import uuid
from datetime import UTC, datetime
from functools import lru_cache

import redis
from pydantic import ValidationError

from app.config import get_auth_settings
from app.core.errors import AppError
from app.core.security import TOKEN_LIFETIME

SESSION_TTL_SECONDS = 1200


def auth_unavailable() -> AppError:
    return AppError(
        503, "AUTH_UNAVAILABLE", "No podemos iniciar sesión ahora. Intenta en unos minutos."
    )


class SessionStore:
    def __init__(self, client: redis.Redis) -> None:
        self._redis = client

    def create(self, user_id: uuid.UUID, ip: str | None, user_agent: str | None) -> str:
        sid = secrets.token_urlsafe(32)
        now = datetime.now(UTC).isoformat()
        data = {
            "user_id": str(user_id),
            "created_at": now,
            "last_activity_at": now,
            "ip": ip,
            "user_agent": user_agent,
        }
        user_key = f"session:user:{user_id}"
        try:
            pipe = self._redis.pipeline()
            pipe.set(f"session:{sid}", json.dumps(data), ex=SESSION_TTL_SECONDS)
            pipe.sadd(user_key, sid)
            pipe.expire(user_key, int(TOKEN_LIFETIME.total_seconds()))
            pipe.execute()
        except redis.RedisError as error:
            raise auth_unavailable() from error
        return sid

    def touch(self, sid: str) -> dict | None:
        """Renueva los 20 min y devuelve la sesion; None si expiro o no existe."""
        key = f"session:{sid}"
        try:
            raw = self._redis.get(key)
            if raw is None:
                return None
            data = json.loads(raw)
            data["last_activity_at"] = datetime.now(UTC).isoformat()
            self._redis.set(key, json.dumps(data), ex=SESSION_TTL_SECONDS)
        except redis.RedisError as error:
            raise auth_unavailable() from error
        return data

    def delete(self, sid: str, user_id: uuid.UUID) -> None:
        try:
            pipe = self._redis.pipeline()
            pipe.delete(f"session:{sid}")
            pipe.srem(f"session:user:{user_id}", sid)
            pipe.execute()
        except redis.RedisError as error:
            raise auth_unavailable() from error


@lru_cache
def _client(redis_url: str) -> redis.Redis:
    return redis.Redis.from_url(redis_url, decode_responses=True)


def get_session_store() -> SessionStore:
    """Dependencia de FastAPI."""
    try:
        redis_url = get_auth_settings().redis_url
    except ValidationError as error:
        raise auth_unavailable() from error
    return SessionStore(_client(redis_url))


class LockoutStore:
    """Intentos fallidos y bloqueo de 30 min por usuario (BR-012, BR-013).

    Claves:
        login:failures:{user_id}  -> contador de fallos consecutivos
        login:locked:{user_id}    -> existe mientras dura el bloqueo
    """

    MAX_FAILURES = 3
    LOCK_SECONDS = 1800

    def __init__(self, client: redis.Redis) -> None:
        self._redis = client

    def is_locked(self, user_id: uuid.UUID) -> bool:
        try:
            return bool(self._redis.exists(f"login:locked:{user_id}"))
        except redis.RedisError as error:
            raise auth_unavailable() from error

    def register_failure(self, user_id: uuid.UUID) -> bool:
        """Suma un fallo; devuelve True si con este la cuenta queda bloqueada."""
        key = f"login:failures:{user_id}"
        try:
            failures = self._redis.incr(key)
            self._redis.expire(key, self.LOCK_SECONDS)
            if failures < self.MAX_FAILURES:
                return False
            self._redis.set(f"login:locked:{user_id}", "1", ex=self.LOCK_SECONDS)
            self._redis.delete(key)
        except redis.RedisError as error:
            raise auth_unavailable() from error
        return True

    def clear(self, user_id: uuid.UUID) -> None:
        try:
            self._redis.delete(f"login:failures:{user_id}", f"login:locked:{user_id}")
        except redis.RedisError as error:
            raise auth_unavailable() from error


def get_lockout_store() -> LockoutStore:
    """Dependencia de FastAPI."""
    try:
        redis_url = get_auth_settings().redis_url
    except ValidationError as error:
        raise auth_unavailable() from error
    return LockoutStore(_client(redis_url))
