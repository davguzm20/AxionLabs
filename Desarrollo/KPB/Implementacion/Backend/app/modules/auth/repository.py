import uuid
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.entities import AccessLog, AccessStatus, Currency, User, Wallet, WalletType


def get_user_by_email(db: Session, email: str) -> User | None:
    """Busca por correo sin distinguir mayusculas (se guarda en minusculas)."""
    return db.scalar(select(User).where(User.email == email.strip().lower()))


def get_user(db: Session, user_id: uuid.UUID) -> User | None:
    return db.get(User, user_id)


def add_user_with_wallet(
    db: Session, name: str, surname: str, email: str, password_hash: str
) -> User:
    """Crea el usuario con su monedero inicial "Efectivo" PEN 0.00."""
    user = User(name=name, surname=surname, email=email, password=password_hash)
    db.add(user)
    db.flush()
    db.add(
        Wallet(
            user_id=user.user_id,
            name="Efectivo",
            type=WalletType.EFECTIVO,
            currency=Currency.PEN,
            initial_balance=Decimal("0.00"),
            current_balance=Decimal("0.00"),
        )
    )
    return user


def add_access_log(db: Session, user_id: uuid.UUID, success: bool, device: str | None) -> None:
    db.add(
        AccessLog(
            user_id=user_id,
            device=device[:150] if device else None,
            status=AccessStatus.EXITOSO if success else AccessStatus.FALLIDO,
        )
    )
