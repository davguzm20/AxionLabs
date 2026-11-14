"""KPB-CTG: logica del CU07 (tope de gasto por categoria).

El esquema desplegado (KPB-SCHEMA.sql) exige `period_days` y `start_date` en todos los
presupuestos (7 o 30 dias fijos): se guardan asi y la API los devuelve en null salvo
en CUSTOM, como define 04-api/endpoints/budgets.md.
"""

from __future__ import annotations

import uuid
from datetime import date
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.entities import (
    Budget,
    BudgetStatus,
    BudgetThreshold,
    Currency,
    PeriodType,
    User,
    quantize_money,
)
from app.modules.alerts import repository as alerts_repository
from app.modules.alerts import service as alerts_service
from app.modules.alerts.schemas import ThresholdOut
from app.modules.alerts.service import DEFAULT_THRESHOLD
from app.modules.budgets import repository
from app.modules.budgets.periods import current_period, has_started, today_lima
from app.modules.budgets.schemas import (
    BudgetCategory,
    BudgetCreate,
    BudgetImpact,
    BudgetOut,
    BudgetUpdate,
)

MAX_AMOUNT = Decimal("99999999.99")
CATEGORY_ICON = "tag"  # La tabla categories aun no guarda iconos (igual que CU02).

API_PERIODS = {"WEEKLY": PeriodType.SEMANAL, "MONTHLY": PeriodType.MENSUAL, "CUSTOM": PeriodType.PERSONALIZADO}
FIXED_PERIOD_DAYS = {PeriodType.SEMANAL: 7, PeriodType.MENSUAL: 30}
API_STATUS = {BudgetStatus.ACTIVO: "ACTIVE", BudgetStatus.INACTIVO: "INACTIVE"}


def _error(status: int, code: str, message: str) -> AppError:
    return AppError(status, code, message)


def _budget_exists() -> AppError:
    return _error(409, "BUDGET_EXISTS", "Ya tienes un presupuesto para esta categoría.")


# ---------------------------------------------------------------------------
# Validaciones
# ---------------------------------------------------------------------------
def parse_amount(raw: str) -> Decimal:
    """Monto > 0, <= 99,999,999.99 y con dos decimales como maximo (BR-055)."""
    try:
        amount = Decimal(raw.strip())
    except InvalidOperation:
        amount = None
    if amount is None or not amount.is_finite() or not Decimal(0) < amount <= MAX_AMOUNT:
        raise _error(422, "INVALID_AMOUNT", "Ingresa un monto válido (máximo 99,999,999.99).")
    if amount.as_tuple().exponent < -2:
        raise _error(422, "INVALID_AMOUNT_PRECISION", "Usa como máximo dos decimales.")
    return quantize_money(amount)


def parse_currency(raw: str) -> Currency:
    try:
        return Currency(raw)
    except ValueError:
        raise _error(422, "INVALID_CURRENCY", "Usa PEN o USD.") from None


def parse_period_type(raw: str) -> PeriodType:
    if raw not in API_PERIODS:
        raise _error(422, "INVALID_PERIOD", "Selecciona un periodo válido.")
    return API_PERIODS[raw]


def resolve_period(
    period_type: PeriodType,
    start_date: date | None,
    period_days: int | None,
    fallback_start: date,
) -> tuple[int, date]:
    """Devuelve (period_days, start_date) a guardar (BR-058, BR-059)."""
    if period_type != PeriodType.PERSONALIZADO:
        return FIXED_PERIOD_DAYS[period_type], fallback_start
    if start_date is None or period_days is None:
        raise _error(422, "CUSTOM_PERIOD_REQUIRED", "Indica fecha de inicio y días.")
    if not 1 <= period_days <= 366:
        raise _error(422, "INVALID_PERIOD_DAYS", "Los días deben estar entre 1 y 366.")
    return period_days, start_date


# ---------------------------------------------------------------------------
# Consumo e impacto
# ---------------------------------------------------------------------------
def _consumption(db: Session, budget: Budget, today: date) -> tuple[date, date, Decimal]:
    start, end = current_period(budget, today)
    if not has_started(budget, today):
        return start, end, Decimal("0.00")
    return start, end, repository.consumed_in_period(db, budget, start, end)


def _percentage(consumed: Decimal, amount: Decimal) -> float:
    """Un decimal, ROUND_HALF_UP; puede superar 100 (03-domain/calculations.md)."""
    return float((consumed / amount * 100).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP))


def _to_out(
    db: Session, budget: Budget, thresholds: list[ThresholdOut], today: date
) -> BudgetOut:
    start, end, consumed = _consumption(db, budget, today)
    amount = quantize_money(budget.amount)
    is_custom = budget.period_type == PeriodType.PERSONALIZADO
    api_period = next(key for key, value in API_PERIODS.items() if value == budget.period_type)
    return BudgetOut(
        id=budget.budget_id,
        category=BudgetCategory(
            id=budget.category.category_id, name=budget.category.name, icon=CATEGORY_ICON
        ),
        currency=budget.currency.value,
        amount=f"{amount:.2f}",
        period_type=api_period,
        start_date=budget.start_date if is_custom else None,
        period_days=budget.period_days if is_custom else None,
        period_start=start,
        period_end=end,
        consumed=f"{consumed:.2f}",
        remaining=f"{amount - consumed:.2f}",
        percentage=_percentage(consumed, amount),
        status=API_STATUS[budget.status],
        thresholds=thresholds,
    )


def _detail(db: Session, budget: Budget) -> BudgetOut:
    return _to_out(db, budget, alerts_service.active_thresholds_out(db, budget), today_lima())


