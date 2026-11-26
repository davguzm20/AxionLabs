"""Contratos de presupuestos (04-api/endpoints/budgets.md).

Moneda, monto y periodo llegan como texto y se validan en el servicio, para responder
los codigos del CU07 (INVALID_AMOUNT, INVALID_PERIOD...) en vez de VALIDATION_ERROR.
"""

from __future__ import annotations

import uuid
from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, StrictInt

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


class MonthlyCurrencyConsumption(BaseModel):
    currency: Literal["PEN", "USD"]
    amount: str


class BudgetWithoutCapOut(BaseModel):
    """Categoría disponible que todavía no tiene un presupuesto activo.

    ``GET /budgets`` es un catálogo de categorías de gasto con su presupuesto
    vigente, no únicamente una lista de filas de ``budgets``. Sin un tope no hay
    una moneda única ni un porcentaje comparable; el gasto del mes se devuelve
    separado por moneda.
    """

    id: None = None
    category: BudgetCategory
    currency: None = None
    amount: None = None
    period_type: None = None
    start_date: None = None
    period_days: None = None
    period_start: None = None
    period_end: None = None
    consumed: None = None
    remaining: None = None
    monthly_consumed_by_currency: list[MonthlyCurrencyConsumption] = Field(
        default_factory=list
    )
    status: Literal["NONE"] = "NONE"
    thresholds: list[ThresholdOut] = Field(default_factory=list)


class BudgetList(BaseModel):
    data: list[BudgetOut | BudgetWithoutCapOut]


class BudgetImpact(BaseModel):
    consumed: str
    remaining: str
    percentage: float
    will_exceed: bool
