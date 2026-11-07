"""Datos y dobles de prueba compartidos por la suite del backend.

Los fakes viven en memoria (usuarios, monederos y categorias) y los helpers
arman objetos sin PostgreSQL. Los mocks de comportamiento se crean en cada
prueba con `monkeypatch` o `MagicMock`.
"""

import uuid
from datetime import UTC, datetime
from decimal import Decimal
from unittest.mock import MagicMock

import fakeredis
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.entities import (
    AccessLog,
    Category,
    Currency,
    User,
    UserStatus,
    Wallet,
    WalletType,
)

EMAIL = "andrea@example.com"
PASSWORD = "Secreta123"
SECRET = "x" * 32
HASH = hash_password(PASSWORD)


def make_session() -> MagicMock:
    """Sesion que registra llamadas sin tocar la base."""
    return MagicMock(spec=Session)


def make_failing_session() -> MagicMock:
    """Sesion cuyo commit falla como con la base de datos caida."""
    session = make_session()
    session.commit.side_effect = OperationalError(
        "INSERT INTO access_logs", None, Exception("sin conexion")
    )
    return session


def make_unavailable_redis() -> fakeredis.FakeRedis:
    """Servidor desconectado: toda operacion falla con ConnectionError."""
    server = fakeredis.FakeServer()
    server.connected = False
    return fakeredis.FakeRedis(server=server, decode_responses=True)


def build_user(email: str = EMAIL, **changes) -> User:
    """Rellena lo que PostgreSQL asignaria con server_default."""
    fields = {
        "name": "Andrea",
        "surname": "Quispe",
        "email": email,
        "password": HASH,
    } | changes
    user = User(**fields)
    user.user_id = uuid.uuid4()
    user.status = UserStatus.ACTIVO
    user.created_at = datetime.now(UTC)
    return user


def create_user(table: dict[str, User], email: str = EMAIL) -> User:
    user = build_user(email)
    table[email] = user
    return user


def build_category(name: str = "Alimentación", **changes) -> Category:
    """Categoria en memoria con los campos que PostgreSQL rellenaria."""
    category = Category(name=name, **changes)
    category.category_id = uuid.uuid4()
    category.created_at = datetime.now(UTC)
    return category


def build_wallet(
    user_id: uuid.UUID,
    balance: str = "200.00",
    currency: Currency = Currency.PEN,
    **changes,
) -> Wallet:
    """Monedero en memoria con saldo inicial y actual iguales."""
    fields = {
        "user_id": user_id,
        "name": "Efectivo",
        "type": WalletType.EFECTIVO,
        "currency": currency,
        "initial_balance": Decimal(balance),
        "current_balance": Decimal(balance),
    } | changes
    wallet = Wallet(**fields)
    wallet.wallet_id = uuid.uuid4()
    wallet.created_at = datetime.now(UTC)
    wallet.updated_at = datetime.now(UTC)
    return wallet


def error_code(response) -> str:
    return response.json()["error"]["code"]


def added_of_type(session: MagicMock, cls: type) -> list:
    """Objetos de un tipo que se pasaron a session.add."""
    return [c.args[0] for c in session.add.call_args_list if isinstance(c.args[0], cls)]


def access_logs(session: MagicMock) -> list[AccessLog]:
    return added_of_type(session, AccessLog)
