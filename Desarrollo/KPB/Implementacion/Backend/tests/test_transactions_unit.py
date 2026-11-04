"""Pruebas unitarias del CU02 (registro por texto) con dobles de prueba.

La sesion de PostgreSQL es un MagicMock, Redis es fakeredis y el extractor de
IA es el mock del propio backend. Ninguna prueba toca servicios reales.
"""

import uuid
from datetime import datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

import pytest

from app.config import AISettings
from app.core.errors import AppError
from app.core.security import decode_access_token
from app.entities import Currency, SourceType, TransactionStatus, TransactionType
from app.integrations.ai import extractor
from app.integrations.ai.extractor import ExtractedData, extract_transaction_from_text
from app.modules.transactions import repository as transactions_repository
from app.modules.transactions import service
from tests.fakes import (
    EMAIL,
    PASSWORD,
    SECRET,
    build_category,
    build_wallet,
    create_user,
    error_code,
)

TEXT_URL = "/api/v1/transactions/text"
LIMA_TZ = ZoneInfo("America/Lima")


class FixedDateTime(datetime):
    """Reloj fijo en la fecha base de la guia de pruebas."""

    @classmethod
    def now(cls, tz=None):
        return datetime(2026, 10, 27, 12, 0, tzinfo=tz)


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def login(client, email: str = EMAIL, password: str = PASSWORD):
    return client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": password},
    )


def open_session(client, users, email: str = EMAIL) -> str:
    create_user(users, email)
    return login(client, email).json()["access_token"]


def session_key(token: str) -> str:
    _, sid = decode_access_token(token, SECRET)
    return f"session:{sid}"


def add_category(categories, name: str, **changes):
    category = build_category(name, **changes)
    categories[name.lower()] = category
    return category


def add_wallet(
    wallets, user, balance: str = "200.00", currency: Currency = Currency.PEN
):
    wallet = build_wallet(user.user_id, balance=balance, currency=currency)
    wallets.append(wallet)
    return wallet


def post_text(client, token: str, text: str, **body):
    return client.post(TEXT_URL, json={"text": text} | body, headers=bearer(token))


@pytest.mark.cp("CP-TXT-01")
def test_expense_registers_and_updates_balance(
    client, users, wallets, categories, saved_transactions
) -> None:
    user = create_user(users)
    wallet = add_wallet(wallets, user)
    add_category(categories, "Alimentación")
    add_category(categories, "Otros")
    token = login(client).json()["access_token"]

    response = post_text(client, token, "gasté 15 soles en Alimentación")

    assert response.status_code == 201
    body = response.json()
    assert body["transaction"]["type"] == "EXPENSE"
    assert body["transaction"]["amount"] == "15.00"
    assert body["transaction"]["currency"] == "PEN"
    assert body["transaction"]["concept"] == "Alimentación"
    assert body["transaction"]["category"]["name"] == "Alimentación"
    assert body["transaction"]["needs_review"] is False
    assert body["wallet_balance"] == "185.00"
    assert body["alerts"] == []
    assert body["message"] == (
        "Registré S/ 15.00 en Alimentación. Si algo no está bien, puedes corregirlo."
    )
    assert response.headers["cache-control"] == "no-store, no-cache, must-revalidate"
    assert wallet.current_balance == Decimal("185.00")

    transaction = saved_transactions[0]
    assert transaction.type == TransactionType.GASTO
    assert transaction.status == TransactionStatus.CONFIRMADA
    assert transaction.source_type == SourceType.TEXTO
    assert transaction.source_input == "gasté 15 soles en Alimentación"
    assert transaction.amount == Decimal("15.00")


@pytest.mark.cp("CP-TXT-02")
def test_income_increases_balance(
    client, users, wallets, categories, saved_transactions
) -> None:
    user = create_user(users)
    wallet = add_wallet(wallets, user)
    add_category(categories, "Otros")
    token = login(client).json()["access_token"]

    response = post_text(client, token, "me pagaron 1200 de mi sueldo")

    assert response.status_code == 201
    body = response.json()
    assert body["transaction"]["type"] == "INCOME"
    assert body["transaction"]["amount"] == "1200.00"
    assert body["wallet_balance"] == "1400.00"
    assert wallet.current_balance == Decimal("1400.00")
    assert saved_transactions[0].type == TransactionType.INGRESO


@pytest.mark.parametrize(
    ("text", "amount"),
    [
        pytest.param("pasaje de 1.50 en el micro", "1.50", id="micro"),
        pytest.param("una chela de 12 soles", "12.00", id="chela"),
        pytest.param("menú de 10 soles", "10.00", id="menu"),
        pytest.param("chifa 35 soles", "35.00", id="chifa"),
    ],
)
@pytest.mark.cp("CP-TXT-03")
def test_colloquial_amounts(client, users, wallets, categories, text, amount) -> None:
    user = create_user(users)
    add_wallet(wallets, user)
    add_category(categories, "Otros")
    token = login(client).json()["access_token"]

    response = post_text(client, token, text)

    assert response.status_code == 201
    assert response.json()["transaction"]["amount"] == amount


