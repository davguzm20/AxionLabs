"""Validación de notas de voz en memoria (CU03, BR-081 y BR-082).

El formato se decide por la firma real de los bytes, no por la extensión ni por el
Content-Type del navegador. Sin dependencias, la duración solo se puede leer en WAV;
en los demás formatos la informa el proveedor de transcripción.
"""

from __future__ import annotations

import struct
from dataclasses import dataclass

from app.core.errors import AppError

MAX_AUDIO_BYTES = 5 * 1024 * 1024
MAX_AUDIO_SECONDS = 60


@dataclass(frozen=True)
class ValidatedAudio:
    data: bytes
    mime_type: str
    duration_seconds: float | None


def unsupported_media() -> AppError:
    return AppError(415, "UNSUPPORTED_MEDIA_TYPE", "Usa webm, ogg, mp4, mpeg o wav.")


def audio_too_long() -> AppError:
    return AppError(422, "AUDIO_TOO_LONG", "El audio supera los 60 segundos.")


def audio_too_large() -> AppError:
    return AppError(413, "AUDIO_TOO_LARGE", "El audio supera los 5 MB.")


def detect_audio_type(data: bytes) -> str | None:
    """Tipo MIME según la firma del archivo, o None si no es un formato permitido."""
    if data.startswith(b"\x1a\x45\xdf\xa3") and b"webm" in data[:64]:
        return "audio/webm"
    if data.startswith(b"OggS"):
        return "audio/ogg"
    if data[:4] == b"RIFF" and data[8:12] == b"WAVE":
        return "audio/wav"
    if data[4:8] == b"ftyp":
        return "audio/mp4"
    if data.startswith(b"ID3") or (len(data) > 1 and data[0] == 0xFF and data[1] & 0xE0 == 0xE0):
        return "audio/mpeg"
    return None


def wav_duration(data: bytes) -> float:
    """Duración de un WAV a partir de sus bloques `fmt ` y `data`."""
    byte_rate = None
    position = 12
    while position + 8 <= len(data):
        chunk_id = data[position : position + 4]
        (size,) = struct.unpack("<I", data[position + 4 : position + 8])
        body = position + 8
        if chunk_id == b"fmt " and size >= 16 and body + 12 <= len(data):
            (byte_rate,) = struct.unpack("<I", data[body + 8 : body + 12])
        elif chunk_id == b"data":
            if not byte_rate:
                break
            return size / byte_rate
        position = body + size + (size % 2)
    raise unsupported_media()


def validate_audio(data: bytes) -> ValidatedAudio:
    if len(data) > MAX_AUDIO_BYTES:
        raise audio_too_large()
    mime_type = detect_audio_type(data)
    if mime_type is None:
        raise unsupported_media()
    duration = wav_duration(data) if mime_type == "audio/wav" else None
    if duration is not None and duration > MAX_AUDIO_SECONDS:
        raise audio_too_long()
    return ValidatedAudio(data=data, mime_type=mime_type, duration_seconds=duration)
