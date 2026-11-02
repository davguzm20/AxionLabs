"""Pruebas unitarias del CU01 (autenticacion), sin PostgreSQL ni Redis reales."""

import uuid
from decimal import Decimal

import pytest
from sqlalchemy.exc import IntegrityError

from app.core.security import decode_access_token, verify_password
from app.entities import AccessStatus, Currency, User, UserStatus, Wallet, WalletType
from app.integrations.redis.sessions import LockoutStore, SessionStore
from app.modules.auth import repository
from tests.fakes import (
    EMAIL,
    HASH,
    PASSWORD,
    SECRET,
    access_logs,
    added_of_type,
    create_user,
    error_code,
    make_failing_session,
    make_unavailable_redis,
)

# Valores del requisito y no del codigo bajo prueba
MAX_FAILURES = 3
LOCK_SECONDS = 30 * 60
SESSION_SECONDS = 20 * 60

LOGIN_URL = "/api/v1/auth/login"
LOGOUT_URL = "/api/v1/auth/logout"
ME_URL = "/api/v1/auth/me"
REGISTER_URL = "/api/v1/auth/register"


def login(client, email: str = EMAIL, password: str = PASSWORD):
    return client.post(LOGIN_URL, json={"email": email, "password": password})


def register(client, email: str = "nueva@example.com", **changes):
    body = {
        "name": "Andrea",
        "surname": "Quispe",
        "email": email,
        "password": PASSWORD,
        "confirm_password": PASSWORD,
        "accept_terms": True,
    } | changes
    return client.post(REGISTER_URL, json=body)


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def open_session(client, users) -> str:
    """Crea un usuario, inicia sesion y devuelve el token."""
    create_user(users)
    return login(client).json()["access_token"]


def session_key(token: str) -> str:
    _, sid = decode_access_token(token, SECRET)
    return f"session:{sid}"


@pytest.mark.cp("CP-AUT-01")
def test_login_valid_credentials_returns_token(client, users) -> None:
    user = create_user(users)

    response = login(client)

    assert response.status_code == 200
    body = response.json()
    assert body["token_type"] == "bearer"
    assert body["expires_in"] == SESSION_SECONDS
    assert body["user"]["email"] == user.email
    assert "password" not in body["user"]
    assert response.headers["cache-control"] == "no-store"


@pytest.mark.cp("CP-AUT-01")
def test_login_success_records_access_log(client, db, users) -> None:
    user = create_user(users)

    login(client)

    log = access_logs(db)[-1]
    assert log.status == AccessStatus.EXITOSO
    assert log.user_id == user.user_id
    assert log.device == client.headers["user-agent"]
    db.commit.assert_called()


@pytest.mark.cp("CP-AUT-02")
def test_login_wrong_password_returns_401(client, db, users) -> None:
    create_user(users)

    response = login(client, password="Incorrecta1")

    assert response.status_code == 401
    assert error_code(response) == "INVALID_CREDENTIALS"
    assert response.json()["error"]["message"] == (
        "Correo o contraseña incorrectos. Inténtalo de nuevo."
    )
    assert [log.status for log in access_logs(db)] == [AccessStatus.FALLIDO]


@pytest.mark.cp("CP-AUT-03")
def test_login_unknown_email_same_response_as_wrong_password(client, users) -> None:
    create_user(users)

    wrong_password = login(client, password="Incorrecta1")
    unknown_email = login(client, email="nadie@example.com")

    assert unknown_email.status_code == wrong_password.status_code == 401
    assert unknown_email.json() == wrong_password.json()


@pytest.mark.cp("CP-AUT-03")
def test_login_unknown_email_writes_no_access_log(client, db) -> None:
    login(client, email="nadie@example.com")

    assert access_logs(db) == []


def test_login_inactive_account_returns_403(client, users) -> None:
    user = create_user(users)
    user.status = UserStatus.INACTIVO

    response = login(client)

    assert response.status_code == 403
    assert error_code(response) == "ACCOUNT_INACTIVE"
    assert "access_token" not in response.json()


@pytest.mark.cp("CP-AUT-17")
def test_login_redis_down_returns_503(users, make_client) -> None:
    create_user(users)
    client = make_client(redis=make_unavailable_redis(), raise_server_exceptions=False)

    response = login(client)

    assert response.status_code == 503
    assert error_code(response) == "AUTH_UNAVAILABLE"


