"""Almacén temporal de vistas previas de comprobantes (CU04 / Slice 006).

Reglas de KPB-Specs:
- Clave: receipt:preview:{preview_id}
- TTL: 600 segundos (10 minutos).
- Solo almacena datos textuales extraídos (monto, comercio, RUC, fecha, concepto, ocr_text).
- NUNCA almacena la imagen ni sus bytes.
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


class ReceiptPreviewStore:
    """Gestiona el ciclo de vida del preview de comprobantes en Redis o memoria."""

    def __init__(self, redis_client: Any | None = None) -> None:
        self._redis = redis_client

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
        key = f"receipt:preview:{preview_id}"

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
        key = f"receipt:preview:{preview_id}"

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
        key = f"receipt:preview:{preview_id}"

        if self._redis is not None:
            try:
                self._redis.delete(key)
            except Exception as exc:
                logger.warning(f"Error eliminando preview de Redis: {exc}")

        _memory_previews.pop(key, None)


def get_preview_store() -> ReceiptPreviewStore:
    """Inyector de dependencias para FastAPI."""
    try:
        from app.integrations.redis.sessions import _client

        redis_url = get_auth_settings().redis_url
        client = _client(redis_url)
        return ReceiptPreviewStore(client)
    except (ValidationError, Exception) as exc:
        logger.info(f"Usando almacén de previews en memoria ({exc})")
        return ReceiptPreviewStore(None)

