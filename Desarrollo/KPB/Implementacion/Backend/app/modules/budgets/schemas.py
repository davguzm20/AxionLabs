"""Contratos de presupuestos (04-api/endpoints/budgets.md).

Moneda, monto y periodo llegan como texto y se validan en el servicio, para responder
los codigos del CU07 (INVALID_AMOUNT, INVALID_PERIOD...) en vez de VALIDATION_ERROR.
"""

from __future__ import annotations

import uuid
from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, StrictInt

from app.modules.alerts.schemas import ThresholdOut


class BudgetCreate(BaseModel):
    category_id: uuid.UUID
    currency: str
    amount: str
    period_type: str
    start_date: date | None = None
    period_days: StrictInt | None = None
    thresholds: list[StrictInt] | None = None


class BudgetUpdate(BaseModel):
    """Categoria y moneda son inmutables: enviarlas responde 422 VALIDATION_ERROR."""

    model_config = ConfigDict(extra="forbid")

    amount: str | None = None
    period_type: str | None = None
    start_date: date | None = None
    period_days: StrictInt | None = None
    status: Literal["ACTIVE", "INACTIVE"] | None = None


class BudgetCategory(BaseModel):
    id: uuid.UUID
    name: str
    icon: str


class BudgetOut(BaseModel):
    id: uuid.UUID
    category: BudgetCategory
    currency: str
    amount: str
    period_type: str
    start_date: date | None
    period_days: int | None
    period_start: date
    period_end: date
    consumed: str
    remaining: str
    percentage: float
    status: str
    thresholds: list[ThresholdOut]


class BudgetList(BaseModel):
    data: list[BudgetOut]


class BudgetImpact(BaseModel):
    consumed: str
    remaining: str
    percentage: float
    will_exceed: bool
