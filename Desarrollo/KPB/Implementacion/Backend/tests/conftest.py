"""Fixtures compartidas: dobles en memoria para BD, Redis y el extractor de IA."""

import uuid
from datetime import UTC, datetime

import fakeredis
import pytest
from fastapi.testclient import TestClient

from app.config import AISettings
from app.database import get_db
from app.entities import Category, User, Wallet
from app.integrations.ai import extractor
from app.integrations.redis.sessions import (
    LockoutStore,
    SessionStore,
    get_lockout_store,
    get_session_store,
)
from app.main import app
from app.modules.auth import repository
from app.modules.auth.deps import get_jwt_secret
from app.modules.transactions import repository as transactions_repository
from tests.fakes import SECRET, build_user, make_session


def pytest_configure(config) -> None:
    config.addinivalue_line("markers", "cp(id): caso del catalogo del curso")


@pytest.fixture(autouse=True)
def ai_mock(monkeypatch) -> None:
    """Nunca llama a OpenAI, aunque el .env de desarrollo tenga una clave."""
    monkeypatch.setattr(
        extractor,
        "get_ai_settings",
        lambda: AISettings(openai_api_key=None),
    )


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

    def factory(
        *, session=None, redis=None, raise_server_exceptions: bool = True
    ) -> TestClient:
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


@pytest.fixture
def wallets(monkeypatch) -> list[Wallet]:
    """Sustituye las consultas de monederos por una lista en memoria."""
    table: list[Wallet] = []

    def get_wallet(_db, user_id, wallet_id=None, for_update=False):
        owned = [w for w in table if w.user_id == user_id]
        if wallet_id is not None:
            return next((w for w in owned if w.wallet_id == wallet_id), None)
        return owned[0] if owned else None

    monkeypatch.setattr(transactions_repository, "get_wallet", get_wallet)
    return table


@pytest.fixture
def categories(monkeypatch) -> dict[str, Category]:
    """Categorias indexadas por nombre, como las busca el repositorio real."""
    table: dict[str, Category] = {}

    def get_category_by_name(_db, _user_id, name):
        return table.get(name.strip().lower())

    def get_fallback_category(_db):
        return table["otros"]

    def get_category_by_id(_db, _user_id, category_id):
        return next((c for c in table.values() if c.category_id == category_id), None)

    monkeypatch.setattr(
        transactions_repository, "get_category_by_name", get_category_by_name
    )
    monkeypatch.setattr(
        transactions_repository, "get_fallback_category", get_fallback_category
    )
    monkeypatch.setattr(
        transactions_repository, "get_category_by_id", get_category_by_id
    )
    return table


@pytest.fixture(autouse=True)
def saved_transactions(monkeypatch) -> list:
    """Registra las transacciones que el servicio manda a persistir."""
    saved: list = []

    def save_transaction_and_update_balance(db, transaction, wallet, balance_delta):
        transaction.transaction_id = uuid.uuid4()
        transaction.created_at = datetime.now(UTC)
        wallet.current_balance += balance_delta
        saved.append(transaction)

    monkeypatch.setattr(
        transactions_repository,
        "save_transaction_and_update_balance",
        save_transaction_and_update_balance,
    )
    return saved
