from __future__ import annotations

import enum
import uuid
from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    FetchedValue,
    ForeignKey,
    Index,
    Numeric,
    String,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import ENUM, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship, validates

try:
    from app.database import Base
except ImportError:
    class Base(DeclarativeBase):
        pass


# ---------------------------------------------------------------------------
# Configuración de zona horaria y utilidades financieras
# ---------------------------------------------------------------------------
LIMA_TZ = ZoneInfo("America/Lima")
Money = Numeric(12, 2)


def now_lima() -> datetime:
    """Retorna la fecha y hora actual en la zona horaria America/Lima (UTC-5)."""
    return datetime.now(LIMA_TZ)


def quantize_money(value: Decimal | str | float | int) -> Decimal:
    """Normaliza un valor numérico a Decimal con 2 decimales exactos (RNF012)."""
    if value is None:
        raise ValueError("El monto financiero no puede ser nulo.")
    return Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def quantize_percentage(value: Decimal | str | float | int) -> Decimal:
    """Normaliza un porcentaje a Decimal con 2 decimales."""
    return Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


# ---------------------------------------------------------------------------
# Enumeraciones (espejo exacto de los CREATE TYPE ... AS ENUM de KPB-SCHEMA.sql)
# ---------------------------------------------------------------------------
class UserStatus(str, enum.Enum):
    ACTIVO = "ACTIVO"
    BLOQUEADO = "BLOQUEADO"
    INACTIVO = "INACTIVO"

    @property
    def api_value(self) -> str:
        return {
            UserStatus.ACTIVO: "active",
            UserStatus.BLOQUEADO: "locked",
            UserStatus.INACTIVO: "inactive",
        }[self]


class WalletType(str, enum.Enum):
    BANCO = "BANCO"
    EFECTIVO = "EFECTIVO"

    @property
    def api_value(self) -> str:
        return "bank" if self == WalletType.BANCO else "cash"

    @classmethod
    def from_api(cls, value: str) -> WalletType:
        normalized = value.strip().upper()
        if normalized in ("BANK", "BANCO"):
            return cls.BANCO
        if normalized in ("CASH", "EFECTIVO"):
            return cls.EFECTIVO
        raise ValueError(f"Tipo de monedero no válido: {value}")


class Currency(str, enum.Enum):
    PEN = "PEN"
    USD = "USD"


class TransactionType(str, enum.Enum):
    INGRESO = "INGRESO"
    GASTO = "GASTO"

    @property
    def api_value(self) -> str:
        return "income" if self == TransactionType.INGRESO else "expense"

    @classmethod
    def from_api(cls, value: str) -> TransactionType:
        normalized = value.strip().upper()
        if normalized in ("INCOME", "INGRESO"):
            return cls.INGRESO
        if normalized in ("EXPENSE", "GASTO"):
            return cls.GASTO
        raise ValueError(f"Tipo de transacción no válido: {value}")


class TransactionStatus(str, enum.Enum):
    CONFIRMADA = "CONFIRMADA"
    PENDIENTE = "PENDIENTE"

    @property
    def api_value(self) -> str:
        return "confirmed" if self == TransactionStatus.CONFIRMADA else "pending"


class SourceType(str, enum.Enum):
    TEXTO = "TEXTO"
    VOZ = "VOZ"
    OCR = "OCR"

    @property
    def api_value(self) -> str:
        return {
            SourceType.TEXTO: "text",
            SourceType.VOZ: "voice",
            SourceType.OCR: "receipt",
        }[self]

    @classmethod
    def from_api(cls, value: str) -> SourceType:
        normalized = value.strip().upper()
        mapping = {
            "TEXT": cls.TEXTO,
            "TEXTO": cls.TEXTO,
            "MANUAL": cls.TEXTO,
            "VOICE": cls.VOZ,
            "VOZ": cls.VOZ,
            "RECEIPT": cls.OCR,
            "OCR": cls.OCR,
        }
        if normalized not in mapping:
            raise ValueError(f"Canal de origen no válido: {value}")
        return mapping[normalized]


class PeriodType(str, enum.Enum):
    SEMANAL = "SEMANAL"
    MENSUAL = "MENSUAL"
    PERSONALIZADO = "PERSONALIZADO"


