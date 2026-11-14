"""=============================================================================
KPB-RTV: COMPONENTE DE REGISTRO DE TRANSACCIÓN POR VOZ (CU03)
=============================================================================
Este archivo representa el entregable oficial de Línea Base para el Caso de Uso CU03.

Objetivo:
Permitir que un usuario dicte un gasto o ingreso en una nota de voz corta. El sistema
valida el audio en memoria (sin guardarlo nunca), lo transcribe, extrae y clasifica los
datos y muestra una vista previa editable de 10 minutos. La transacción solo se guarda
cuando el usuario confirma, junto con el texto transcrito.

Flujo en dos pasos (Regla BR-037):
1. POST /api/v1/transactions/voice -> Validación, transcripción, extracción y vista previa.
2. POST /api/v1/transactions/voice/confirm -> Confirmación, guardado, saldo y alertas (CU08).

Módulos y componentes articulados:
- Router: app.modules.transactions.router (endpoints /voice y /voice/confirm)
- Servicio: app.modules.transactions.service (create_voice_preview, confirm_voice,
  persist_confirmed, compartido con CU02 y CU04)
- Schemas: app.modules.transactions.schemas (VoicePreviewResponse, VoiceConfirmRequest)
- Validación de audio: app.modules.transactions.audio_validation
- Transcripción: app.integrations.ai.transcription (simulada por ahora)
- Vista previa: app.integrations.redis.previews (clave preview:{id}, TTL 10 min)
- Límite por usuario: app.integrations.redis.rate_limit

Pendiente: transcripción real con Whisper (requiere agregar la librería openai).
=============================================================================
"""

from app.integrations.ai.transcription import Transcription, transcribe
from app.integrations.redis.previews import ReceiptPreviewStore, get_voice_preview_store
from app.integrations.redis.rate_limit import RateLimiter, get_rate_limiter
from app.modules.transactions.audio_validation import (
    MAX_AUDIO_BYTES,
    MAX_AUDIO_SECONDS,
    ValidatedAudio,
    detect_audio_type,
    validate_audio,
)
from app.modules.transactions.router import router
from app.modules.transactions.schemas import (
    TextTransactionResponse,
    VoiceConfirmRequest,
    VoicePreviewResponse,
)
from app.modules.transactions.service import (
    clean_transcript,
    confirm_voice,
    create_voice_preview,
    persist_confirmed,
)

__all__ = [
    "MAX_AUDIO_BYTES",
    "MAX_AUDIO_SECONDS",
    "RateLimiter",
    "ReceiptPreviewStore",
    "TextTransactionResponse",
    "Transcription",
    "ValidatedAudio",
    "VoiceConfirmRequest",
    "VoicePreviewResponse",
    "clean_transcript",
    "confirm_voice",
    "create_voice_preview",
    "detect_audio_type",
    "get_rate_limiter",
    "get_voice_preview_store",
    "persist_confirmed",
    "router",
    "transcribe",
    "validate_audio",
]
