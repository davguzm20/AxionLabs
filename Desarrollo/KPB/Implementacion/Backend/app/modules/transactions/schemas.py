"""Modelos Pydantic (Schemas) para el módulo de Transacciones por Texto (CU02).

Define los contratos de entrada y salida respetando las convenciones de KPB-Specs:
- Montos financieros formateados como string con dos decimales ("15.00").
- Identificadores en formato UUID.
- Fechas ISO (YYYY-MM-DD) y tiempos UTC ISO 8601.
"""

from __future__ import annotations

import uuid
from pydantic import BaseModel, ConfigDict, Field


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

