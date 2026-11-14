"""KPB-MA: logica del CU08 (evaluacion de umbrales y gestion de umbrales).

La evaluacion corre en la misma transaccion de BD que el gasto: si falla, el gasto
tambien se revierte (07-architecture/backend.md, RNF013). Quien la invoca hace el
commit y, despues, publica los eventos con `publish_alerts`.
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime
from decimal import Decimal

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.entities import (
    Alert,
    AlertPriority,
    AlertType,
    Budget,
    BudgetThreshold,
    Currency,
    Notification,
    Transaction,
    TransactionStatus,
    TransactionType,
    User,
    quantize_money,
)
from app.integrations.redis.notifications import NotificationBus
from app.modules.alerts import repository
from app.modules.alerts.schemas import AlertOut, ThresholdOut, iso_utc
from app.modules.budgets import repository as budgets_repository
from app.modules.budgets.periods import LIMA_TZ, current_period, has_started, today_lima

DEFAULT_THRESHOLD = 80
TITLE_MAX_LENGTH = 120
LEGACY_MESSAGE_MAX_LENGTH = 255
# Limite de alerts.detected_percentage: NUMERIC(6,2).
MAX_DETECTED_PERCENTAGE = Decimal("9999.99")
# La evaluacion es sincrona, con limite de 2 s (CU08).
EVALUATION_TIMEOUT = text("SET LOCAL statement_timeout = '2s'")


def _symbol(currency: Currency) -> str:
    return "S/" if currency == Currency.PEN else "$"


def build_title(category: str, percentage: int, remaining: Decimal) -> str:
    verb = "Alcanzaste" if percentage == 100 and remaining >= 0 else "Cruzaste"
    template = f"{verb} el {percentage}% de tu presupuesto de {{}}."
    room = TITLE_MAX_LENGTH - len(template) + 2
    name = category if len(category) <= room else f"{category[: room - 1]}…"
    return template.format(name)


def build_body(
    category: str,
    percentage: int,
    consumed: Decimal,
    limit: Decimal,
    remaining: Decimal,
    symbol: str,
) -> str:
    spent = f"Gastado: {symbol} {consumed:.2f} de {symbol} {limit:.2f}."
    if remaining < 0:
        return f"Superaste tu presupuesto de {category} en {symbol} {-remaining:.2f}. {spent}"
    if percentage == 100:
        return f"Límite: {symbol} {limit:.2f}. {spent}"
    return f"{spent} Te quedan {symbol} {remaining:.2f}."


def _detected_percentage(consumed: Decimal, limit: Decimal) -> Decimal:
    return min((consumed / limit * 100).quantize(Decimal("0.01")), MAX_DETECTED_PERCENTAGE)


def _emit(
    db: Session, budget: Budget, threshold: BudgetThreshold, period_start: date, consumed: Decimal
) -> AlertOut:
    """Crea la alerta y su notificacion UNREAD."""
    category = budget.category.name
    limit = quantize_money(budget.amount)
    remaining = limit - consumed
    title = build_title(category, threshold.percentage, remaining)
    body = build_body(
        category, threshold.percentage, consumed, limit, remaining, _symbol(budget.currency)
    )
    priority = AlertPriority.HIGH if threshold.percentage >= 100 else AlertPriority.NORMAL
    now = datetime.now(UTC)

    alert = Alert(
        alert_id=uuid.uuid4(),
        user_id=budget.user_id,
        budget_id=budget.budget_id,
        threshold_id=threshold.threshold_id,
        period_start=period_start,
        threshold_percentage=threshold.percentage,
        consumed=consumed,
        limit_amount=limit,
        remaining_balance=remaining,
        detected_percentage=_detected_percentage(consumed, limit),
        priority=priority,
        alert_type=AlertType.SOBREGIRO if remaining < 0 else AlertType.UMBRAL,
        message=f"{title} {body}"[:LEGACY_MESSAGE_MAX_LENGTH],
        triggered_at=now,
    )
    db.add(alert)
    db.add(Notification(user_id=budget.user_id, alert_id=alert.alert_id, title=title, body=body))

    return AlertOut(
        id=alert.alert_id,
        budget_id=budget.budget_id,
        category=category,
        percentage=threshold.percentage,
        consumed=f"{consumed:.2f}",
        limit=f"{limit:.2f}",
        remaining=f"{remaining:.2f}",
        priority=priority.value,
        created_at=iso_utc(now),
        title=title,
        body=body,
    )


def _save_threshold(db: Session, budget: Budget, percentage: int) -> BudgetThreshold:
    """Activa el umbral, reutilizando su fila si existio.

    Conservar el id mantiene la deduplicacion: quitar y volver a poner un umbral
    en el mismo periodo no repite su alerta (BR-072).
    """
    same_percentage = [
        t for t in repository.thresholds_of(db, budget.budget_id) if t.percentage == percentage
    ]
    if same_percentage:
        # Primero la activa: activar otra fila violaria el indice unico parcial.
        threshold = min(same_percentage, key=lambda t: not t.is_active)
        threshold.is_active = True
        return threshold
    threshold = BudgetThreshold(
        threshold_id=uuid.uuid4(), budget_id=budget.budget_id, percentage=percentage, is_active=True
    )
    db.add(threshold)
    return threshold


def _thresholds_to_evaluate(db: Session, budget: Budget) -> list[BudgetThreshold]:
    active = [t for t in repository.thresholds_of(db, budget.budget_id) if t.is_active]
    return active or [_save_threshold(db, budget, DEFAULT_THRESHOLD)]


def evaluate_expense(
    db: Session, transaction: Transaction, today: date | None = None
) -> list[AlertOut]:
    """Evalua los presupuestos que afecta un gasto ya enviado a la BD con flush."""
    if (
        transaction.type != TransactionType.GASTO
        or transaction.status != TransactionStatus.CONFIRMADA
    ):
        return []

    db.execute(EVALUATION_TIMEOUT)
    today = today or today_lima()
    expense_date = transaction.transacted_at.astimezone(LIMA_TZ).date()
    budgets = budgets_repository.active_budgets_for_expense(
        db, transaction.user_id, transaction.category_id, transaction.currency
    )

    emitted: list[AlertOut] = []
    for budget in budgets:
        if not has_started(budget, today):
            continue
        start, end = current_period(budget, today)
        if not start <= expense_date <= end:
            continue  # Sin alertas retroactivas de periodos cerrados (EX9).

        consumed = budgets_repository.consumed_in_period(db, budget, start, end)
        issued = repository.issued_threshold_ids(db, budget.budget_id, start)
        for threshold in _thresholds_to_evaluate(db, budget):
            if threshold.threshold_id in issued:
                continue
            if consumed >= budget.amount * threshold.percentage / 100:
                emitted.append(_emit(db, budget, threshold, start, consumed))

    db.flush()
    return emitted


def publish_alerts(bus: NotificationBus, user_id: uuid.UUID, alerts: list[AlertOut]) -> None:
    """Emite `alert.created`. Se llama solo despues del commit."""
    for alert in alerts:
        data = alert.model_dump(mode="json", exclude={"title", "body"})
        bus.publish(user_id, "alert.created", str(alert.id), data)


# ---------------------------------------------------------------------------
# Gestion de umbrales
# ---------------------------------------------------------------------------
def _invalid_threshold() -> AppError:
    return AppError(422, "INVALID_THRESHOLD", "Ingresa un porcentaje entre 1% y 100%.")


def _threshold_exists() -> AppError:
    return AppError(409, "THRESHOLD_EXISTS", "Ya tienes un umbral con ese porcentaje.")


def validate_thresholds(percentages: list[int]) -> None:
    """Lista de umbrales: no vacia, 1-100 y sin repetidos (BR-067, BR-068)."""
    if not percentages or any(not 1 <= p <= 100 for p in percentages):
        raise _invalid_threshold()
    if len(set(percentages)) != len(percentages):
        raise _threshold_exists()


def budget_or_404(
    db: Session, user: User, budget_id: uuid.UUID, for_update: bool = False
) -> Budget:
    budget = budgets_repository.get_budget(db, user.user_id, budget_id, for_update)
    if budget is None:
        raise AppError(404, "NOT_FOUND", "No encontramos lo que buscas.")
    return budget


def active_thresholds_out(db: Session, budget: Budget) -> list[ThresholdOut]:
    """Umbrales activos; `triggered` indica si ya alertaron en el periodo vigente."""
    start, _ = current_period(budget, today_lima())
    issued = repository.issued_threshold_ids(db, budget.budget_id, start)
    return [
        ThresholdOut(id=t.threshold_id, percentage=t.percentage, triggered=t.threshold_id in issued)
        for t in repository.thresholds_of(db, budget.budget_id)
        if t.is_active
    ]


def list_thresholds(db: Session, user: User, budget_id: uuid.UUID) -> list[ThresholdOut]:
    return active_thresholds_out(db, budget_or_404(db, user, budget_id))


def add_threshold(db: Session, user: User, budget_id: uuid.UUID, percentage: int) -> ThresholdOut:
    if not 1 <= percentage <= 100:
        raise _invalid_threshold()
    budget = budget_or_404(db, user, budget_id, for_update=True)
    existing = repository.thresholds_of(db, budget.budget_id)
    if any(t.is_active and t.percentage == percentage for t in existing):
        raise _threshold_exists()

    threshold = _save_threshold(db, budget, percentage)
    db.flush()
    issued = repository.issued_threshold_ids(
        db, budget.budget_id, current_period(budget, today_lima())[0]
    )
    db.commit()
    return ThresholdOut(
        id=threshold.threshold_id,
        percentage=threshold.percentage,
        triggered=threshold.threshold_id in issued,
    )


def replace_thresholds(
    db: Session, user: User, budget_id: uuid.UUID, percentages: list[int]
) -> list[ThresholdOut]:
    validate_thresholds(percentages)
    budget = budget_or_404(db, user, budget_id, for_update=True)
    for threshold in repository.thresholds_of(db, budget.budget_id):
        if threshold.percentage not in percentages:
            threshold.is_active = False
    for percentage in percentages:
        _save_threshold(db, budget, percentage)
    db.flush()
    result = active_thresholds_out(db, budget)
    db.commit()
    return result


def deactivate_threshold(
    db: Session, user: User, budget_id: uuid.UUID, threshold_id: uuid.UUID
) -> None:
    budget = budget_or_404(db, user, budget_id, for_update=True)
    thresholds = repository.thresholds_of(db, budget.budget_id)
    target = next(
        (t for t in thresholds if t.threshold_id == threshold_id and t.is_active), None
    )
    if target is None:
        raise AppError(404, "NOT_FOUND", "No encontramos lo que buscas.")
    if sum(t.is_active for t in thresholds) == 1:
        raise AppError(
            422, "INVALID_THRESHOLD", "El presupuesto debe conservar al menos un umbral."
        )
    target.is_active = False
    db.commit()
