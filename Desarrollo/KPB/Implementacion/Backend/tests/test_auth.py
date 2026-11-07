"""Pruebas del CU01 (registro, login, bloqueo, sesion y logout)."""

import fakeredis
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.entities import AccessLog, AccessStatus, User, UserStatus, Wallet, WalletType
from app.integrations.redis.sessions import (
    LockoutStore,
    SessionStore,
    get_lockout_store,
    get_session_store,
)
from app.main import app
from app.modules.auth.deps import get_jwt_secret
from tests.conftest import requires_db

pytestmark = requires_db

PASSWORD = "Secreta123"


@pytest.fixture
def redis_client():
    return fakeredis.FakeRedis(decode_responses=True)


@pytest.fixture
def client(db_session: Session, redis_client):
    def override_db():
        with Session(db_session.get_bind()) as session:
            yield session

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_session_store] = lambda: SessionStore(redis_client)
    app.dependency_overrides[get_lockout_store] = lambda: LockoutStore(redis_client)
    app.dependency_overrides[get_jwt_secret] = lambda: "clave-de-pruebas-" + "x" * 32
    yield TestClient(app)
    app.dependency_overrides.clear()


def register(client: TestClient, email: str = "andrea@example.com", **changes):
    body = {
        "name": "Andrea",
        "surname": "Quispe",
        "email": email,
        "password": PASSWORD,
        "confirm_password": PASSWORD,
        "accept_terms": True,
    } | changes
    return client.post("/api/v1/auth/register", json=body)


def login(client: TestClient, email: str = "andrea@example.com", password: str = PASSWORD):
    return client.post("/api/v1/auth/login", json={"email": email, "password": password})


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def error_code(response) -> str:
    return response.json()["error"]["code"]


def fresh_user(db_session: Session) -> User:
    user = db_session.scalar(select(User))
    db_session.refresh(user)
    return user


def access_statuses(db_session: Session) -> list[AccessStatus]:
    return list(db_session.scalars(select(AccessLog.status).order_by(AccessLog.accessed_at)))


# --- Registro ---


def test_register_creates_user_and_initial_wallet(client, db_session) -> None:
    response = register(client, email="Andrea@Example.com")

    assert response.status_code == 201
    body = response.json()
    assert body["token_type"] == "bearer"
    assert body["expires_in"] == 1200
    assert body["user"]["email"] == "andrea@example.com"
    assert set(body["user"]) == {"id", "name", "surname", "email", "created_at"}
    assert response.headers["cache-control"] == "no-store"

    user = fresh_user(db_session)
    assert str(user.user_id) == body["user"]["id"]
    assert user.password.startswith("$argon2id$")
    wallet = db_session.scalar(select(Wallet).where(Wallet.user_id == user.user_id))
    assert (wallet.name, wallet.type, wallet.currency.value) == ("Efectivo", WalletType.EFECTIVO, "PEN")


def test_register_duplicate_email_ignores_case(client, db_session) -> None:
    register(client)

    response = register(client, email="ANDREA@example.com")

    assert response.status_code == 409
    assert error_code(response) == "EMAIL_ALREADY_EXISTS"
    assert db_session.scalar(select(func.count()).select_from(User)) == 1


@pytest.mark.parametrize(
    ("changes", "code"),
    [
        ({"password": "abc", "confirm_password": "abc"}, "WEAK_PASSWORD"),
        ({"confirm_password": "Distinta123"}, "PASSWORD_MISMATCH"),
        ({"email": "abc"}, "INVALID_EMAIL"),
        ({"accept_terms": False}, "TERMS_NOT_ACCEPTED"),
        ({"name": "   "}, "VALIDATION_ERROR"),
    ],
)
def test_register_validations(client, db_session, changes, code) -> None:
    response = register(client, **changes)

    assert response.status_code == 422
    assert error_code(response) == code
    assert db_session.scalar(select(func.count()).select_from(User)) == 0


# --- Login y sesion ---