@pytest.mark.parametrize(
    ("text", "amount"),
    [
        pytest.param("S/ 15.00", "15.00", id="simbolo"),
        pytest.param("15 soles", "15.00", id="numero-soles"),
        pytest.param("15,50", "15.50", id="coma-decimal"),
    ],
)
@pytest.mark.cp("CP-TXT-04")
def test_amount_variants(client, users, wallets, categories, text, amount) -> None:
    user = create_user(users)
    add_wallet(wallets, user)
    add_category(categories, "Otros")
    token = login(client).json()["access_token"]

    response = post_text(client, token, text)

    assert response.status_code == 201
    assert response.json()["transaction"]["amount"] == amount


@pytest.mark.xfail(
    strict=True,
    raises=AssertionError,
    reason="DEF-09 el extractor mock no interpreta numeros en palabra ('quince')",
)
@pytest.mark.cp("CP-TXT-04")
def test_word_number_amount(client, users, wallets, categories) -> None:
    user = create_user(users)
    add_wallet(wallets, user)
    add_category(categories, "Otros")
    token = login(client).json()["access_token"]

    response = post_text(client, token, "quince soles")

    assert response.status_code == 201
    assert response.json()["transaction"]["amount"] == "15.00"


@pytest.mark.cp("CP-TXT-05")
def test_relative_date_yesterday(
    client, users, wallets, categories, monkeypatch
) -> None:
    user = create_user(users)
    add_wallet(wallets, user)
    add_category(categories, "Otros")
    token = login(client).json()["access_token"]
    monkeypatch.setattr(extractor, "datetime", FixedDateTime)
    monkeypatch.setattr(service, "datetime", FixedDateTime)

    response = post_text(client, token, "ayer gasté 30 en taxi")

    assert response.status_code == 201
    assert response.json()["transaction"]["transaction_date"] == "2026-10-26"


@pytest.mark.cp("CP-TXT-06")
def test_foreign_currency_is_rejected(
    client, users, wallets, categories, saved_transactions
) -> None:
    user = create_user(users)
    wallet = add_wallet(wallets, user)
    add_category(categories, "Otros")
    token = login(client).json()["access_token"]

    response = post_text(client, token, "gasté 20 dólares en una suscripción")

    assert response.status_code == 422
    assert error_code(response) == "CURRENCY_MISMATCH"
    assert saved_transactions == []
    assert wallet.current_balance == Decimal("200.00")


@pytest.mark.cp("CP-TXT-07")
def test_text_without_amount_is_rejected(
    client, users, wallets, categories, saved_transactions
) -> None:
    user = create_user(users)
    add_wallet(wallets, user)
    add_category(categories, "Otros")
    token = login(client).json()["access_token"]

    response = post_text(client, token, "compré pan")

    assert response.status_code == 422
    assert error_code(response) == "AMOUNT_NOT_FOUND"
    assert "¿Cuánto fue" in response.json()["error"]["message"]
    assert saved_transactions == []


@pytest.mark.cp("CP-TXT-09")
def test_meaningless_text_is_rejected(
    client, users, wallets, categories, saved_transactions
) -> None:
    user = create_user(users)
    add_wallet(wallets, user)
    add_category(categories, "Otros")
    token = login(client).json()["access_token"]

    response = post_text(client, token, "asdfgh")

    assert response.status_code == 422
    assert error_code(response) == "AMOUNT_NOT_FOUND"
    assert "¿Cuánto fue" in response.json()["error"]["message"]
    assert saved_transactions == []


@pytest.mark.parametrize("text", ["", "x" * 501, "   "])
@pytest.mark.cp("CP-TXT-08")
def test_empty_or_too_long_text_is_rejected(
    client, users, wallets, categories, saved_transactions, text
) -> None:
    user = create_user(users)
    add_wallet(wallets, user)
    add_category(categories, "Otros")
    token = login(client).json()["access_token"]

    response = post_text(client, token, text)

    assert response.status_code == 422
    assert error_code(response) == "VALIDATION_ERROR"
    assert saved_transactions == []


@pytest.mark.cp("CP-TXT-10")
def test_zero_amount_is_rejected(
    client, users, wallets, categories, saved_transactions
) -> None:
    user = create_user(users)
    wallet = add_wallet(wallets, user)
    add_category(categories, "Otros")
    token = login(client).json()["access_token"]

    response = post_text(client, token, "gasté 0 soles")

    assert response.status_code == 422
    assert error_code(response) == "AMOUNT_NOT_FOUND"
    assert saved_transactions == []
    assert wallet.current_balance == Decimal("200.00")


