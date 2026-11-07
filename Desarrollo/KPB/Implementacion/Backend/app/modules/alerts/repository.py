"""Acceso a datos de umbrales y alertas."""

from __future__ import annotations

import uuid
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.entities import Alert, BudgetThreshold


def thresholds_of(db: Session, budget_id: uuid.UUID) -> list[BudgetThreshold]:
    """Todos los umbrales del presupuesto, activos e inactivos."""
    stmt = (
        select(BudgetThreshold)
        .where(BudgetThreshold.budget_id == budget_id)
        .order_by(BudgetThreshold.percentage, BudgetThreshold.created_at)
    )
    return list(db.execute(stmt).scalars().all())


def issued_threshold_ids(
    db: Session, budget_id: uuid.UUID, period_start: date
) -> set[uuid.UUID]:
    """Umbrales que ya emitieron alerta en el periodo."""
    stmt = select(Alert.threshold_id).where(
        Alert.budget_id == budget_id,
        Alert.period_start == period_start,
        Alert.threshold_id.is_not(None),
    )
    return set(db.execute(stmt).scalars().all())


def thresholds_of_many(
    db: Session, budget_ids: list[uuid.UUID]
) -> dict[uuid.UUID, list[BudgetThreshold]]:
    """Umbrales activos de varios presupuestos en una sola consulta."""
    result: dict[uuid.UUID, list[BudgetThreshold]] = {budget_id: [] for budget_id in budget_ids}
    if not budget_ids:
        return result
    stmt = (
        select(BudgetThreshold)
        .where(BudgetThreshold.budget_id.in_(budget_ids), BudgetThreshold.is_active.is_(True))
        .order_by(BudgetThreshold.percentage)
    )
    for threshold in db.execute(stmt).scalars().all():
        result[threshold.budget_id].append(threshold)
    return result


def issued_in_periods(
    db: Session, periods: dict[uuid.UUID, date]
) -> set[tuple[uuid.UUID, uuid.UUID]]:
    """Pares (presupuesto, umbral) que ya alertaron en el periodo indicado de cada uno."""
    if not periods:
        return set()
    stmt = select(Alert.budget_id, Alert.threshold_id, Alert.period_start).where(
        Alert.budget_id.in_(list(periods)),
        Alert.period_start.in_(set(periods.values())),
        Alert.threshold_id.is_not(None),
    )
    return {
        (budget_id, threshold_id)
        for budget_id, threshold_id, period_start in db.execute(stmt).all()
        if periods[budget_id] == period_start
    }