# ---------------------------------------------------------------------------
# Casos de uso
# ---------------------------------------------------------------------------
def list_budgets(
    db: Session, user: User, status: str | None, category_id: uuid.UUID | None
) -> list[BudgetOut]:
    """Umbrales y alertas se leen en bloque; el consumo, uno por presupuesto (CP-PRE-20)."""
    db_status = next((k for k, v in API_STATUS.items() if v == status), None)
    budgets = repository.list_budgets(db, user.user_id, db_status, category_id)
    today = today_lima()
    ids = [b.budget_id for b in budgets]
    thresholds = alerts_repository.thresholds_of_many(db, ids)
    issued = alerts_repository.issued_in_periods(
        db, {b.budget_id: current_period(b, today)[0] for b in budgets}
    )
    return [
        _to_out(
            db,
            budget,
            [
                ThresholdOut(
                    id=t.threshold_id,
                    percentage=t.percentage,
                    triggered=(budget.budget_id, t.threshold_id) in issued,
                )
                for t in thresholds[budget.budget_id]
            ],
            today,
        )
        for budget in budgets
    ]


def get_budget(db: Session, user: User, budget_id: uuid.UUID) -> BudgetOut:
    return _detail(db, alerts_service.budget_or_404(db, user, budget_id))


def create_budget(db: Session, user: User, data: BudgetCreate) -> BudgetOut:
    currency = parse_currency(data.currency)
    amount = parse_amount(data.amount)
    period_type = parse_period_type(data.period_type)
    today = today_lima()
    period_days, start_date = resolve_period(
        period_type, data.start_date, data.period_days, fallback_start=today
    )
    percentages = [DEFAULT_THRESHOLD] if data.thresholds is None else data.thresholds
    alerts_service.validate_thresholds(percentages)

    category = repository.get_category(db, user.user_id, data.category_id)
    if category is None:
        raise _error(422, "INVALID_CATEGORY", "Selecciona una categoría válida.")
    if repository.active_budget_for_category(db, user.user_id, category.category_id):
        raise _budget_exists()

    budget = Budget(
        budget_id=uuid.uuid4(),
        user_id=user.user_id,
        category_id=category.category_id,
        currency=currency,
        amount=amount,
        period_type=period_type,
        period_days=period_days,
        start_date=start_date,
        # Columna del esquema anterior; los umbrales reales viven en budget_thresholds.
        threshold_percentage=min(percentages),
        status=BudgetStatus.ACTIVO,
    )
    budget.category = category
    db.add(budget)
    for percentage in sorted(percentages):
        db.add(
            BudgetThreshold(
                threshold_id=uuid.uuid4(), budget_id=budget.budget_id, percentage=percentage
            )
        )
    _commit_or_conflict(db)
    return _detail(db, budget)


def update_budget(
    db: Session, user: User, budget_id: uuid.UUID, data: BudgetUpdate
) -> BudgetOut:
    """Cambia monto, periodo o estado. Las alertas ya emitidas no se reinician."""
    budget = alerts_service.budget_or_404(db, user, budget_id, for_update=True)
    fields = data.model_fields_set

    if "amount" in fields:
        if data.amount is None:
            raise _error(422, "INVALID_AMOUNT", "Ingresa un monto válido (máximo 99,999,999.99).")
        budget.amount = parse_amount(data.amount)

    if fields & {"period_type", "start_date", "period_days"}:
        if "period_type" in fields and data.period_type is None:
            raise _error(422, "INVALID_PERIOD", "Selecciona un periodo válido.")
        period_type = (
            parse_period_type(data.period_type) if "period_type" in fields else budget.period_type
        )
        was_custom = budget.period_type == PeriodType.PERSONALIZADO
        start_date = data.start_date if "start_date" in fields else (
            budget.start_date if was_custom else None
        )
        period_days = data.period_days if "period_days" in fields else (
            budget.period_days if was_custom else None
        )
        budget.period_days, budget.start_date = resolve_period(
            period_type, start_date, period_days, fallback_start=budget.start_date
        )
        budget.period_type = period_type

    if data.status == "INACTIVE":
        budget.status = BudgetStatus.INACTIVO
    elif data.status == "ACTIVE" and budget.status != BudgetStatus.ACTIVO:
        if repository.active_budget_for_category(db, user.user_id, budget.category_id):
            raise _budget_exists()
        budget.status = BudgetStatus.ACTIVO

    _commit_or_conflict(db)
    return _detail(db, budget)


def deactivate_budget(db: Session, user: User, budget_id: uuid.UUID) -> None:
    """Borrado logico: las alertas historicas se conservan (BR-066)."""
    budget = alerts_service.budget_or_404(db, user, budget_id, for_update=True)
    budget.status = BudgetStatus.INACTIVO
    db.commit()


def get_impact(db: Session, user: User, budget_id: uuid.UUID) -> BudgetImpact:
    budget = alerts_service.budget_or_404(db, user, budget_id)
    _, _, consumed = _consumption(db, budget, today_lima())
    amount = quantize_money(budget.amount)
    return BudgetImpact(
        consumed=f"{consumed:.2f}",
        remaining=f"{amount - consumed:.2f}",
        percentage=_percentage(consumed, amount),
        will_exceed=consumed > amount,
    )


def _commit_or_conflict(db: Session) -> None:
    """Dos altas simultaneas pasan la verificacion previa: el indice unico decide."""
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        if "uq_budgets_active_category" in str(error.orig):
            raise _budget_exists() from None
        raise
