"""Acceso a datos del módulo de Monederos (CU06): tablas wallets y transactions."""

import uuid

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.entities import Transaction, Wallet


def list_wallets(db: Session, user_id: uuid.UUID) -> list[Wallet]:
    """Monederos del usuario, del más antiguo al más nuevo."""
    stmt = (
        select(Wallet)
        .where(Wallet.user_id == user_id)
        .order_by(Wallet.created_at.asc(), Wallet.wallet_id.asc())
    )
    return list(db.scalars(stmt))


def get_wallet(db: Session, user_id: uuid.UUID, wallet_id: uuid.UUID) -> Wallet | None:
    """Monedero del usuario; None si no existe o es de otro usuario."""
    stmt = select(Wallet).where(Wallet.wallet_id == wallet_id, Wallet.user_id == user_id)
    return db.scalar(stmt)


def get_default_wallet_id(db: Session, user_id: uuid.UUID) -> uuid.UUID | None:
    """El predeterminado es el monedero más antiguo, igual que en transactions."""
    stmt = (
        select(Wallet.wallet_id)
        .where(Wallet.user_id == user_id)
        .order_by(Wallet.created_at.asc(), Wallet.wallet_id.asc())
        .limit(1)
    )
    return db.scalar(stmt)


def wallet_name_exists(db: Session, user_id: uuid.UUID, name: str) -> bool:
    """Busca el nombre sin distinguir mayúsculas entre los monederos del usuario."""
    stmt = select(Wallet.wallet_id).where(
        Wallet.user_id == user_id, func.lower(Wallet.name) == name.lower()
    )
    return db.scalar(stmt) is not None


def add_wallet(db: Session, wallet: Wallet) -> None:
    db.add(wallet)
    db.flush()


def count_transactions(db: Session, wallet_ids: list[uuid.UUID]) -> dict[uuid.UUID, int]:
    """Cantidad de transacciones por monedero, en una sola consulta agrupada."""
    if not wallet_ids:
        return {}
    stmt = (
        select(Transaction.wallet_id, func.count())
        .where(Transaction.wallet_id.in_(wallet_ids))
        .group_by(Transaction.wallet_id)
    )
    return {wallet_id: total for wallet_id, total in db.execute(stmt)}
