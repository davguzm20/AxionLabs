"""Pruebas unitarias del CU06 (monederos) con dobles de prueba.

La sesion de PostgreSQL es un MagicMock y las consultas del repositorio de
monederos se sustituyen por una tabla en memoria. Ninguna prueba toca la BD.
"""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.exc import IntegrityError

from app.entities import Currency, Wallet, WalletType
from app.modules.wallets import repository as wallets_repository
from tests.fakes import EMAIL, PASSWORD, build_wallet, create_user, error_code

WALLETS_URL = "/api/v1/wallets"


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def open_session(client, users, email: str = EMAIL) -> str:
    create_user(users, email)
    response = client.post("/api/v1/auth/login", json={"email": email, "password": PASSWORD})
    return response.json()["access_token"]


def user_id_of(users, email: str = EMAIL) -> uuid.UUID:
    return users[email].user_id


class WalletTable(list):
    """Monederos en memoria y la cantidad de transacciones de cada uno."""

    def __init__(self) -> None:
        super().__init__()
        self.transaction_counts: dict[uuid.UUID, int] = {}


@pytest.fixture
def wallet_table(monkeypatch) -> WalletTable:
    """Sustituye el repositorio de monederos por una lista en memoria."""
    table = WalletTable()
    transaction_counts = table.transaction_counts

    def owned(user_id):
        return sorted(
            (w for w in table if w.user_id == user_id), key=lambda w: w.created_at
        )

    def list_wallets(_db, user_id):
        return owned(user_id)

    def get_wallet(_db, user_id, wallet_id):
        return next((w for w in owned(user_id) if w.wallet_id == wallet_id), None)

    def get_default_wallet_id(_db, user_id):
        wallets = owned(user_id)
        return wallets[0].wallet_id if wallets else None

    def wallet_name_exists(_db, user_id, name):
        return any(w.name.lower() == name.lower() for w in owned(user_id))

    def add_wallet(_db, wallet):
        # Lo que PostgreSQL asignaria con server_default
        wallet.wallet_id = uuid.uuid4()
        wallet.created_at = datetime.now(UTC)
        table.append(wallet)

    def count_transactions(_db, wallet_ids):
        return {w: transaction_counts[w] for w in wallet_ids if w in transaction_counts}

    monkeypatch.setattr(wallets_repository, "list_wallets", list_wallets)
    monkeypatch.setattr(wallets_repository, "get_wallet", get_wallet)
    monkeypatch.setattr(wallets_repository, "get_default_wallet_id", get_default_wallet_id)
    monkeypatch.setattr(wallets_repository, "wallet_name_exists", wallet_name_exists)
    monkeypatch.setattr(wallets_repository, "add_wallet", add_wallet)
    monkeypatch.setattr(wallets_repository, "count_transactions", count_transactions)
    return table


def add_existing(table, user_id, name="Efectivo", minutes_ago=60, **changes) -> Wallet:
    wallet = build_wallet(user_id, name=name, **changes)
    wallet.created_at = datetime.now(UTC) - timedelta(minutes=minutes_ago)
    table.append(wallet)
    return wallet


def create(client, token, **changes):
    body = {"name": "BCP Ahorros", "type": "bank", "currency": "PEN", "initial_balance": "200.00"}
    return client.post(WALLETS_URL, json=body | changes, headers=bearer(token))


# --- Crear (flujo basico) ---