class BudgetStatus(str, enum.Enum):
    ACTIVO = "ACTIVO"
    INACTIVO = "INACTIVO"


class AlertType(str, enum.Enum):
    UMBRAL = "UMBRAL"
    SOBREGIRO = "SOBREGIRO"


class AccessStatus(str, enum.Enum):
    EXITOSO = "EXITOSO"
    FALLIDO = "FALLIDO"


def _pg_enum(enum_cls: type[enum.Enum], name: str) -> ENUM:
    """Referencia un tipo ENUM nativo de PostgreSQL definido en KPB-SCHEMA.sql."""
    return ENUM(
        enum_cls,
        name=name,
        create_type=False,
        values_callable=lambda members: [m.value for m in members],
    )


def _uuid_pk() -> Mapped[uuid.UUID]:
    return mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=text("gen_random_uuid()"),
    )


def _created_at() -> Mapped[datetime]:
    return mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


def _updated_at() -> Mapped[datetime]:
    return mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        server_onupdate=FetchedValue(),
    )


# ---------------------------------------------------------------------------
# users
# ---------------------------------------------------------------------------
class User(Base):
    __tablename__ = "users"

    user_id: Mapped[uuid.UUID] = _uuid_pk()
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    surname: Mapped[str] = mapped_column(String(100), nullable=False)
    email: Mapped[str] = mapped_column(String(150), nullable=False, unique=True)
    password: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[UserStatus] = mapped_column(
        _pg_enum(UserStatus, "user_status_enum"),
        nullable=False,
        default=UserStatus.ACTIVO,
        server_default=text("'ACTIVO'"),
    )
    created_at: Mapped[datetime] = _created_at()
    updated_at: Mapped[datetime] = _updated_at()

    wallets: Mapped[list[Wallet]] = relationship(
        back_populates="user", cascade="all, delete-orphan", passive_deletes=True
    )
    categories: Mapped[list[Category]] = relationship(
        back_populates="user", cascade="all, delete-orphan", passive_deletes=True
    )
    access_logs: Mapped[list[AccessLog]] = relationship(
        back_populates="user", cascade="all, delete-orphan", passive_deletes=True
    )

    @validates("email")
    def _validate_email(self, key: str, value: str) -> str:
        if not value or "@" not in value.strip():
            raise ValueError("VALIDATION_ERROR: Correo electrónico con formato inválido.")
        return value.strip().lower()

    @property
    def is_active(self) -> bool:
        return self.status == UserStatus.ACTIVO

    @property
    def is_locked(self) -> bool:
        return self.status == UserStatus.BLOQUEADO

    def to_api_dict(self) -> dict[str, Any]:
        return {
            "id": str(self.user_id),
            "email": self.email,
            "name": self.name,
            "surname": self.surname,
            "status": self.status.api_value,
        }

    def __repr__(self) -> str:
        return f"<User {self.user_id} {self.email!r}>"


# ---------------------------------------------------------------------------
# categories
# ---------------------------------------------------------------------------
class Category(Base):
    __tablename__ = "categories"
    __table_args__ = (
        Index(
            "uq_categories_user_name",
            "user_id",
            "name",
            unique=True,
            postgresql_where=text("user_id IS NOT NULL"),
        ),
        Index(
            "uq_categories_system_name",
            "name",
            unique=True,
            postgresql_where=text("user_id IS NULL"),
        ),
    )

    category_id: Mapped[uuid.UUID] = _uuid_pk()
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="CASCADE")
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = _created_at()

    user: Mapped[User | None] = relationship(back_populates="categories")

    @property
    def is_system(self) -> bool:
        return self.user_id is None

    @property
    def is_fallback(self) -> bool:
        return self.name.strip().lower() == "otros"

    def to_api_dict(self, category_type: str = "expense") -> dict[str, Any]:
        return {
            "id": str(self.category_id),
            "name": self.name,
            "type": category_type,
        }

    def __repr__(self) -> str:
        return f"<Category {self.name!r}>"


