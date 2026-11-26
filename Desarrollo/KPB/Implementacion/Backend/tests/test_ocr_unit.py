# ruff: noqa: F811
"""Pruebas del CU04 (KPB-RTF): comprobante por foto, OCR y confirmación.

Cubre la validación de la imagen, el extractor simulado de visión, la vista
previa temporal y la persistencia de la transacción con ``source_type = OCR``.
"""

import sys
import uuid
from datetime import UTC, datetime
from decimal import Decimal
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.core.errors import AppError
from app.database import get_db
from app.entities import SourceType, Transaction
from app.integrations.ai import vision
from app.integrations.redis.previews import ReceiptPreviewStore, get_preview_store
from app.main import app
from app.modules.auth.deps import CurrentSession, get_current_session
from app.modules.transactions import service
from app.modules.transactions.image_validation import (
    MAX_FILE_SIZE_BYTES,
    validate_and_prepare_image,
)
from app.modules.transactions.schemas import ReceiptConfirmRequest
from tests.sqlite_db import (  # noqa: F401
    TODAY,
    db,
    engine,
    make_category,
    make_user,
    make_wallet,
)

URL = "/api/v1/transactions/receipt"


# Cabecera JPEG mínima: basta para que la validación por magic bytes la acepte.
JPEG = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00\xff\xd9"


@pytest.fixture
def scenario(db):
    user = make_user(db)
    wallet = make_wallet(db, user)
    category = make_category(db, "Alimentación")
    category.user_id = user.user_id
    db.commit()
    return user, wallet, category


@pytest.fixture
def previews(redis_client):
    return ReceiptPreviewStore(redis_client)


@pytest.fixture
def api(db, scenario, previews):
    user = scenario[0]
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_preview_store] = lambda: previews
    app.dependency_overrides[get_current_session] = lambda: CurrentSession(
        user=user, session_id="sid", last_activity_at=datetime.now(UTC)
    )
    yield TestClient(app)
    app.dependency_overrides.clear()


def test_validate_rejects_pdf() -> None:
    with pytest.raises(AppError) as exc:
        validate_and_prepare_image(b"%PDF-1.7 boleta", "boleta.pdf", "application/pdf")

    assert (exc.value.status_code, exc.value.code) == (415, "UNSUPPORTED_MEDIA_TYPE")


def test_validate_rejects_oversized_image() -> None:
    with pytest.raises(AppError) as exc:
        validate_and_prepare_image(
            b"x" * (MAX_FILE_SIZE_BYTES + 1), "boleta.jpg", "image/jpeg"
        )

    assert (exc.value.status_code, exc.value.code) == (413, "FILE_TOO_LARGE")


def test_validate_accepts_jpeg_by_magic_bytes() -> None:
    result = validate_and_prepare_image(JPEG, "boleta.jpg", "image/jpeg")

    assert result.mime_type == "image/jpeg"
    assert result.data


@pytest.mark.parametrize("api_key", [None, "mock"])
def test_receipt_endpoint_requires_valid_openai_configuration(
    api, monkeypatch, api_key
) -> None:
    monkeypatch.setattr(
        vision,
        "get_ai_settings",
        lambda: type(
            "Settings",
            (),
            {
                "openai_api_key": api_key,
                "openai_vision_model": "gpt-4o-mini",
                "openai_vision_timeout_seconds": 30.0,
            },
        )(),
    )

    response = api.post(URL, files={"image": ("boleta.jpg", JPEG, "image/jpeg")})

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "OCR_UNAVAILABLE"


def test_vision_rejects_an_unreadable_receipt(monkeypatch) -> None:
    class FakeOpenAI:
        def __init__(self, **_: object) -> None:
            self.chat = SimpleNamespace(
                completions=SimpleNamespace(
                    create=lambda **__: SimpleNamespace(
                        choices=[SimpleNamespace(message=SimpleNamespace(content="{}"))]
                    )
                )
            )

    monkeypatch.setitem(
        sys.modules, "openai", SimpleNamespace(OpenAI=FakeOpenAI)
    )

    with pytest.raises(AppError) as exc:
        vision._extract_with_openai_vision(
            image_bytes=b"foto",
            mime_type="image/jpeg",
            api_key="sk-test",
            model="gpt-4o-mini",
            today_str=TODAY.isoformat(),
            default_currency="PEN",
        )

    assert (exc.value.status_code, exc.value.code) == (422, "IMAGE_UNREADABLE")