def test_create_wallet_returns_summary_and_confirmation(client, users, wallet_table, db) -> None:
    token = open_session(client, users)
    db.reset_mock()  # el login ya hizo su propio commit

    response = create(client, token)

    assert response.status_code == 201
    body = response.json()
    wallet = body["wallet"]
    assert wallet["name"] == "BCP Ahorros"
    assert (wallet["type"], wallet["currency"]) == ("bank", "PEN")
    assert wallet["initial_balance"] == wallet["balance"] == wallet["current_balance"] == "200.00"
    assert (wallet["status"], wallet["has_transactions"], wallet["transaction_count"]) == (
        "ACTIVE",
        False,
        0,
    )
    assert body["confirmation_message"] == (
        "Monedero “BCP Ahorros” creado con saldo inicial de S/ 200.00"
    )
    assert response.headers["cache-control"] == "no-store"

    saved = wallet_table[0]
    assert saved.user_id == user_id_of(users)
    assert (saved.type, saved.currency) == (WalletType.BANCO, Currency.PEN)
    db.commit.assert_called_once()


def test_first_wallet_is_default_and_next_ones_are_not(client, users, wallet_table) -> None:
    token = open_session(client, users)

    first = create(client, token, name="Efectivo", type="cash").json()["wallet"]
    second = create(client, token, name="BCP").json()["wallet"]

    assert first["is_default"] is True
    assert second["is_default"] is False


@pytest.mark.parametrize(
    ("sent", "saved"),
    [(None, "0.00"), ("0", "0.00"), ("15.5", "15.50"), ("99999999.99", "99999999.99")],
)
def test_initial_balance_defaults_and_is_normalized(client, users, wallet_table, sent, saved) -> None:
    token = open_session(client, users)
    body = {"name": "Yape", "type": "cash", "currency": "PEN"}
    if sent is not None:
        body["initial_balance"] = sent

    response = client.post(WALLETS_URL, json=body, headers=bearer(token))

    assert response.status_code == 201
    assert response.json()["wallet"]["initial_balance"] == saved


def test_accepts_uppercase_type_and_usd(client, users, wallet_table) -> None:
    token = open_session(client, users)

    response = create(client, token, type="CASH", currency="USD", initial_balance="50")

    assert response.status_code == 201
    assert response.json()["wallet"]["type"] == "cash"
    assert response.json()["confirmation_message"].endswith("$ 50.00")


def test_accepts_colloquial_spanish_names(client, users, wallet_table) -> None:
    token = open_session(client, users)

    response = create(client, token, name="  Plata pa'l menú ñaño  ")

    assert response.status_code == 201
    assert response.json()["wallet"]["name"] == "Plata pa'l menú ñaño"


# --- Excepciones del CU06 ---


def test_ex1_duplicated_name_ignores_case(client, users, wallet_table, db) -> None:
    token = open_session(client, users)
    add_existing(wallet_table, user_id_of(users), name="Efectivo")
    db.reset_mock()  # el login ya hizo su propio commit

    response = create(client, token, name="EFECTIVO")

    assert response.status_code == 409
    assert error_code(response) == "WALLET_NAME_DUPLICATED"
    assert response.json()["error"]["message"] == (
        "El nombre del monedero ya está en uso. Por favor, escoja un nombre distinto."
    )
    db.commit.assert_not_called()


def test_ex1_same_name_in_another_user_is_allowed(client, users, wallet_table) -> None:
    token = open_session(client, users)
    add_existing(wallet_table, uuid.uuid4(), name="BCP Ahorros")

    assert create(client, token).status_code == 201


def test_ex1_concurrent_duplicate_is_caught_by_the_database(client, users, wallet_table, db) -> None:
    token = open_session(client, users)
    db.commit.side_effect = IntegrityError("INSERT INTO wallets", None, Exception("uq_wallets_user_name"))

    response = create(client, token)

    assert response.status_code == 409
    assert error_code(response) == "WALLET_NAME_DUPLICATED"
    db.rollback.assert_called_once()


@pytest.mark.parametrize("name", ["", "   "])
def test_ex2_empty_name(client, users, wallet_table, name) -> None:
    token = open_session(client, users)

    response = create(client, token, name=name)

    assert response.status_code == 422
    assert error_code(response) == "WALLET_NAME_EMPTY"
    assert response.json()["error"]["message"] == (
        "El nombre del monedero no puede estar vacío. Por favor, escoja un nombre apropiado."
    )
    assert wallet_table == []


