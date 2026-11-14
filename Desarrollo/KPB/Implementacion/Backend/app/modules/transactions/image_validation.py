"""Validación y preparación de imágenes de comprobantes en memoria (CU04 / Slice 006).

Reglas de KPB-Specs:
- Formatos soportados: image/jpeg, image/png (.jpg, .jpeg, .png).
- Formatos rechazados: PDF, WebP, HEIC, GIF, etc. -> 415 UNSUPPORTED_MEDIA_TYPE.
- Tamaño máximo permitido: 8 MB -> 413 FILE_TOO_LARGE.
- Dimensiones mínimas 200x200, máximas 6000x6000.
- Redimensionado en memoria a máx. 1600 px del lado mayor para optimizar tokens y latencia.
- La imagen se procesa exclusivamente en memoria volátil (nunca se escribe en disco).
"""

from __future__ import annotations

import io
import logging
from dataclasses import dataclass

from app.core.errors import AppError

logger = logging.getLogger(__name__)

# Límites según especificaciones normativas de KPB-Specs (BR-079)
MAX_FILE_SIZE_BYTES = 8 * 1024 * 1024  # 8 Megabytes
ALLOWED_MIME_TYPES = {"image/jpeg", "image/png"}
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png"}
MAX_DIMENSION_PX = 1600  # Lado mayor tras redimensionado en memoria
MIN_DIMENSION_PX = 200
MAX_SOURCE_DIMENSION_PX = 6000


@dataclass
class ValidatedImage:
    """Contenedor de la imagen validada y optimizada en memoria."""

    data: bytes  # Bytes de la imagen optimizada (JPEG)
    mime_type: str  # "image/jpeg"
    width: int
    height: int


def _detect_magic_mime(header: bytes) -> str | None:
    """Detecta el tipo MIME real inspeccionando los primeros bytes (Magic Bytes)."""
    if header.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if header.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if header.startswith(b"%PDF"):
        return "application/pdf"
    if header.startswith(b"RIFF") and b"WEBP" in header[:16]:
        return "image/webp"
    return None


def validate_and_prepare_image(
    file_bytes: bytes,
    filename: str | None = None,
    declared_content_type: str | None = None,
) -> ValidatedImage:
    """Valida tamaño, formato y dimensiones de la imagen del comprobante.

    Redimensiona proporcionalmente en memoria a máx. 1600 px de lado mayor.
    Lanza AppError con los códigos estándar si no cumple los requisitos.
    """
    # 1. Validar tamaño máximo (8 MB)
    if len(file_bytes) > MAX_FILE_SIZE_BYTES:
        raise AppError(
            413,
            "FILE_TOO_LARGE",
            "La imagen supera el límite máximo permitido de 8 MB.",
        )

    if len(file_bytes) == 0:
        raise AppError(
            422,
            "IMAGE_INVALID",
            "El archivo de imagen está vacío.",
        )

    # 2. Validar extensión si se proporcionó un nombre de archivo
    if filename:
        lower_name = filename.lower()
        if not any(lower_name.endswith(ext) for ext in ALLOWED_EXTENSIONS):
            raise AppError(
                415,
                "UNSUPPORTED_MEDIA_TYPE",
                "Formato no compatible. Solo se admiten comprobantes en formato JPG o PNG.",
            )

    # 3. Validar tipo MIME real mediante Magic Bytes
    detected_mime = _detect_magic_mime(file_bytes[:32])
    actual_mime = detected_mime or declared_content_type

    if actual_mime not in ALLOWED_MIME_TYPES:
        raise AppError(
            415,
            "UNSUPPORTED_MEDIA_TYPE",
            "Formato de archivo no admitido. Solo se aceptan imágenes JPG o PNG.",
        )

    # 4. Validar dimensiones y redimensionar en memoria con Pillow
    try:
        from PIL import Image

        try:
            image = Image.open(io.BytesIO(file_bytes))
            image.load()  # Fuerza lectura completa para verificar que no esté corrupta
        except Exception as exc:
            raise AppError(
                422,
                "IMAGE_INVALID",
                "La imagen enviada está dañada o no se puede procesar.",
            ) from exc

        width, height = image.size

        # Validar dimensiones extremas
        if width < MIN_DIMENSION_PX or height < MIN_DIMENSION_PX:
            raise AppError(
                422,
                "IMAGE_UNCLEAR",
                "La resolución de la imagen es demasiado baja para leer el comprobante.",
            )

        if width > MAX_SOURCE_DIMENSION_PX or height > MAX_SOURCE_DIMENSION_PX:
            raise AppError(
                422,
                "IMAGE_INVALID",
                "Las dimensiones de la imagen exceden el límite soportado.",
            )

        # Convertir a RGB si es necesario (ej: PNG RGBA o paletas)
        if image.mode in ("RGBA", "LA", "P"):
            background = Image.new("RGB", image.size, (255, 255, 255))
            if image.mode == "P":
                image = image.convert("RGBA")
            background.paste(image, mask=image.split()[-1] if "A" in image.mode else None)
            image = background
        elif image.mode != "RGB":
            image = image.convert("RGB")

        # Redimensionar en memoria si el lado mayor supera los 1600 px
        max_side = max(width, height)
        if max_side > MAX_DIMENSION_PX:
            scale = MAX_DIMENSION_PX / max_side
            new_width = int(width * scale)
            new_height = int(height * scale)
            image = image.resize((new_width, new_height), Image.Resampling.LANCZOS)
            width, height = new_width, new_height

        # Exportar a BytesIO como JPEG calidad 85 (sin tocar disco)
        output_buffer = io.BytesIO()
        image.save(output_buffer, format="JPEG", quality=85, optimize=True)
        optimized_bytes = output_buffer.getvalue()

        return ValidatedImage(
            data=optimized_bytes,
            mime_type="image/jpeg",
            width=width,
            height=height,
        )

    except ImportError:
        logger.warning("Pillow no está disponible; omitiendo redimensionado en memoria.")
        return ValidatedImage(
            data=file_bytes,
            mime_type=actual_mime or "image/jpeg",
            width=800,
            height=600,
        )