def test_login_returns_token_session_and_access_log(client, db_session, redis_client) -> None:
    register(client)

    response = login(client, email="ANDREA@example.com")

    assert response.status_code == 200
    body = response.json()
    assert set(body["user"]) == {"id", "name", "surname", "email"}
    assert any(not k.startswith("session:user:") for k in redis_client.keys("session:*"))
    assert access_statuses(db_session) == [AccessStatus.EXITOSO]

    me = client.get("/api/v1/auth/me", headers=bearer(body["access_token"]))
    assert me.status_code == 200
    assert me.json()["user"]["email"] == "andrea@example.com"
    assert me.json()["session"]["expires_in"] == 1200


def test_login_does_not_reveal_if_email_exists(client) -> None:
    register(client)

    wrong_password = login(client, password="Incorrecta1")
    unknown_email = login(client, email="nadie@example.com")

    assert wrong_password.status_code == unknown_email.status_code == 401
    assert wrong_password.json() == unknown_email.json()
    assert error_code(wrong_password) == "INVALID_CREDENTIALS"


def test_third_failure_locks_account(client, db_session, redis_client) -> None:
    register(client)

    assert login(client, password="Incorrecta1").status_code == 401
    assert login(client, password="Incorrecta2").status_code == 401
    third = login(client, password="Incorrecta3")

    assert third.status_code == 423
    assert error_code(third) == "ACCOUNT_LOCKED"
    user = fresh_user(db_session)
    assert user.status == UserStatus.BLOQUEADO
    assert 1790 < redis_client.ttl(f"login:locked:{user.user_id}") <= 1800
    assert access_statuses(db_session) == [AccessStatus.FALLIDO] * 3

    # Bloqueada, ni con la contrasena correcta entra
    assert login(client).status_code == 423


def test_lock_is_released_after_30_minutes(client, db_session, redis_client) -> None:
    register(client)
    for attempt in range(3):
        login(client, password=f"Incorrecta{attempt}")
    user = fresh_user(db_session)
    # Simula que pasaron los 30 minutos: Redis borra la clave al vencer el TTL
    redis_client.delete(f"login:locked:{user.user_id}")

    response = login(client)

    assert response.status_code == 200
    assert fresh_user(db_session).status == UserStatus.ACTIVO


def test_success_resets_failed_attempts(client, db_session, redis_client) -> None:
    register(client)
    login(client, password="Incorrecta1")
    login(client, password="Incorrecta2")

    assert login(client).status_code == 200

    user = fresh_user(db_session)
    assert redis_client.get(f"login:failures:{user.user_id}") is None
    # Tras el exito el contador vuelve a cero: dos fallos mas no bloquean
    login(client, password="Incorrecta3")
    assert login(client, password="Incorrecta4").status_code == 401


def test_inactive_account_is_rejected(client, db_session) -> None:
    register(client)
    user = fresh_user(db_session)
    user.status = UserStatus.INACTIVO
    db_session.commit()

    response = login(client)

    assert response.status_code == 403
    assert error_code(response) == "ACCOUNT_INACTIVE"


def test_expired_session_returns_session_expired(client, redis_client) -> None:
    token = register(client).json()["access_token"]
    # Simula los 20 minutos sin actividad: Redis borra la sesion al vencer el TTL
    for key in redis_client.keys("session:*"):
        if not key.startswith("session:user:"):
            redis_client.delete(key)

    response = client.get("/api/v1/auth/me", headers=bearer(token))

    assert response.status_code == 401
    assert error_code(response) == "SESSION_EXPIRED"


def test_activity_renews_session_ttl(client, redis_client) -> None:
    token = register(client).json()["access_token"]
    session_key = next(k for k in redis_client.keys("session:*") if not k.startswith("session:user:"))
    redis_client.expire(session_key, 60)

    client.get("/api/v1/auth/me", headers=bearer(token))

    assert redis_client.ttl(session_key) > 1100


def test_logout_invalidates_token(client) -> None:
    token = register(client).json()["access_token"]

    response = client.post("/api/v1/auth/logout", headers=bearer(token))

    assert response.status_code == 204
    after = client.get("/api/v1/auth/me", headers=bearer(token))
    assert after.status_code == 401
    assert error_code(after) == "SESSION_EXPIRED"


@pytest.mark.parametrize("headers", [{}, {"Authorization": "Bearer token-falso"}])
def test_protected_endpoint_requires_valid_token(client, headers) -> None:
    response = client.get("/api/v1/auth/me", headers=headers)

    assert response.status_code == 401
    assert error_code(response) == "UNAUTHORIZED"
