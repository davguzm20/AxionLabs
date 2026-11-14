"""Almacén temporal de vistas previas de comprobantes (CU04 / Slice 006).

Reglas de KPB-Specs:
- Clave: {prefijo}:{preview_id}; receipt:preview para comprobantes (CU04) y preview
  para notas de voz (CU03).
- TTL: 600 segundos (10 minutos).
- Solo almacena datos textuales extraídos (monto, comercio, RUC, fecha, concepto,
  ocr_text o transcript).
- NUNCA almacena la imagen, el audio ni sus bytes.
"""

from __future__ import annotations

import json
import logging
import time
import uuid
from typing import Any

from pydantic import ValidationError

from app.config import get_auth_settings

logger = logging.getLogger(__name__)

# TTL oficial de la vista previa: 10 minutos (600 segundos)
RECEIPT_PREVIEW_TTL_SECONDS = 600

# Caché en memoria volátil de respaldo para desarrollo local si Redis no estuviera disponible
_memory_previews: dict[str, tuple[dict[str, Any], float]] = {}
_memory_locks: dict[str, float] = {}

RECEIPT_PREFIX = "receipt:preview"
VOICE_PREFIX = "preview"
# Lo que puede tardar una confirmación; después el candado se libera solo.
CONFIRM_LOCK_SECONDS = 30


class ReceiptPreviewStore:
    """Gestiona el ciclo de vida del preview de comprobantes en Redis o memoria."""

    def __init__(self, redis_client: Any | None = None, prefix: str = RECEIPT_PREFIX) -> None:
        self._redis = redis_client
        self._prefix = prefix

    def _key(self, preview_id: uuid.UUID) -> str:
        return f"{self._prefix}:{preview_id}"

    def lock(self, preview_id: uuid.UUID) -> bool:
        """Reserva el preview para una sola confirmación a la vez.

        Devuelve False si otra confirmación del mismo preview está en curso: así un
        reintento simultáneo no crea la transacción dos veces.
        """
        key = f"{self._key(preview_id)}:lock"
        if self._redis is not None:
            try:
                return bool(self._redis.set(key, "1", nx=True, ex=CONFIRM_LOCK_SECONDS))
            except Exception as exc:
                logger.warning(f"Error reservando preview en Redis, usando memoria: {exc}")
        now = time.time()
        if _memory_locks.get(key, 0) > now:
            return False
        _memory_locks[key] = now + CONFIRM_LOCK_SECONDS
        return True

    def unlock(self, preview_id: uuid.UUID) -> None:
        key = f"{self._key(preview_id)}:lock"
        if self._redis is not None:
            try:
                self._redis.delete(key)
            except Exception as exc:
                logger.warning(f"Error liberando preview en Redis: {exc}")
        _memory_locks.pop(key, None)

    def save(
        self,
        preview_id: uuid.UUID,
        user_id: uuid.UUID,
        data: dict[str, Any],
        ttl_seconds: int = RECEIPT_PREVIEW_TTL_SECONDS,
    ) -> None:
        """Guarda los datos extraídos de la boleta de forma temporal."""
        payload = {
            "user_id": str(user_id),
            "data": data,
        }
        key = self._key(preview_id)

        if self._redis is not None:
            try:
                self._redis.set(key, json.dumps(payload), ex=ttl_seconds)
                return
            except Exception as exc:
                logger.warning(f"Error escribiendo preview en Redis, usando memoria: {exc}")

        # Fallback en memoria volátil
        expires_at = time.time() + ttl_seconds
        _memory_previews[key] = (payload, expires_at)

    def get(self, preview_id: uuid.UUID, user_id: uuid.UUID) -> dict[str, Any] | None:
        """Obtiene el preview si existe, pertenece al usuario y no ha expirado."""
        key = self._key(preview_id)

        if self._redis is not None:
            try:
                raw = self._redis.get(key)
                if raw is not None:
                    payload = json.loads(raw)
                    if payload.get("user_id") == str(user_id):
                        return payload.get("data")
                    return None
            except Exception as exc:
                logger.warning(f"Error leyendo preview de Redis, buscando en memoria: {exc}")

        # Fallback en memoria volátil
        entry = _memory_previews.get(key)
        if entry is None:
            return None

        payload, expires_at = entry
        if time.time() > expires_at:
            _memory_previews.pop(key, None)
            return None

        if payload.get("user_id") == str(user_id):
            return payload.get("data")

        return None

    def delete(self, preview_id: uuid.UUID) -> None:
        """Elimina el preview tras la confirmación o descarte."""
        key = self._key(preview_id)

        if self._redis is not None:
            try:
                self._redis.delete(key)
            except Exception as exc:
                logger.warning(f"Error eliminando preview de Redis: {exc}")

        _memory_previews.pop(key, None)


def _build_store(prefix: str) -> ReceiptPreviewStore:
    try:
        from app.integrations.redis.sessions import _client

        redis_url = get_auth_settings().redis_url
        client = _client(redis_url)
        return ReceiptPreviewStore(client, prefix)
    except (ValidationError, Exception) as exc:
        logger.info(f"Usando almacén de previews en memoria ({exc})")
        return ReceiptPreviewStore(None, prefix)


def get_preview_store() -> ReceiptPreviewStore:
    """Inyector de dependencias para FastAPI (comprobantes, CU04)."""
    return _build_store(RECEIPT_PREFIX)


def get_voice_preview_store() -> ReceiptPreviewStore:
    """Inyector de dependencias para FastAPI (notas de voz, CU03)."""
    return _build_store(VOICE_PREFIX)