@pytest.mark.cp("CP-TXT-11")
def test_user_without_wallet_is_rejected(
    client, users, wallets, saved_transactions
) -> None:
    token = open_session(client, users)

    response = post_text(client, token, "gasté 15 soles en Alimentación")

    assert response.status_code == 409
    assert error_code(response) == "NO_ACTIVE_WALLET"
    assert saved_transactions == []


@pytest.mark.cp("CP-TXT-12")
def test_wallet_from_another_user_is_rejected(
    client, users, wallets, categories, saved_transactions
) -> None:
    owner = create_user(users)
    create_user(users, "otro@example.com")
    add_wallet(wallets, owner)
    add_category(categories, "Otros")
    token = login(client, "otro@example.com").json()["access_token"]

    response = post_text(
        client,
        token,
        "gasté 15 soles en almuerzo",
        wallet_id=str(wallets[0].wallet_id),
    )

    assert response.status_code == 409
    assert error_code(response) == "NO_ACTIVE_WALLET"
    assert saved_transactions == []


@pytest.mark.cp("CP-TXT-12")
def test_nonexistent_wallet_is_rejected(
    client, users, wallets, categories, saved_transactions
) -> None:
    user = create_user(users)
    add_wallet(wallets, user)
    add_category(categories, "Otros")
    token = login(client).json()["access_token"]

    response = post_text(
        client,
        token,
        "gasté 15 soles en almuerzo",
        wallet_id=str(uuid.uuid4()),
    )

    assert response.status_code == 409
    assert error_code(response) == "NO_ACTIVE_WALLET"
    assert saved_transactions == []


@pytest.mark.cp("CP-TXT-13")
def test_extractor_unavailable_returns_503(
    client, users, wallets, categories, saved_transactions, monkeypatch
) -> None:
    """Simula el 503 en el borde del servicio.

    El camino real de OpenAI se probara cuando el paquete este instalado.
    """
    user = create_user(users)
    wallet = add_wallet(wallets, user)
    add_category(categories, "Otros")
    token = login(client).json()["access_token"]

    def unavailable(*args, **kwargs):
        raise AppError(503, "AI_UNAVAILABLE", "El servicio de IA no está disponible.")

    monkeypatch.setattr(service, "extract_transaction_from_text", unavailable)

    response = post_text(client, token, "gasté 15 soles en almuerzo")

    assert response.status_code == 503
    assert saved_transactions == []
    assert wallet.current_balance == Decimal("200.00")


@pytest.mark.cp("CP-TXT-15")
def test_expired_session_is_rejected(client, users, redis_client) -> None:
    token = open_session(client, users)
    redis_client.delete(session_key(token))

    response = post_text(client, token, "gasté 15 soles en Alimentación")

    assert response.status_code == 401
    assert error_code(response) == "SESSION_EXPIRED"


@pytest.mark.cp("CP-NF-01")
def test_missing_token_is_rejected(client) -> None:
    response = client.post(TEXT_URL, json={"text": "gasté 15 soles en almuerzo"})

    assert response.status_code == 401
    assert error_code(response) == "UNAUTHORIZED"


def test_unknown_concept_uses_fallback_and_needs_review(
    client, users, wallets, categories
) -> None:
    user = create_user(users)
    add_wallet(wallets, user)
    add_category(categories, "Otros")
    token = login(client).json()["access_token"]

    response = post_text(client, token, "chifa 35 soles")

    assert response.status_code == 201
    body = response.json()
    assert body["transaction"]["category"]["name"] == "Otros"
    assert body["transaction"]["needs_review"] is True


@pytest.mark.cp("CP-TXT-01")
def test_almuerzo_does_not_match_seed_category(
    client, users, wallets, categories
) -> None:
    """El repositorio real compara nombres exactos, no palabras clave."""
    user = create_user(users)
    add_wallet(wallets, user)
    add_category(categories, "Alimentación")
    add_category(categories, "Otros")
    token = login(client).json()["access_token"]

    response = post_text(client, token, "gasté 15 soles en almuerzo")

    assert response.status_code == 201
    body = response.json()
    assert body["transaction"]["category"]["name"] == "Otros"
    assert body["transaction"]["needs_review"] is True


@pytest.mark.xfail(
    strict=True,
    raises=AssertionError,
    reason="DEF-02 la clasificacion compara nombres exactos y 'almuerzo' cae en Otros",
)
@pytest.mark.cp("CP-TXT-01")
def test_almuerzo_should_be_food_category(client, users, wallets, categories) -> None:
    user = create_user(users)
    add_wallet(wallets, user)
    add_category(categories, "Alimentación")
    add_category(categories, "Otros")
    token = login(client).json()["access_token"]

    response = post_text(client, token, "gasté 15 soles en almuerzo")

    assert response.status_code == 201
    assert response.json()["transaction"]["category"]["name"] == "Alimentación"


