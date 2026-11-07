"""Base SQLite en memoria con el ORM real, compartida por las pruebas del CU07 y el CU08.

Adapta los defaults propios de PostgreSQL (gen_random_uuid, now) y recrea el indice
unico parcial de umbrales activos. Lo especifico de PostgreSQL se verifica aparte.
"""

from datetime import date
from decimal import Decimal
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import DefaultClause, create_engine, text
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool
from sqlalchemy.schema import CreateTable

from app.database import Base
from app.entities import (
    Budget,
    BudgetThreshold,
    Category,
    Currency,
    PeriodType,
    User,
    Wallet,
    WalletType,
)
from app.modules.alerts import service as alerts_service
from app.modules.budgets import service as budgets_service
from app.modules.transactions import repository as transactions_repository

LIMA = ZoneInfo("America/Lima")
TODAY = date(2026, 10, 27)
REAL_SAVE = transactions_repository.save_transaction_and_update_balance


@pytest.fixture
def engine():
    """Crea las tablas del ORM en SQLite, con los defaults de PostgreSQL adaptados."""
    engine = create_engine(
        "sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False}
    )
    tables = Base.metadata.sorted_tables
    originals = {}
    for table in tables:
        for column in table.columns:
            originals[column] = column.server_default
            default = str(getattr(column.server_default, "arg", ""))
            if "gen_random_uuid" in default:
                column.server_default = None
            elif "now" in default:
                column.server_default = DefaultClause(text("CURRENT_TIMESTAMP"))
    with engine.begin() as connection:
        for table in tables:
            connection.execute(CreateTable(table))
        connection.execute(
            text(
                "CREATE UNIQUE INDEX uq_budget_thresholds_active "
                "ON budget_thresholds(budget_id, percentage) WHERE is_active = 1"
            )
        )
        connection.execute(
            text(
                "CREATE UNIQUE INDEX uq_budgets_active_category "
                "ON budgets(user_id, category_id) WHERE status = 'ACTIVO'"
            )
        )
    for column, server_default in originals.items():
        column.server_default = server_default
    yield engine
    engine.dispose()


@pytest.fixture
def db(engine, monkeypatch):
    # Restaura el guardado real, sustituido por el doble global de conftest.
    monkeypatch.setattr(
        transactions_repository, "save_transaction_and_update_balance", REAL_SAVE
    )
    monkeypatch.setattr(alerts_service, "EVALUATION_TIMEOUT", text("SELECT 1"))
    monkeypatch.setattr(alerts_service, "today_lima", lambda: TODAY)
    monkeypatch.setattr(budgets_service, "today_lima", lambda: TODAY)
    maker = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    with maker() as session:
        yield session


def make_user(db: Session, email: str = "andrea@example.com") -> User:
    user = User(name="Andrea", surname="Quispe", email=email, password="x")
    db.add(user)
    db.flush()
    return user


def make_category(db: Session, name: str = "Alimentación") -> Category:
    category = Category(name=name)
    db.add(category)
    db.flush()
    return category


def make_wallet(db: Session, user: User, currency: Currency = Currency.PEN) -> Wallet:
    wallet = Wallet(
        user_id=user.user_id,
        name=f"Monedero {currency.value}",
        type=WalletType.EFECTIVO,
        currency=currency,
        initial_balance=Decimal(1000),
        current_balance=Decimal(1000),
    )
    db.add(wallet)
    db.flush()
    return wallet


def make_budget(
    db: Session,
    user: User,
    category: Category,
    thresholds: tuple[int, ...] = (80, 100),
    amount: str = "300",
    **changes,
) -> Budget:
    fields = {
        "user_id": user.user_id,
        "category_id": category.category_id,
        "amount": Decimal(amount),
        "currency": Currency.PEN,
        "period_type": PeriodType.MENSUAL,
        "period_days": 30,
        "start_date": date(2026, 10, 1),
    } | changes
    budget = Budget(**fields)
    db.add(budget)
    db.flush()
    for percentage in thresholds:
        db.add(BudgetThreshold(budget_id=budget.budget_id, percentage=percentage))
    db.commit()
    return budget
