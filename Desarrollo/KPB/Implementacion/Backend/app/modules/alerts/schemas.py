"""Contratos de alertas y umbrales (04-api/openapi.yaml)."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Literal

from pydantic import BaseModel, StrictInt


def iso_utc(value: datetime) -> str:
    """ISO 8601 en UTC con Z (04-api/conventions.md)."""
    return value.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


class AlertOut(BaseModel):
    """Alerta emitida. `title` y `body` son el texto que muestra AlertCard en el chat."""

    id: uuid.UUID
    budget_id: uuid.UUID
    category: str
    percentage: int
    consumed: str
    limit: str
    remaining: str
    priority: Literal["NORMAL", "HIGH"]
    created_at: str
    title: str
    body: str


class ThresholdCreate(BaseModel):
    percentage: StrictInt


class ThresholdReplace(BaseModel):
    thresholds: list[StrictInt]


class ThresholdOut(BaseModel):
    id: uuid.UUID
    percentage: int
    triggered: bool


class ThresholdList(BaseModel):
    data: list[ThresholdOut]
