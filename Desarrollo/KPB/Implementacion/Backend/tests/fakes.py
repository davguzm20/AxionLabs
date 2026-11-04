"""Datos y utilidades compartidas por la suite del backend."""

import uuid
from datetime import UTC, datetime
from unittest.mock import MagicMock

import fakeredis
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.entities import AccessLog, User, UserStatus

EMAIL = "andrea@example.com"
PASSWORD = "Secreta123"
SECRET = "x" * 32

# Se calcula una sola vez porque Argon2id tarda unos 100 ms
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


def error_code(response) -> str:
    return response.json()["error"]["code"]


def added_of_type(session: MagicMock, cls: type) -> list:
    """Objetos de un tipo que se pasaron a session.add."""
    return [c.args[0] for c in session.add.call_args_list if isinstance(c.args[0], cls)]


def access_logs(session: MagicMock) -> list[AccessLog]:
    return added_of_type(session, AccessLog)
