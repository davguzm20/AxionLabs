"""Periodo vigente de un presupuesto (03-domain/calculations.md).

Parte minima del CU07 que necesita el CU08: el CRUD de presupuestos queda en KPB-CTG.
"""

from __future__ import annotations

import calendar
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from app.entities import Budget, PeriodType

LIMA_TZ = ZoneInfo("America/Lima")


def today_lima() -> date:
    return datetime.now(LIMA_TZ).date()


def current_period(budget: Budget, today: date) -> tuple[date, date]:
    """Devuelve (period_start, period_end), ambos inclusive."""
    if budget.period_type == PeriodType.SEMANAL:
        start = today - timedelta(days=today.weekday())
        return start, start + timedelta(days=6)

    if budget.period_type == PeriodType.MENSUAL:
        last_day = calendar.monthrange(today.year, today.month)[1]
        return today.replace(day=1), today.replace(day=last_day)

    days = budget.period_days
    start = budget.start_date
    if today >= start:
        start += timedelta(days=((today - start).days // days) * days)
    return start, start + timedelta(days=days - 1)
