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
