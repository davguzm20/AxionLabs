"""Transcripción de notas de voz (CU03, 12-prompts/system-prompts/transcribe.md).

Por ahora solo hay transcriptor simulado: la librería `openai` no está en las
dependencias del backend. Para usar Whisper basta con implementar un adaptador
(modelo OPENAI_STT_MODEL, provisional whisper-1; idioma es; temperatura 0;
`response_format="verbose_json"` para obtener la duración) y elegirlo en `transcribe`.
"""

from __future__ import annotations

from dataclasses import dataclass

MOCK_TRANSCRIPT = "Gasté 15 soles en el menú"


@dataclass(frozen=True)
class Transcription:
    text: str
    # Segundos de audio según el proveedor; None si no lo informa (el mock).
    duration_seconds: float | None = None


def transcribe(audio: bytes, mime_type: str, language: str = "es-PE") -> Transcription:
    """Transcribe el audio en memoria. Nunca lo escribe en disco ni lo registra en logs."""
    return Transcription(text=MOCK_TRANSCRIPT)
