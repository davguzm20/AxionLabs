"""Modelos Pydantic (Schemas) para el módulo de Transacciones (CU02 - Texto y CU04 - Foto/OCR).

Define los contratos de entrada y salida respetando las convenciones de KPB-Specs:
- Montos financieros formateados como string con dos decimales ("15.00").
- Identificadores en formato UUID.
- Fechas ISO (YYYY-MM-DD) y tiempos UTC ISO 8601.
"""

from __future__ import annotations

import uuid
from pydantic import BaseModel, ConfigDict, Field


# =============================================================================
# Schemas compartidos y de CU02 (Texto libre)
# =============================================================================

class TextTransactionRequest(BaseModel):
    """Payload para registrar una transacción a partir de texto libre."""

    model_config = ConfigDict(extra="ignore")

    text: str = Field(
        min_length=1,
        max_length=500,
        description="Texto libre en lenguaje natural (ej: 'Gasté 15 soles en el menú').",
    )
    wallet_id: uuid.UUID | None = Field(
        default=None,
        description="ID del monedero donde se aplicará la transacción (opcional, usa el predeterminado si es null).",
    )
    client_timezone: str = Field(
        default="America/Lima",
        description="Zona horaria para resolver fechas relativas como 'hoy' o 'ayer'.",
    )


class TransactionCorrectionRequest(BaseModel):
    """Payload para corregir categoría o concepto de una transacción ya registrada."""

    model_config = ConfigDict(extra="ignore")

    category_id: uuid.UUID | None = Field(
        default=None,
        description="Nuevo ID de categoría asignada a la transacción.",
    )
    concept: str | None = Field(
        default=None,
        min_length=1,
        max_length=200,
        description="Nuevo concepto o descripción de la transacción.",
    )


class CategoryInfo(BaseModel):
    """Información simplificada de la categoría para la tarjeta de confirmación."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    icon: str | None = "tag"


class TransactionOut(BaseModel):
    """Detalle completo de la transacción registrada."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    type: str  # "EXPENSE" o "INCOME"
    amount: str  # String decimal exacto: "15.00"
    currency: str  # "PEN" o "USD"
    concept: str | None
    merchant: str | None = None
    transaction_date: str  # "YYYY-MM-DD"
    wallet_id: uuid.UUID
    category: CategoryInfo
    source: str = "TEXT"
    needs_review: bool = False
    created_at: str


class TextTransactionResponse(BaseModel):
    """Respuesta HTTP 201 devuelta al registrar una transacción por texto."""

    transaction: TransactionOut
    wallet_balance: str  # Nuevo saldo del monedero (puede ser negativo: "-15.00")
    alerts: list[dict] = Field(default_factory=list, description="Alertas emitidas si cruza presupuestos")
    message: str  # Mensaje amigable de confirmación para el chat


# =============================================================================
# Schemas para CU04 (Registro de Transacción por Foto / OCR)
# =============================================================================

class ExtractedReceiptData(BaseModel):
    """Datos extraídos del comprobante físico por la IA de visión."""

    type: str = "EXPENSE"
    amount: str | None = Field(default=None, description="Monto total detectado en formato decimal")
    currency: str | None = Field(default="PEN", description="PEN o USD")
    concept: str | None = Field(default=None, description="Concepto o descripción breve")
    merchant: str | None = Field(default=None, description="Nombre del comercio o emisor")
    ruc: str | None = Field(default=None, description="RUC del emisor si fue identificado (11 dígitos)")
    transaction_date: str | None = Field(default=None, description="Fecha de emisión YYYY-MM-DD")
    category: CategoryInfo | None = Field(default=None, description="Categoría tentativa asignada")


class ReceiptPreviewResponse(BaseModel):
    """Respuesta HTTP 200 con la vista previa del comprobante extraído (Paso 1)."""

    preview_id: uuid.UUID = Field(description="Identificador temporal de la vista previa (TTL 10 min)")
    ocr_text: str | None = Field(default=None, description="Texto plano extraído de la imagen para referencia")
    extracted: ExtractedReceiptData = Field(description="Campos desglosados del comprobante")
    confidence: float = Field(default=0.85, description="Nivel de confianza de la extracción entre 0 y 1")
    requires_confirmation: bool = Field(default=True, description="Indica que requiere confirmación explícita")


class ReceiptConfirmRequest(BaseModel):
    """Payload enviado por el usuario para confirmar y guardar la transacción por foto (Paso 2)."""

    model_config = ConfigDict(extra="ignore")

    preview_id: uuid.UUID = Field(description="ID de la vista previa temporal obtenido en el Paso 1")
    type: str = Field(default="EXPENSE", description="Tipo de movimiento (EXPENSE o INCOME)")
    amount: str = Field(description="Monto final verificado o corregido por el usuario (ej: '45.90')")
    currency: str = Field(default="PEN", description="Moneda de la transacción (PEN o USD)")
    concept: str = Field(min_length=1, max_length=200, description="Concepto del gasto")
    merchant: str | None = Field(default=None, description="Nombre del comercio")
    ruc: str | None = Field(default=None, description="RUC del emisor si corresponde")
    transaction_date: str = Field(description="Fecha de la transacción en formato YYYY-MM-DD")
    category_id: uuid.UUID = Field(description="ID de la categoría confirmada")
    wallet_id: uuid.UUID = Field(description="ID del monedero al que se aplicará el cargo")
