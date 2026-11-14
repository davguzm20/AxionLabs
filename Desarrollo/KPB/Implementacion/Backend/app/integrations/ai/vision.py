"""Servicio de visión artificial y OCR para comprobantes de pago (CU04 / Slice 006).

Implementa el prompt oficial de KPB-Specs (12-prompts/system-prompts/extract-receipt.md).
Soporta:
1. OpenAI Vision (gpt-4o-mini) enviando la imagen en memoria como base64 data URL.
2. Extractor simulado (Mock) si no hay clave de OpenAI, para pruebas locales sin costo.
"""

from __future__ import annotations

import base64
import json
import logging
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from zoneinfo import ZoneInfo

from app.config import get_ai_settings
from app.core.errors import AppError

logger = logging.getLogger(__name__)
LIMA_TZ = ZoneInfo("America/Lima")


@dataclass
class ExtractedReceipt:
    """Datos leídos del comprobante de pago."""

    amount: Decimal | None
    currency: str | None
    merchant: str | None
    ruc: str | None
    transaction_date: date | None
    concept: str | None
    ocr_text: str | None
    confidence: float


# Prompt de sistema oficial de KPB-Specs
RECEIPT_SYSTEM_PROMPT = """Eres un extractor de datos de comprobantes de pago peruanos (boletas y facturas) para KhipuBot.

Recibes una imagen JPG o PNG. Extrae solo lo que sea legible.

Reglas:
- No inventes datos. Si no puedes leer un campo, usa null.
- El monto total debe ser el total pagado, no el subtotal ni el IGV.
- Devuelve el monto como string decimal con dos decimales, sin símbolo de moneda: "45.90".
- Moneda: PEN si dice S/, soles o /; USD si dice $ o dólares. Si no se distingue, null.
- Fecha: YYYY-MM-DD. Si no se lee, null.
- RUC: 11 dígitos, sin guiones. Si no se lee, null.
- merchant: nombre del comercio/proveedor.
- concept: descripción breve; si no hay, usa el nombre del comercio.
- ocr_text: texto visible más relevante (máx. 2000 caracteres). No incluyas datos personales innecesarios.
- confidence: 0 a 1.
- No devuelvas explicaciones ni markdown.

Esquema JSON:
{
  "amount": string | null,
  "currency": "PEN" | "USD" | null,
  "merchant": string | null,
  "ruc": string | null,
  "transaction_date": string | null,
  "concept": string | null,
  "ocr_text": string | null,
  "confidence": number
}
"""


def _extract_with_openai_vision(
    image_bytes: bytes,
    mime_type: str,
    api_key: str,
    model: str,
    today_str: str,
    default_currency: str,
) -> ExtractedReceipt:
    """Invoca el modelo multimodal de OpenAI enviando la imagen en base64 en memoria."""
    try:
        from openai import OpenAI, OpenAIError
    except ImportError:
        logger.warning(
            "Librería 'openai' no instalada. Usando extractor simulado como respaldo."
        )
        return _extract_with_mock(today_str, default_currency)

    try:
        client = OpenAI(api_key=api_key, timeout=20.0)

        # Codificar imagen en memoria a base64
        base64_data = base64.b64encode(image_bytes).decode("utf-8")
        data_url = f"data:{mime_type};base64,{base64_data}"

        user_prompt = (
            f"Extrae los datos de esta imagen de comprobante.\n"
            f"Fecha de hoy en America/Lima: {today_str}\n"
            f"Moneda por defecto: {default_currency}"
        )

        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": RECEIPT_SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": user_prompt},
                        {
                            "type": "image_url",
                            "image_url": {"url": data_url, "detail": "high"},
                        },
                    ],
                },
            ],
            response_format={"type": "json_object"},
            temperature=0.1,
        )

        content = response.choices[0].message.content or "{}"
        data = json.loads(content)

        # Parsear monto decimal
        raw_amount = data.get("amount")
        amount = None
        if raw_amount:
            try:
                amount = Decimal(str(raw_amount).replace(",", "."))
            except InvalidOperation:
                amount = None

        # Parsear fecha
        raw_date = data.get("transaction_date")
        tx_date = None
        if raw_date:
            try:
                tx_date = date.fromisoformat(raw_date)
            except ValueError:
                tx_date = None

        # Validar RUC (11 dígitos)
        ruc = data.get("ruc")
        if ruc and (len(str(ruc)) != 11 or not str(ruc).isdigit()):
            ruc = None

        return ExtractedReceipt(
            amount=amount,
            currency=data.get("currency") or default_currency,
            merchant=data.get("merchant"),
            ruc=ruc,
            transaction_date=tx_date,
            concept=data.get("concept") or data.get("merchant") or "Consumo de comprobante",
            ocr_text=data.get("ocr_text"),
            confidence=float(data.get("confidence", 0.85)),
        )

    except OpenAIError as exc:
        logger.error(f"Error conectando con OpenAI Vision: {exc}")
        raise AppError(
            503,
            "OCR_UNAVAILABLE",
            "El servicio de lectura de comprobantes no está disponible. Intenta nuevamente.",
        ) from exc


def _extract_with_mock(today_str: str, default_currency: str) -> ExtractedReceipt:
    """Extractor simulado para pruebas locales sin costo ni consumo de API."""
    today = date.fromisoformat(today_str)
    return ExtractedReceipt(
        amount=Decimal("45.90"),
        currency=default_currency,
        merchant="Supermercado Metro",
        ruc="20100055237",
        transaction_date=today,
        concept="Supermercado Metro",
        ocr_text="CENCOSUD RETAIL PERU S.A.\nRUC: 20100055237\nBOLETA DE VENTA ELECTRONICA\nTOTAL S/ 45.90\nCANCELADO",
        confidence=0.88,
    )


def extract_receipt_from_image(
    image_bytes: bytes,
    mime_type: str = "image/jpeg",
    default_currency: str = "PEN",
) -> ExtractedReceipt:
    """Extrae los datos de la boleta/factura en memoria usando OpenAI Vision o Mock."""
    settings = get_ai_settings()
    today_str = datetime.now(LIMA_TZ).date().isoformat()

    if (
        settings.openai_api_key
        and settings.openai_api_key.strip() != ""
        and settings.openai_api_key.lower() != "mock"
    ):
        return _extract_with_openai_vision(
            image_bytes=image_bytes,
            mime_type=mime_type,
            api_key=settings.openai_api_key,
            model=settings.openai_vision_model,
            today_str=today_str,
            default_currency=default_currency,
        )

    return _extract_with_mock(today_str, default_currency)

