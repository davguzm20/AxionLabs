from datetime import datetime, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.entities import (
    Budget,
    BudgetThreshold,
    Currency,
    SourceType,
    Transaction,
    TransactionStatus,
    TransactionType,
)
from app.modules.budgets import service as budgets_service
from app.modules.budgets.schemas import BudgetCreate
from app.modules.budgets.service import create_budget, list_budgets
from app.modules.categories import repository as categories_repository
from tests.sqlite_db import (
    TODAY,
    engine,
    make_budget,
    make_category,
    make_user,
    make_wallet,
)


def test_create_budget_flushes_parent_before_thresholds(engine) -> None:
    with Session(engine) as db:
        user = make_user(db)
        category = make_category(db, "Alimentacion")
        category.user_id = user.user_id
        db.commit()

        created = create_budget(
            db,
            user,
            BudgetCreate(
                category_id=category.category_id,
                currency="PEN",
                amount="250.00",
                period_type="MONTHLY",
                thresholds=[75, 80],
            ),
        )
        db.expire_all()

        budget = db.get(Budget, created.id)
        thresholds = list(
            db.scalars(
                select(BudgetThreshold)
                .where(BudgetThreshold.budget_id == created.id)
                .order_by(BudgetThreshold.percentage)
            )
        )

    assert budget is not None
    assert [threshold.percentage for threshold in thresholds] == [75, 80]


def test_list_budgets_keeps_categories_without_an_active_cap(engine) -> None:
    with Session(engine) as db:
        user = make_user(db)
        categories_repository.ensure_default_categories(db, user.user_id)
        category = categories_repository.get_category_by_name(db, user.user_id, "Otros")
        assert category is not None
        budget = make_budget(db, user, category, amount="420")

        result = list_budgets(db, user, "ACTIVE", None)

    by_name = {item.category.name: item for item in result}
    assert len(by_name) == 4
    assert by_name["Otros"].id == budget.budget_id
    assert by_name["Otros"].amount == "420.00"
    assert by_name["Alimentación"].id is None
    assert by_name["Alimentación"].amount is None
    assert by_name["Alimentación"].monthly_consumed_by_currency == []
    assert by_name["Alimentación"].status == "NONE"


def test_list_budgets_includes_monthly_consumption_by_currency_without_a_cap(
    engine, monkeypatch
) -> None:
    monkeypatch.setattr(budgets_service, "today_lima", lambda: TODAY)
    lima = ZoneInfo("America/Lima")
    outside_month = TODAY.replace(day=1) - timedelta(days=1)

    with Session(engine) as db:
        user = make_user(db)
        categories_repository.ensure_default_categories(db, user.user_id)
        category = categories_repository.get_category_by_name(db, user.user_id, "Otros")
        assert category is not None
        pen_wallet = make_wallet(db, user, Currency.PEN)
        usd_wallet = make_wallet(db, user, Currency.USD)

        db.add_all(
            [
                Transaction(
                    user_id=user.user_id,
                    wallet_id=pen_wallet.wallet_id,
                    category_id=category.category_id,
                    amount=Decimal("12.34"),
                    type=TransactionType.GASTO,
                    currency=Currency.PEN,
                    concept="Compra",
                    transacted_at=datetime(
                        TODAY.year, TODAY.month, TODAY.day, 12, tzinfo=lima
                    ),
                    status=TransactionStatus.CONFIRMADA,
                    source_type=SourceType.TEXTO,
                ),
                Transaction(
                    user_id=user.user_id,
                    wallet_id=usd_wallet.wallet_id,
                    category_id=category.category_id,
                    amount=Decimal("5.67"),
                    type=TransactionType.GASTO,
                    currency=Currency.USD,
                    concept="Compra USD",
                    transacted_at=datetime(
                        TODAY.year, TODAY.month, TODAY.day, 13, tzinfo=lima
                    ),
                    status=TransactionStatus.CONFIRMADA,
                    source_type=SourceType.TEXTO,
                ),
                Transaction(
                    user_id=user.user_id,
                    wallet_id=pen_wallet.wallet_id,
                    category_id=category.category_id,
                    amount=Decimal("90.00"),
                    type=TransactionType.GASTO,
                    currency=Currency.PEN,
                    concept="Pendiente",
                    transacted_at=datetime(
                        TODAY.year, TODAY.month, TODAY.day, 14, tzinfo=lima
                    ),
                    status=TransactionStatus.PENDIENTE,
                    source_type=SourceType.TEXTO,
                ),
                Transaction(
                    user_id=user.user_id,
                    wallet_id=pen_wallet.wallet_id,
                    category_id=category.category_id,
                    amount=Decimal("100.00"),
                    type=TransactionType.GASTO,
                    currency=Currency.PEN,
                    concept="Mes anterior",
                    transacted_at=datetime.combine(
                        outside_month, datetime.min.time()
                    ).replace(tzinfo=lima),
                    status=TransactionStatus.CONFIRMADA,
                    source_type=SourceType.TEXTO,
                ),
            ]
        )
        result = list_budgets(db, user, "ACTIVE", None)

    without_cap = next(item for item in result if item.category.name == "Otros")
    assert [
        (item.currency, item.amount)
        for item in without_cap.monthly_consumed_by_currency
    ] == [("PEN", "12.34"), ("USD", "5.67")]