# ---------------------------------------------------------------------------
# wallets
# ---------------------------------------------------------------------------
class Wallet(Base):
    __tablename__ = "wallets"
    __table_args__ = (
        UniqueConstraint("user_id", "name", name="uq_wallets_user_name"),
        UniqueConstraint("wallet_id", "user_id", name="uq_wallets_id_user"),
        CheckConstraint("initial_balance >= 0", name="chk_wallets_initial_balance"),
        Index("idx_wallets_user_id", "user_id"),
    )

    wallet_id: Mapped[uuid.UUID] = _uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    type: Mapped[WalletType] = mapped_column(
        _pg_enum(WalletType, "wallet_type_enum"), nullable=False
    )
    currency: Mapped[Currency] = mapped_column(
        _pg_enum(Currency, "currency_enum"),
        nullable=False,
        default=Currency.PEN,
    )
    initial_balance: Mapped[Decimal] = mapped_column(
        Money, nullable=False, default=Decimal("0.00"), server_default=text("0")
    )
    current_balance: Mapped[Decimal] = mapped_column(
        Money, nullable=False, default=Decimal("0.00"), server_default=text("0")
    )
    created_at: Mapped[datetime] = _created_at()
    updated_at: Mapped[datetime] = _updated_at()

    user: Mapped[User] = relationship(back_populates="wallets")

    @validates("name")
    def _validate_name(self, key: str, value: str) -> str:
        if not value or not value.strip():
            raise ValueError("WALLET_NAME_EMPTY: El nombre del monedero no puede estar vacío.")
        return value.strip()

    @validates("initial_balance")
    def _validate_initial_balance(
        self, key: str, value: Decimal | str | float | int
    ) -> Decimal:
        dec_val = quantize_money(value)
        if dec_val < Decimal("0.00"):
            raise ValueError(
                "INITIAL_BALANCE_INVALID: El saldo inicial debe ser mayor o igual a 0.00."
            )
        return dec_val

    @property
    def balance(self) -> Decimal:
        return quantize_money(self.current_balance)

    def apply_transaction(
        self, amount: Decimal | str | float, tx_type: TransactionType
    ) -> Decimal:
        """Recalcula el saldo actual sumando ingresos o descontando gastos (RQ15)."""
        delta = quantize_money(amount)
        if delta <= Decimal("0.00"):
            raise ValueError("AMOUNT_INVALID: El monto debe ser mayor a 0.")
        current = quantize_money(self.current_balance)
        if tx_type == TransactionType.INGRESO:
            self.current_balance = quantize_money(current + delta)
        elif tx_type == TransactionType.GASTO:
            self.current_balance = quantize_money(current - delta)
        else:
            raise ValueError(f"Tipo de transacción no soportado: {tx_type}")
        return self.current_balance

    def to_api_dict(self, is_default: bool = False) -> dict[str, Any]:
        return {
            "id": str(self.wallet_id),
            "name": self.name,
            "type": self.type.api_value,
            "currency": self.currency.value,
            "initial_balance": f"{quantize_money(self.initial_balance):.2f}",
            "balance": f"{quantize_money(self.current_balance):.2f}",
            "is_default": is_default,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }

    def __repr__(self) -> str:
        return f"<Wallet {self.name!r} {self.currency.value if self.currency else ''}>"


# ---------------------------------------------------------------------------
# access_logs
# ---------------------------------------------------------------------------
class AccessLog(Base):
    __tablename__ = "access_logs"
    __table_args__ = (
        Index("idx_access_logs_user_date", "user_id", text("accessed_at DESC")),
    )

    log_id: Mapped[uuid.UUID] = _uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="CASCADE"),
        nullable=False,
    )
    accessed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    device: Mapped[str | None] = mapped_column(String(150))
    status: Mapped[AccessStatus] = mapped_column(
        _pg_enum(AccessStatus, "access_status_enum"), nullable=False
    )

    user: Mapped[User] = relationship(back_populates="access_logs")

    def __repr__(self) -> str:
        return f"<AccessLog {self.status.value if self.status else ''} {self.accessed_at}>"


__all__ = [
    "LIMA_TZ",
    "Money",
    "now_lima",
    "quantize_money",
    "quantize_percentage",
    "UserStatus",
    "WalletType",
    "Currency",
    "TransactionType",
    "TransactionStatus",
    "SourceType",
    "PeriodType",
    "BudgetStatus",
    "AlertType",
    "AccessStatus",
    "User",
    "Category",
    "Wallet",
    "AccessLog",
]