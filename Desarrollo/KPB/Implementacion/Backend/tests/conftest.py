import os
import uuid

import fakeredis
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from app.database import get_db
from app.integrations.redis.sessions import (
    LockoutStore,
    SessionStore,
    get_lockout_store,
    get_session_store,
)
from app.main import app
from app.modules.auth import repository as auth_repository
from app.modules.auth.deps import get_jwt_secret
from tests.fakes import SECRET, User, build_user, make_session

# Base PostgreSQL de pruebas con KPB-SCHEMA.sql cargado. Las pruebas que la
# usan se omiten si no se define. No uses la base del equipo: se vacia la
# tabla users (y sus dependientes) antes de cada prueba.
TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")

requires_db = pytest.mark.skipif(not TEST_DATABASE_URL, reason="TEST_DATABASE_URL no definida")


@pytest.fixture
def db_session():
    engine = create_engine(TEST_DATABASE_URL)
    with engine.begin() as connection:
        connection.execute(text("TRUNCATE users CASCADE"))
    with Session(engine) as session:
        yield session
    engine.dispose()


@pytest.fixture
def db():
    """SesiÃ³n simulada para pruebas unitarias sin PostgreSQL."""
    return make_session()


@pytest.fixture
def redis_client():
    return fakeredis.FakeRedis(decode_responses=True)


@pytest.fixture
def users(monkeypatch) -> dict[str, User]:
    """Tabla de usuarios en memoria para flujos de autenticaciÃ³n unitarios."""
    table: dict[str, User] = {}

    def get_user_by_email(_db, email: str) -> User | None:
        return table.get(email.strip().lower())

    def get_user(_db, user_id: uuid.UUID) -> User | None:
        return next((user for user in table.values() if user.user_id == user_id), None)

    def add_user_with_wallet(_db, name, surname, email, password_hash) -> User:
        user = build_user(email, name=name, surname=surname, password=password_hash)
        table[email] = user
        return user

    monkeypatch.setattr(auth_repository, "get_user_by_email", get_user_by_email)
    monkeypatch.setattr(auth_repository, "get_user", get_user)
    monkeypatch.setattr(auth_repository, "add_user_with_wallet", add_user_with_wallet)
    return table


@pytest.fixture
def client(users, db, redis_client):
    """Cliente FastAPI con BD y Redis sustituidos por dobles de prueba."""
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_session_store] = lambda: SessionStore(redis_client)
    app.dependency_overrides[get_lockout_store] = lambda: LockoutStore(redis_client)
    app.dependency_overrides[get_jwt_secret] = lambda: SECRET
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
