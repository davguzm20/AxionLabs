"""Acceso a datos (SQLAlchemy) para el módulo de Transacciones (CU02).

Realiza las consultas a PostgreSQL sobre las tablas wallets, categories y transactions.
"""

from __future__ import annotations

import uuid
from decimal import Decimal
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.entities import Category, Transaction, Wallet


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
    """Inserta la transacción y actualiza el saldo del monedero en la misma sesión atómica."""
    db.add(transaction)
    wallet.current_balance += balance_delta
    db.commit()
    db.refresh(transaction)
    db.refresh(wallet)