def test_receipt_preview_uses_openai_vision_result(api, monkeypatch) -> None:
    class FakeOpenAI:
        def __init__(self, **_: object) -> None:
            self.chat = SimpleNamespace(
                completions=SimpleNamespace(
                    create=lambda **__: SimpleNamespace(
                        choices=[
                            SimpleNamespace(
                                message=SimpleNamespace(
                                    content=(
                                        '{"amount":" S/ 5.00 ","currency":"PEN",'
                                        '"merchant":"Yape","ruc":null,'
                                        '"transaction_date":"2026-11-26",'
                                        '"concept":"Pago por Yape",'
                                        '"ocr_text":"PAGO YAPE TOTAL S/ 5.00",'
                                        '"confidence":"not-a-number"}'
                                    )
                                )
                            )
                        ]
                    )
                )
            )

    monkeypatch.setitem(sys.modules, "openai", SimpleNamespace(OpenAI=FakeOpenAI))
    monkeypatch.setattr(
        vision,
        "get_ai_settings",
        lambda: type(
            "Settings",
            (),
            {
                "openai_api_key": "sk-test",
                "openai_vision_model": "gpt-4o-mini",
                "openai_vision_timeout_seconds": 30.0,
            },
        )(),
    )

    response = api.post(URL, files={"image": ("boleta.jpg", JPEG, "image/jpeg")})

    assert response.status_code == 200
    body = response.json()
    assert Decimal(body["extracted"]["amount"]) == Decimal("5.00")
    assert body["extracted"]["merchant"] == "Yape"
    assert body["extracted"]["merchant"] != "Supermercado Metro"
    assert body["confidence"] == 0.85
    assert body["requires_confirmation"] is True
    assert uuid.UUID(body["preview_id"])


def test_receipt_preview_returns_503_for_truncated_openai_json(api, monkeypatch) -> None:
    class FakeOpenAI:
        def __init__(self, **_: object) -> None:
            self.chat = SimpleNamespace(
                completions=SimpleNamespace(
                    create=lambda **__: SimpleNamespace(
                        choices=[
                            SimpleNamespace(
                                message=SimpleNamespace(content='{"amount":"5.00"')
                            )
                        ]
                    )
                )
            )

    monkeypatch.setitem(sys.modules, "openai", SimpleNamespace(OpenAI=FakeOpenAI))
    monkeypatch.setattr(
        vision,
        "get_ai_settings",
        lambda: type(
            "Settings",
            (),
            {
                "openai_api_key": "sk-test",
                "openai_vision_model": "gpt-4o-mini",
                "openai_vision_timeout_seconds": 30.0,
            },
        )(),
    )

    response = api.post(URL, files={"image": ("boleta.jpg", JPEG, "image/jpeg")})

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "OCR_UNAVAILABLE"


def test_receipt_preview_rejects_non_image(api) -> None:
    response = api.post(
        URL, files={"image": ("nota.txt", b"hola", "text/plain")}
    )

    assert response.status_code == 415
    assert response.json()["error"]["code"] == "UNSUPPORTED_MEDIA_TYPE"


def test_receipt_confirm_persists_ocr_transaction(db, scenario, previews) -> None:
    user, wallet, category = scenario
    preview_id = uuid.uuid4()
    previews.save(
        preview_id,
        user.user_id,
        {"ocr_text": "TOTAL S/ 45.90", "merchant": "Supermercado Metro"},
    )

    service.confirm_receipt(
        db,
        user,
        ReceiptConfirmRequest(
            preview_id=preview_id,
            amount="45.90",
            currency="PEN",
            concept="Supermercado",
            transaction_date=TODAY.isoformat(),
            category_id=category.category_id,
            wallet_id=wallet.wallet_id,
        ),
        previews,
    )

    db.rollback()
    saved = db.execute(select(Transaction)).scalars().one()
    assert saved.source_type == SourceType.OCR
    assert saved.source_input == "TOTAL S/ 45.90"
    assert wallet.current_balance == Decimal("1000.00") - Decimal("45.90")
    assert previews.get(preview_id, user.user_id) is None


def test_receipt_confirm_rejects_used_preview(db, scenario, previews) -> None:
    user, wallet, category = scenario
    preview_id = uuid.uuid4()
    previews.save(preview_id, user.user_id, {"ocr_text": "TOTAL S/ 10.00"})
    body = ReceiptConfirmRequest(
        preview_id=preview_id,
        amount="10.00",
        currency="PEN",
        concept="Menú",
        transaction_date=TODAY.isoformat(),
        category_id=category.category_id,
        wallet_id=wallet.wallet_id,
    )
    service.confirm_receipt(db, user, body, previews)

    with pytest.raises(AppError) as exc:
        service.confirm_receipt(db, user, body, previews)

    assert (exc.value.status_code, exc.value.code) == (409, "PREVIEW_EXPIRED")
