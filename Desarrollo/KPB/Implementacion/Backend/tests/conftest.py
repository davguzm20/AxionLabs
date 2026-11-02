import uuid

import fakeredis
import pytest
from fastapi.testclient import TestClient

from app.database import get_db
from app.entities import User
from app.integrations.redis.sessions import (
    LockoutStore,
    SessionStore,
    get_lockout_store,
    get_session_store,
)
from app.main import app
from app.modules.auth import repository
from app.modules.auth.deps import get_jwt_secret
from tests.fakes import SECRET, build_user, make_session


def pytest_configure(config) -> None:
    config.addinivalue_line("markers", "cp(id): caso del catalogo del curso")


@pytest.fixture
def db():
    return make_session()


@pytest.fixture
def redis_client():
    return fakeredis.FakeRedis(decode_responses=True)


@pytest.fixture
def users(monkeypatch) -> dict[str, User]:
    """Sustituye las consultas del repositorio por una tabla en memoria."""
    table: dict[str, User] = {}

    def get_user_by_email(_db, email: str) -> User | None:
        return table.get(email.strip().lower())

    def get_user(_db, user_id: uuid.UUID) -> User | None:
        return next((u for u in table.values() if u.user_id == user_id), None)

    def add_user_with_wallet(_db, name, surname, email, password_hash) -> User:
        user = build_user(email, name=name, surname=surname, password=password_hash)
        table[email] = user
        return user

    monkeypatch.setattr(repository, "get_user_by_email", get_user_by_email)
    monkeypatch.setattr(repository, "get_user", get_user)
    monkeypatch.setattr(repository, "add_user_with_wallet", add_user_with_wallet)
    return table


@pytest.fixture
def make_client(users, db, redis_client):
    """Fabrica un TestClient con la infraestructura sustituida por dobles."""

    def factory(*, session=None, redis=None, raise_server_exceptions: bool = True) -> TestClient:
        session = db if session is None else session
        redis = redis_client if redis is None else redis
        app.dependency_overrides[get_db] = lambda: session
        app.dependency_overrides[get_session_store] = lambda: SessionStore(redis)
        app.dependency_overrides[get_lockout_store] = lambda: LockoutStore(redis)
        app.dependency_overrides[get_jwt_secret] = lambda: SECRET
        return TestClient(app, raise_server_exceptions=raise_server_exceptions)

    yield factory
    app.dependency_overrides.clear()


@pytest.fixture
def client(make_client):
    return make_client()