@pytest.mark.xfail(
    strict=True,
    raises=AssertionError,
    reason="DEF-03 el signo negativo se pierde y '-5 soles' se registra como 5.00",
)
@pytest.mark.cp("CP-TXT-10")
def test_negative_amount_is_rejected(
    client, users, wallets, categories, saved_transactions
) -> None:
    user = create_user(users)
    add_wallet(wallets, user)
    add_category(categories, "Otros")
    token = login(client).json()["access_token"]

    response = post_text(client, token, "gasté -5 soles")

    assert response.status_code == 422
    assert saved_transactions == []


@pytest.mark.xfail(
    strict=True,
    raises=AssertionError,
    reason="DEF-04 toma el primer numero y '2 panes por 10 soles' registra 2.00",
)
@pytest.mark.cp("CP-TXT-03")
def test_quantity_is_not_the_amount(client, users, wallets, categories) -> None:
    user = create_user(users)
    add_wallet(wallets, user)
    add_category(categories, "Otros")
    token = login(client).json()["access_token"]

    response = post_text(client, token, "compré 2 panes por 10 soles")

    assert response.status_code == 201
    assert response.json()["transaction"]["amount"] == "10.00"


@pytest.mark.xfail(
    strict=True,
    raises=AssertionError,
    reason="DEF-05 el Idempotency-Key se ignora y dos envios crean dos transacciones",
)
@pytest.mark.cp("CP-TXT-14")
def test_same_idempotency_key_creates_one_transaction(
    client, users, wallets, categories, saved_transactions
) -> None:
    user = create_user(users)
    add_wallet(wallets, user)
    add_category(categories, "Alimentación")
    add_category(categories, "Otros")
    token = login(client).json()["access_token"]
    headers = bearer(token) | {"Idempotency-Key": "kpb-cu02-123"}
    body = {"text": "gasté 15 soles en Alimentación"}

    first = client.post(TEXT_URL, json=body, headers=headers)
    second = client.post(TEXT_URL, json=body, headers=headers)

    assert first.status_code == second.status_code == 201
    assert len(saved_transactions) == 1


@pytest.mark.xfail(
    strict=True,
    raises=AssertionError,
    reason="DEF-06 el monedero se bloquea antes de llamar a la IA",
)
def test_ai_is_called_before_locking_wallet(
    client, users, wallets, categories, monkeypatch
) -> None:
    user = create_user(users)
    add_wallet(wallets, user)
    add_category(categories, "Alimentación")
    add_category(categories, "Otros")
    token = login(client).json()["access_token"]
    order: list[str] = []

    real_get_wallet = transactions_repository.get_wallet

    def spy_get_wallet(*args, **kwargs):
        order.append("wallet")
        return real_get_wallet(*args, **kwargs)

    real_extract = service.extract_transaction_from_text

    def spy_extract(*args, **kwargs):
        order.append("ai")
        return real_extract(*args, **kwargs)

    monkeypatch.setattr(transactions_repository, "get_wallet", spy_get_wallet)
    monkeypatch.setattr(service, "extract_transaction_from_text", spy_extract)

    post_text(client, token, "gasté 15 soles en Alimentación")

    assert order[:2] == ["ai", "wallet"]


@pytest.mark.xfail(
    strict=True,
    raises=AssertionError,
    reason="DEF-07 con OPENAI_API_KEY la falta del paquete cae al mock",
)
def test_configured_openai_without_package_does_not_fall_back(monkeypatch) -> None:
    monkeypatch.setattr(
        extractor,
        "get_ai_settings",
        lambda: AISettings(openai_api_key="sk-prueba"),
    )

    try:
        extract_transaction_from_text("gasté 15 soles en almuerzo")
    except AppError as error:
        assert error.status_code == 503
    else:
        assert False, "el extractor uso el mock en vez de fallar"


@pytest.mark.xfail(
    strict=True,
    raises=AssertionError,
    reason="DEF-08 una moneda no soportada se acepta como la moneda del monedero",
)
def test_unsupported_currency_is_rejected(
    client, users, wallets, categories, monkeypatch
) -> None:
    user = create_user(users)
    add_wallet(wallets, user)
    add_category(categories, "Otros")
    token = login(client).json()["access_token"]

    def fake_extract(*args, **kwargs):
        return ExtractedData(
            type="EXPENSE",
            amount=Decimal("15.00"),
            currency="EUR",
            concept="suscripcion",
            merchant=None,
            transaction_date=None,
            confidence=0.90,
        )

    monkeypatch.setattr(service, "extract_transaction_from_text", fake_extract)

    response = post_text(client, token, "gasté 15 euros en una suscripción")

    assert response.status_code == 422
