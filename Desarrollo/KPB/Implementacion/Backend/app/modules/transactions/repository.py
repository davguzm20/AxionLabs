"""Acceso a datos (SQLAlchemy) para el módulo de Transacciones (CU02).

Realiza las consultas a PostgreSQL sobre las tablas wallets, categories y transactions.
"""

from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal
from typing import Literal

from sqlalchemy import Date, case, cast, func, select
from sqlalchemy.orm import Session, joinedload

from app.entities import Category, Transaction, TransactionType, Wallet


def get_wallet(
    db: Session,
    user_id: uuid.UUID,
    wallet_id: uuid.UUID | None = None,
    for_update: bool = False,
) -> Wallet | None:
    """Obtiene un monedero del usuario.

    Si wallet_id es None, retorna el primer monedero creado del usuario.
    Si for_update es True, aplica bloqueo pesimista (SELECT ... FOR UPDATE) para atomicidad.
    """
    stmt = select(Wallet).where(Wallet.user_id == user_id)

    if wallet_id is not None:
        stmt = stmt.where(Wallet.wallet_id == wallet_id)
    else:
        # Monedero por defecto: el primero ordenado por fecha de creación
        stmt = stmt.order_by(Wallet.created_at.asc())

    if for_update:
        stmt = stmt.with_for_update()

    return db.execute(stmt).scalars().first()


def get_category_by_name(
    db: Session,
    user_id: uuid.UUID,
    name: str,
) -> Category | None:
    """Busca una categoría activa coincidente por nombre (propia o del sistema)."""
    clean_name = name.strip()
    stmt = (
        select(Category)
        .where(
            (Category.user_id == user_id) | (Category.user_id.is_(None)),
            func.lower(Category.name) == clean_name.lower(),
        )
        .order_by(Category.user_id.desc().nullslast())  # Priorizar categorías del usuario
    )
    return db.execute(stmt).scalars().first()


def get_fallback_category(db: Session) -> Category:
    """Obtiene la categoría fallback 'Otros'. Si no existiera en la BD, la crea."""
    stmt = select(Category).where(
        Category.user_id.is_(None),
        func.lower(Category.name) == "otros",
    )
    category = db.execute(stmt).scalars().first()
    if category is not None:
        return category

    # En caso de que el seed no se haya corrido aún, creamos una categoría fallback básica
    fallback = Category(
        name="Otros",
        description="Categoría por defecto para gastos sin clasificar",
    )
    db.add(fallback)
    db.flush()
    return fallback


def get_category_by_id(
    db: Session,
    user_id: uuid.UUID,
    category_id: uuid.UUID,
) -> Category | None:
    """Obtiene una categoría por su ID, verificando que pertenezca al usuario o sea del sistema."""
    stmt = select(Category).where(
        Category.category_id == category_id,
        (Category.user_id == user_id) | (Category.user_id.is_(None)),
    )
    return db.execute(stmt).scalars().first()


def get_transaction_by_id(
    db: Session,
    user_id: uuid.UUID,
    transaction_id: uuid.UUID,
) -> Transaction | None:
    """Obtiene una transacción por su ID garantizando que pertenezca al usuario autenticado."""
    stmt = select(Transaction).where(
        Transaction.transaction_id == transaction_id,
        Transaction.user_id == user_id,
    )
    return db.execute(stmt).scalars().first()


def _history_filters(
    user_id: uuid.UUID,
    date_from: date,
    date_to: date,
    transaction_type: Literal["EXPENSE", "INCOME"] | None = None,
    category_id: uuid.UUID | None = None,
    wallet_id: uuid.UUID | None = None,
    q: str | None = None,
) -> list[object]:
    filters: list[object] = [
        Transaction.user_id == user_id,
        cast(Transaction.transacted_at, Date) >= date_from,
        cast(Transaction.transacted_at, Date) <= date_to,
    ]
    if transaction_type is not None:
        filters.append(
            Transaction.type
            == (TransactionType.INGRESO if transaction_type == "INCOME" else TransactionType.GASTO)
        )
    if category_id is not None:
        filters.append(Transaction.category_id == category_id)
    if wallet_id is not None:
        filters.append(Transaction.wallet_id == wallet_id)
    if q:
        filters.append(Transaction.concept.ilike(f"%{q}%"))
    return filters


def page_history(
    db: Session,
    user_id: uuid.UUID,
    date_from: date,
    date_to: date,
    page: int,
    page_size: int,
    transaction_type: Literal["EXPENSE", "INCOME"] | None = None,
    category_id: uuid.UUID | None = None,
    wallet_id: uuid.UUID | None = None,
    q: str | None = None,
) -> tuple[list[Transaction], int]:
    filters = _history_filters(
        user_id, date_from, date_to, transaction_type, category_id, wallet_id, q
    )
    total = db.execute(
        select(func.count()).select_from(Transaction).where(*filters)
    ).scalar_one()
    statement = (
        select(Transaction)
        .options(joinedload(Transaction.category))
        .where(*filters)
        .order_by(Transaction.transacted_at.desc(), Transaction.transaction_id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    return list(db.execute(statement).scalars().all()), total


def summarize_history(
    db: Session,
    user_id: uuid.UUID,
    date_from: date,
    date_to: date,
    transaction_type: Literal["EXPENSE", "INCOME"] | None = None,
    category_id: uuid.UUID | None = None,
    wallet_id: uuid.UUID | None = None,
    q: str | None = None,
) -> list[tuple[object, Decimal, Decimal]]:
    filters = _history_filters(
        user_id, date_from, date_to, transaction_type, category_id, wallet_id, q
    )
    income = func.coalesce(
        func.sum(case((Transaction.type == TransactionType.INGRESO, Transaction.amount), else_=0)), 0
    )
    expense = func.coalesce(
        func.sum(case((Transaction.type == TransactionType.GASTO, Transaction.amount), else_=0)), 0
    )
    statement = (
        select(Transaction.currency, income, expense)
        .where(*filters)
        .group_by(Transaction.currency)
        .order_by(Transaction.currency)
    )
    return list(db.execute(statement).all())


def save_transaction_and_update_balance(
    db: Session,
    transaction: Transaction,
    wallet: Wallet,
    balance_delta: Decimal,
) -> None:
    """Inserta la transacción y actualiza el saldo del monedero en la misma sesión atómica."""
    db.add(transaction)
    wallet.current_balance += balance_delta
    # El commit pertenece a persist_confirmed(), que tambiÃ©n crea las alertas.
    # Hacerlo aquÃ­ volverÃ­a irreversible la transacciÃ³n antes de esa evaluaciÃ³n.
    db.flush()