@pytest.mark.xfail(
    strict=True,
    raises=AssertionError,
    reason="DEF-01 el PP pide 503 con la base caida pero errors.py responde 500",
)
@pytest.mark.cp("CP-AUT-17")
def test_login_database_down_returns_503(users, make_client) -> None:
    create_user(users)
    client = make_client(session=make_failing_session(), raise_server_exceptions=False)

    response = login(client)

    assert response.status_code == 503


@pytest.mark.cp("CP-AUT-04")
def test_lockout_third_failure_locks_account(client, db, redis_client, users) -> None:
    user = create_user(users)
    for _ in range(MAX_FAILURES - 1):
        assert login(client, password="Incorrecta1").status_code == 401

    third = login(client, password="Incorrecta1")

    assert third.status_code == 423
    assert error_code(third) == "ACCOUNT_LOCKED"
    assert user.status == UserStatus.BLOQUEADO
    assert LockoutStore(redis_client).is_locked(user.user_id)
    assert [log.status for log in access_logs(db)] == [AccessStatus.FALLIDO] * MAX_FAILURES


@pytest.mark.cp("CP-AUT-04")
def test_lockout_lasts_30_minutes(client, redis_client, users) -> None:
    user = create_user(users)
    for _ in range(MAX_FAILURES):
        login(client, password="Incorrecta1")

    ttl = redis_client.ttl(f"login:locked:{user.user_id}")

    assert ttl == pytest.approx(LOCK_SECONDS, abs=5)


@pytest.mark.cp("CP-AUT-05")
def test_lockout_correct_password_rejected_while_locked(client, users) -> None:
    create_user(users)
    for _ in range(MAX_FAILURES):
        login(client, password="Incorrecta1")

    response = login(client)

    assert response.status_code == 423
    assert error_code(response) == "ACCOUNT_LOCKED"


@pytest.mark.cp("CP-AUT-05")
def test_lockout_expired_lock_allows_login(client, redis_client, users) -> None:
    user = create_user(users)
    for _ in range(MAX_FAILURES):
        login(client, password="Incorrecta1")

    # Lo que haria Redis al vencer los TTL
    redis_client.flushall()
    response = login(client)

    assert response.status_code == 200
    assert user.status == UserStatus.ACTIVO


@pytest.mark.cp("CP-AUT-06")
def test_lockout_success_resets_failure_counter(client, users) -> None:
    user = create_user(users)
    for _ in range(MAX_FAILURES - 1):
        login(client, password="Incorrecta1")

    assert login(client).status_code == 200

    again = [login(client, password="Incorrecta1") for _ in range(MAX_FAILURES - 1)]

    assert [r.status_code for r in again] == [401] * (MAX_FAILURES - 1)
    assert user.status == UserStatus.ACTIVO


@pytest.mark.cp("CP-AUT-04")
def test_lockout_store_locks_on_third_failure(redis_client) -> None:
    lockout = LockoutStore(redis_client)
    user_id = uuid.uuid4()

    lockout.register_failure(user_id)
    lockout.register_failure(user_id)
    assert not lockout.is_locked(user_id)

    lockout.register_failure(user_id)
    assert lockout.is_locked(user_id)


@pytest.mark.parametrize(
    ("changes", "expected"),
    [
        pytest.param({"name": ""}, "VALIDATION_ERROR", id="empty-name"),
        pytest.param({"name": "   "}, "VALIDATION_ERROR", id="blank-name"),
        pytest.param({"email": "usuario@"}, "INVALID_EMAIL", id="malformed-email"),
        pytest.param(
            {"password": "abc", "confirm_password": "abc"}, "WEAK_PASSWORD", id="weak-password"
        ),
        pytest.param({"confirm_password": "Distinta123"}, "PASSWORD_MISMATCH", id="mismatch"),
        pytest.param({"accept_terms": False}, "TERMS_NOT_ACCEPTED", id="terms-not-accepted"),
    ],
)
@pytest.mark.cp("CP-AUT-07")
def test_register_rejects_invalid_input(client, db, users, changes, expected) -> None:
    response = register(client, **changes)

    assert response.status_code == 422
    assert error_code(response) == expected
    assert users == {}
    assert access_logs(db) == []


@pytest.mark.cp("CP-AUT-08")
def test_register_stores_argon2id_hash(client, db, users) -> None:
    response = register(client)

    assert response.status_code == 201
    user = users["nueva@example.com"]
    assert user.password.startswith("$argon2id$")
    assert verify_password(PASSWORD, user.password)
    assert PASSWORD not in user.password
    db.commit.assert_called()


