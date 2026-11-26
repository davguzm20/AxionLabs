"""Transcripción de notas de voz con OpenAI Whisper (CU03)."""

from __future__ import annotations

from dataclasses import dataclass
import io

from app.config import get_ai_settings
from app.core.errors import AppError


@dataclass(frozen=True)
class Transcription:
    text: str
    # Segundos de audio según el proveedor; None si no los informa.
    duration_seconds: float | None = None


def transcribe(audio: bytes, mime_type: str, language: str = "es-PE") -> Transcription:
    """Transcribe el audio en memoria. Nunca lo escribe en disco ni lo registra en logs."""
    settings = get_ai_settings()
    try:
        from openai import OpenAI, OpenAIError
    except ImportError as exc:
        raise AppError(
            503,
            "STT_UNAVAILABLE",
            "El servicio de transcripción de voz no está disponible. Intenta nuevamente más tarde.",
        ) from exc

    extension = ".m4a"
    if "webm" in mime_type:
        extension = ".webm"
    elif "ogg" in mime_type:
        extension = ".ogg"
    elif "mpeg" in mime_type or "mp3" in mime_type:
        extension = ".mp3"
    elif "wav" in mime_type:
        extension = ".wav"
    elif "mp4" in mime_type:
        extension = ".mp4"

    audio_buffer = io.BytesIO(audio)
    audio_buffer.name = f"audio{extension}"

    try:
        model_name = getattr(settings, "openai_stt_model", "whisper-1")

        client = OpenAI(
            api_key=settings.openai_api_key,
            timeout=15.0,
            max_retries=0,
        )
        response = client.audio.transcriptions.create(
            model=model_name,
            file=audio_buffer,
            language=language.split("-", 1)[0],
        )
    except OpenAIError as exc:
        print(f"\n[ERROR REAL DE OPENAI]: {type(exc).__name__} - {str(exc)}\n")
        raise AppError(
            503,
            "STT_UNAVAILABLE",
            "El servicio de transcripción de voz no está disponible. Intenta nuevamente más tarde.",
        ) from exc

    duration = getattr(response, "duration", None)
    return Transcription(text=response.text, duration_seconds=duration)