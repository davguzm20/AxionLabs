"""KPB-MV: lógica del CU06 (crear, listar y consultar monederos virtuales).

Trabaja con las tablas actuales (KPB-SCHEMA.sql), donde wallets no tiene
columnas is_default ni status: el predeterminado es el monedero más antiguo
del usuario y todos se reportan como ACTIVE.
"""

import re
import uuid
from decimal import Decimal

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.entities import Currency, Wallet, WalletType, quantize_money
from app.modules.wallets import repository
from app.modules.wallets.schemas import CreateWalletRequest, CreateWalletResponse, WalletOut

MAX_NAME_LENGTH = 40
MAX_BALANCE = Decimal("99999999.99")
# Hasta dos decimales; el signo se acepta para responder EX3 a los negativos
_AMOUNT_PATTERN = re.compile(r"^-?\d+(\.\d{1,2})?$")
_CURRENCY_SYMBOLS = {Currency.PEN: "S/", Currency.USD: "$"}

ACTIVE = "ACTIVE"


def _name_duplicated() -> AppError:
    return AppError(
        409,
        "WALLET_NAME_DUPLICATED",
        "El nombre del monedero ya está en uso. Por favor, escoja un nombre distinto.",
    )


def _invalid_field(field: str, message: str) -> AppError:
    return AppError(
        422,
        "VALIDATION_ERROR",
        "Revisa los campos marcados.",
        [{"field": field, "message": message}],
    )


def _wallet_not_found() -> AppError:
    return AppError(404, "WALLET_NOT_FOUND", "No encontramos este monedero.")


def _to_out(wallet: Wallet, is_default: bool, transaction_count: int) -> WalletOut:
    balance = f"{quantize_money(wallet.current_balance):.2f}"
    return WalletOut(
        id=wallet.wallet_id,
        name=wallet.name,
        type=wallet.type.api_value,
        currency=wallet.currency.value,
        initial_balance=f"{quantize_money(wallet.initial_balance):.2f}",
        balance=balance,
        current_balance=balance,
        is_default=is_default,
        status=ACTIVE,
        has_transactions=transaction_count > 0,
        transaction_count=transaction_count,
        created_at=wallet.created_at,
    )


def _parse_initial_balance(value: str | None) -> Decimal:
    """EX3: el saldo inicial debe ser un monto válido entre 0.00 y 99,999,999.99."""
    raw = "0.00" if value is None else value.strip()
    if not _AMOUNT_PATTERN.match(raw) or not (Decimal(0) <= Decimal(raw) <= MAX_BALANCE):
        raise AppError(
            422,
            "INITIAL_BALANCE_INVALID",
            "El saldo inicial debe ser un monto válido mayor o igual a S/ 0.00.",
        )
    return quantize_money(raw)


def create_wallet(
    db: Session, user_id: uuid.UUID, data: CreateWalletRequest
) -> CreateWalletResponse:
    name = data.name.strip()
    if not name:
        raise AppError(
            422,
            "WALLET_NAME_EMPTY",
            "El nombre del monedero no puede estar vacío. Por favor, escoja un nombre apropiado.",
        )
    if len(name) > MAX_NAME_LENGTH:
        raise _invalid_field("name", f"Usa como máximo {MAX_NAME_LENGTH} caracteres.")
    try:
        wallet_type = WalletType.from_api(data.type)
    except ValueError:
        raise _invalid_field("type", "Elige banco (bank) o efectivo (cash).") from None
    try:
        currency = Currency(data.currency.strip().upper())
    except ValueError:
        raise _invalid_field("currency", "Elige PEN o USD.") from None
    initial_balance = _parse_initial_balance(data.initial_balance)

    if repository.wallet_name_exists(db, user_id, name):
        raise _name_duplicated()

    wallet = Wallet(
        user_id=user_id,
        name=name,
        type=wallet_type,
        currency=currency,
        initial_balance=initial_balance,
        current_balance=initial_balance,
    )
    try:
        repository.add_wallet(db, wallet)
        db.commit()
    except IntegrityError:
        # La restriccion uq_wallets_user_name cubre una creacion simultanea
        db.rollback()
        raise _name_duplicated() from None
    db.refresh(wallet)

    is_default = repository.get_default_wallet_id(db, user_id) == wallet.wallet_id
    symbol = _CURRENCY_SYMBOLS[currency]
    return CreateWalletResponse(
        wallet=_to_out(wallet, is_default, transaction_count=0),
        confirmation_message=(
            f"Monedero “{wallet.name}” creado con saldo inicial de {symbol} {initial_balance:.2f}"
        ),
    )


def list_wallets(db: Session, user_id: uuid.UUID, status: str | None = None) -> list[WalletOut]:
    """Paso 2 del flujo básico: los monederos del usuario con su saldo actual."""
    if status is not None and status != ACTIVE:
        # Sin columna status todavia, ningun monedero esta inactivo
        return []
    wallets = repository.list_wallets(db, user_id)
    counts = repository.count_transactions(db, [w.wallet_id for w in wallets])
    return [
        _to_out(wallet, is_default=index == 0, transaction_count=counts.get(wallet.wallet_id, 0))
        for index, wallet in enumerate(wallets)
    ]


def get_wallet(db: Session, user_id: uuid.UUID, wallet_id: uuid.UUID) -> WalletOut:
    wallet = repository.get_wallet(db, user_id, wallet_id)
    if wallet is None:
        raise _wallet_not_found()
    is_default = repository.get_default_wallet_id(db, user_id) == wallet.wallet_id
    counts = repository.count_transactions(db, [wallet.wallet_id])
    return _to_out(wallet, is_default, counts.get(wallet.wallet_id, 0))