def test_register_normalizes_email(client, users) -> None:
    response = register(client, email="Andrea@Example.com")

    assert response.status_code == 201
    assert response.json()["user"]["email"] == EMAIL
    assert list(users) == [EMAIL]


def test_register_duplicate_email_returns_409(client, users) -> None:
    create_user(users)

    response = register(client, email=EMAIL)

    assert response.status_code == 409
    assert error_code(response) == "EMAIL_ALREADY_EXISTS"
    assert len(users) == 1


def test_register_concurrent_duplicate_returns_409(users, db, make_client, monkeypatch) -> None:
    """Dos altas simultaneas pasan la verificacion previa y chocan con el UNIQUE."""

    def violate_unique(*args, **kwargs):
        raise IntegrityError("INSERT INTO users", None, Exception("duplicate key"))

    monkeypatch.setattr(repository, "add_user_with_wallet", violate_unique)
    client = make_client(raise_server_exceptions=False)

    response = register(client)

    assert response.status_code == 409
    assert error_code(response) == "EMAIL_ALREADY_EXISTS"
    db.rollback.assert_called_once()


def test_add_user_creates_default_wallet(db) -> None:
    # Se ejecuta el repositorio real contra la sesion simulada
    repository.add_user_with_wallet(db, "Andrea", "Quispe", "nueva@example.com", HASH)

    created_users = added_of_type(db, User)
    wallets = added_of_type(db, Wallet)
    assert len(created_users) == 1
    assert created_users[0].password == HASH
    assert len(wallets) == 1
    wallet = wallets[0]
    assert (wallet.name, wallet.type, wallet.currency) == (
        "Efectivo",
        WalletType.EFECTIVO,
        Currency.PEN,
    )
    assert wallet.initial_balance == Decimal("0")


def test_login_creates_session_with_20_minute_ttl(client, redis_client, users) -> None:
    token = open_session(client, users)

    assert redis_client.ttl(session_key(token)) == pytest.approx(SESSION_SECONDS, abs=5)


@pytest.mark.cp("CP-AUT-09")
def test_me_expired_session_returns_401(client, redis_client, users) -> None:
    token = open_session(client, users)

    # Lo que hace el TTL al vencer
    redis_client.delete(session_key(token))
    response = client.get(ME_URL, headers=bearer(token))

    assert response.status_code == 401
    assert error_code(response) == "SESSION_EXPIRED"


@pytest.mark.cp("CP-AUT-10")
def test_session_touch_resets_ttl(redis_client) -> None:
    store = SessionStore(redis_client)
    sid = store.create(uuid.uuid4(), "127.0.0.1", "testclient")
    key = f"session:{sid}"
    redis_client.expire(key, 60)

    renewed = store.touch(sid)

    assert renewed is not None
    assert redis_client.ttl(key) == pytest.approx(SESSION_SECONDS, abs=5)


@pytest.mark.cp("CP-AUT-10")
def test_me_renews_session_ttl(client, redis_client, users) -> None:
    token = open_session(client, users)
    key = session_key(token)
    redis_client.expire(key, 60)

    client.get(ME_URL, headers=bearer(token))

    assert redis_client.ttl(key) == pytest.approx(SESSION_SECONDS, abs=5)


@pytest.mark.cp("CP-AUT-11")
def test_logout_invalidates_token(client, redis_client, users) -> None:
    token = open_session(client, users)

    logout_response = client.post(LOGOUT_URL, headers=bearer(token))
    after_logout = client.get(ME_URL, headers=bearer(token))

    assert logout_response.status_code == 204
    assert after_logout.status_code == 401
    assert error_code(after_logout) == "SESSION_EXPIRED"
    assert redis_client.exists(session_key(token)) == 0


@pytest.mark.cp("CP-AUT-11")
def test_me_rejects_user_deactivated_after_login(client, users) -> None:
    token = open_session(client, users)

    users[EMAIL].status = UserStatus.INACTIVO
    response = client.get(ME_URL, headers=bearer(token))

    assert response.status_code == 401
    assert error_code(response) == "UNAUTHORIZED"


@pytest.mark.parametrize(
    "headers",
    [
        pytest.param({}, id="no-header"),
        pytest.param({"Authorization": "Bearer token-falso"}, id="garbage-token"),
    ],
)
@pytest.mark.cp("CP-NF-01")
def test_me_requires_valid_token(client, headers) -> None:
    response = client.get(ME_URL, headers=headers)

    assert response.status_code == 401
    assert error_code(response) == "UNAUTHORIZED"