@pytest.mark.parametrize("balance", ["-1", "-0.01", "abc", "10.123", "100000000.00", ""])
def test_ex3_invalid_initial_balance(client, users, wallet_table, balance) -> None:
    token = open_session(client, users)

    response = create(client, token, initial_balance=balance)

    assert response.status_code == 422
    assert error_code(response) == "INITIAL_BALANCE_INVALID"
    assert response.json()["error"]["message"] == (
        "El saldo inicial debe ser un monto válido mayor o igual a S/ 0.00."
    )
    assert wallet_table == []


@pytest.mark.parametrize(
    ("changes", "field"),
    [({"name": "x" * 41}, "name"), ({"type": "tarjeta"}, "type"), ({"currency": "EUR"}, "currency")],
)
def test_other_invalid_fields(client, users, wallet_table, changes, field) -> None:
    token = open_session(client, users)

    response = create(client, token, **changes)

    assert response.status_code == 422
    assert error_code(response) == "VALIDATION_ERROR"
    assert response.json()["error"]["details"][0]["field"] == field


# --- Listar y consultar ---


def test_list_returns_only_own_wallets_oldest_first(client, users, wallet_table) -> None:
    token = open_session(client, users)
    owner = user_id_of(users)
    cash = add_existing(wallet_table, owner, name="Efectivo", minutes_ago=90, balance="185.00")
    bank = add_existing(wallet_table, owner, name="BCP", minutes_ago=30, type=WalletType.BANCO)
    add_existing(wallet_table, uuid.uuid4(), name="Ajeno")
    wallet_table.transaction_counts[cash.wallet_id] = 3

    response = client.get(WALLETS_URL, headers=bearer(token))

    assert response.status_code == 200
    data = response.json()["data"]
    assert [w["id"] for w in data] == [str(cash.wallet_id), str(bank.wallet_id)]
    assert [w["is_default"] for w in data] == [True, False]
    assert (data[0]["balance"], data[0]["transaction_count"], data[0]["has_transactions"]) == (
        "185.00",
        3,
        True,
    )
    assert data[1]["type"] == "bank"


def test_list_with_status_filter(client, users, wallet_table) -> None:
    token = open_session(client, users)
    add_existing(wallet_table, user_id_of(users))

    active = client.get(WALLETS_URL, params={"status": "ACTIVE"}, headers=bearer(token))
    inactive = client.get(WALLETS_URL, params={"status": "INACTIVE"}, headers=bearer(token))

    assert len(active.json()["data"]) == 1
    assert inactive.json()["data"] == []


def test_get_wallet_detail(client, users, wallet_table) -> None:
    token = open_session(client, users)
    wallet = add_existing(wallet_table, user_id_of(users), balance="42.50")

    response = client.get(f"{WALLETS_URL}/{wallet.wallet_id}", headers=bearer(token))

    assert response.status_code == 200
    body = response.json()
    assert body["id"] == str(wallet.wallet_id)
    assert (body["balance"], body["is_default"]) == ("42.50", True)


def test_get_wallet_of_another_user_is_not_found(client, users, wallet_table) -> None:
    token = open_session(client, users)
    foreign = add_existing(wallet_table, uuid.uuid4(), name="Ajeno")

    response = client.get(f"{WALLETS_URL}/{foreign.wallet_id}", headers=bearer(token))

    assert response.status_code == 404
    assert error_code(response) == "WALLET_NOT_FOUND"


@pytest.mark.parametrize(
    ("method", "url"),
    [("get", WALLETS_URL), ("post", WALLETS_URL), ("get", f"{WALLETS_URL}/{uuid.uuid4()}")],
)
def test_endpoints_require_session(client, wallet_table, method, url) -> None:
    response = client.request(method, url, json={})

    assert response.status_code == 401
    assert error_code(response) == "UNAUTHORIZED"
