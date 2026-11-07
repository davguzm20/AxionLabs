"""Periodo vigente de un presupuesto (03-domain/calculations.md).

Compartido por el CU07 (KPB-CTG) y el CU08 (KPB-MA).
"""

from __future__ import annotations

import calendar
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from app.entities import Budget, PeriodType

LIMA_TZ = ZoneInfo("America/Lima")


def today_lima() -> date:
    return datetime.now(LIMA_TZ).date()


def has_started(budget: Budget, today: date) -> bool:
    """Un periodo personalizado futuro aun no empieza: su consumo es 0."""
    return budget.period_type != PeriodType.PERSONALIZADO or today >= budget.start_date


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
