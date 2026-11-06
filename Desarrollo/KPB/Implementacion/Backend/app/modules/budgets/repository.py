"""Lecturas de presupuestos y consumo que necesita el CU08."""

from __future__ import annotations

import uuid
from datetime import date, datetime, time, timedelta
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.entities import (
    Budget,
    BudgetStatus,
    Currency,
    Transaction,
    TransactionStatus,
    TransactionType,
    quantize_money,
)
from app.modules.budgets.periods import LIMA_TZ


def get_budget(
    db: Session, user_id: uuid.UUID, budget_id: uuid.UUID, for_update: bool = False
) -> Budget | None:
    """Presupuesto del usuario; uno ajeno se trata como inexistente."""
    stmt = select(Budget).where(Budget.budget_id == budget_id, Budget.user_id == user_id)
    if for_update:
        stmt = stmt.with_for_update()
    return db.execute(stmt).scalars().first()


def active_budgets_for_expense(
    db: Session, user_id: uuid.UUID, category_id: uuid.UUID, currency: Currency
) -> list[Budget]:
    """Presupuestos activos que afecta un gasto.

    Se bloquean para serializar los gastos simultaneos: el segundo espera, ve el
    consumo del primero y encuentra sus alertas, de modo que ningun cruce se pierde
    ni se duplica aunque los gastos salgan de monederos distintos.
    """
    stmt = (
        select(Budget)
        .where(
            Budget.user_id == user_id,
            Budget.category_id == category_id,
            Budget.currency == currency,
            Budget.status == BudgetStatus.ACTIVO,
        )
        .order_by(Budget.budget_id)
        .with_for_update()
    )
    return list(db.execute(stmt).scalars().all())


def consumed_in_period(db: Session, budget: Budget, start: date, end: date) -> Decimal:
    """Suma los gastos de la categoria y moneda del presupuesto dentro del periodo."""
    stmt = select(func.coalesce(func.sum(Transaction.amount), 0)).where(
        Transaction.user_id == budget.user_id,
        Transaction.category_id == budget.category_id,
        Transaction.type == TransactionType.GASTO,
        Transaction.currency == budget.currency,
        Transaction.status == TransactionStatus.CONFIRMADA,
        Transaction.transacted_at >= datetime.combine(start, time.min, LIMA_TZ),
        Transaction.transacted_at < datetime.combine(end + timedelta(days=1), time.min, LIMA_TZ),
    )
    return quantize_money(db.execute(stmt).scalar_one())
