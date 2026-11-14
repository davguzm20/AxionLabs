"""Acceso a datos (SQLAlchemy) para el módulo de Transacciones (CU02).

Realiza las consultas a PostgreSQL sobre las tablas wallets, categories y transactions.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from app.entities import Category, Currency, Transaction, TransactionType, Wallet

LIMA_TZ = ZoneInfo("America/Lima")


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


def save_transaction_and_update_balance(
    db: Session,
    transaction: Transaction,
    wallet: Wallet,
    balance_delta: Decimal,
) -> None:
    """Inserta la transacción y actualiza el saldo sin confirmar.

    El servicio hace el commit después de evaluar las alertas del CU08, para que todo
    ocurra en una sola transacción de BD.
    """
    db.add(transaction)
    wallet.current_balance += balance_delta
    db.flush()


def _apply_transaction_filters(
    stmt,
    user_id: uuid.UUID,
    tx_type: TransactionType | None = None,
    category_id: uuid.UUID | None = None,
    wallet_id: uuid.UUID | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    q: str | None = None,
):
    """Aplica filtros comunes de usuario, tipo, categoría, monedero, fechas y búsqueda."""
    stmt = stmt.where(Transaction.user_id == user_id)

    if tx_type is not None:
        stmt = stmt.where(Transaction.type == tx_type)
    if category_id is not None:
        stmt = stmt.where(Transaction.category_id == category_id)
    if wallet_id is not None:
        stmt = stmt.where(Transaction.wallet_id == wallet_id)
    if date_from is not None:
        start_dt = datetime(
            date_from.year, date_from.month, date_from.day, 0, 0, 0, tzinfo=LIMA_TZ
        )
        stmt = stmt.where(Transaction.transacted_at >= start_dt)
    if date_to is not None:
        end_dt = datetime(
            date_to.year, date_to.month, date_to.day, 23, 59, 59, 999999, tzinfo=LIMA_TZ
        )
        stmt = stmt.where(Transaction.transacted_at <= end_dt)
    if q:
        clean_q = q.strip()
        if clean_q:
            stmt = stmt.where(Transaction.concept.ilike(f"%{clean_q}%"))

    return stmt


def list_transactions(
    db: Session,
    user_id: uuid.UUID,
    page: int,
    page_size: int,
    tx_type: TransactionType | None = None,
    category_id: uuid.UUID | None = None,
    wallet_id: uuid.UUID | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    q: str | None = None,
    sort: str = "transaction_date",
    order: str = "desc",
) -> tuple[list[Transaction], int]:
    """Retorna una página de transacciones filtradas junto con el total de coincidencias."""
    count_stmt = _apply_transaction_filters(
        select(func.count()).select_from(Transaction),
        user_id=user_id,
        tx_type=tx_type,
        category_id=category_id,
        wallet_id=wallet_id,
        date_from=date_from,
        date_to=date_to,
        q=q,
    )
    total = int(db.scalar(count_stmt) or 0)

    sort_col = Transaction.created_at if sort == "created_at" else Transaction.transacted_at
    order_expr = sort_col.asc() if order == "asc" else sort_col.desc()

    data_stmt = _apply_transaction_filters(
        select(Transaction).options(joinedload(Transaction.category)),
        user_id=user_id,
        tx_type=tx_type,
        category_id=category_id,
        wallet_id=wallet_id,
        date_from=date_from,
        date_to=date_to,
        q=q,
    ).order_by(order_expr, Transaction.created_at.desc())

    rows = list(db.scalars(data_stmt.offset((page - 1) * page_size).limit(page_size)).all())
    return rows, total


def get_transactions_summary(
    db: Session,
    user_id: uuid.UUID,
    tx_type: TransactionType | None = None,
    category_id: uuid.UUID | None = None,
    wallet_id: uuid.UUID | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    q: str | None = None,
) -> tuple[int, list[tuple[Currency, TransactionType, Decimal]]]:
    """Agrupa conteo y suma de montos por moneda y tipo según los filtros indicados."""
    stmt = _apply_transaction_filters(
        select(
            Transaction.currency,
            Transaction.type,
            func.count(Transaction.transaction_id),
            func.coalesce(func.sum(Transaction.amount), 0),
        ),
        user_id=user_id,
        tx_type=tx_type,
        category_id=category_id,
        wallet_id=wallet_id,
        date_from=date_from,
        date_to=date_to,
        q=q,
    ).group_by(Transaction.currency, Transaction.type)

    rows = db.execute(stmt).all()
    total_count = sum(int(row[2]) for row in rows)
    grouped = [(row[0], row[1], Decimal(row[3])) for row in rows]
    return total_count, grouped

