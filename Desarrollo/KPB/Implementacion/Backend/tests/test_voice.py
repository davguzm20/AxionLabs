# ruff: noqa: F811
# Las fixtures de pytest importadas de tests.sqlite_db parecen redefinirse.
"""Pruebas del CU03 (KPB-RTV): validación de audio, vista previa y confirmación por voz.

El ORM corre sobre SQLite en memoria (tests/sqlite_db.py), Redis es fakeredis y la
transcripción es simulada. Incluye la regresión de la confirmación del CU04, que
ahora comparte la persistencia con voz.
"""

import importlib.util
import json
import struct
import uuid
from datetime import UTC, date, datetime
from decimal import Decimal
from pathlib import Path

import fakeredis
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.exc import OperationalError

from app.core.errors import AppError
from app.database import get_db
from app.entities import (
    Alert,
    Currency,
    SourceType,
    Transaction,
    TransactionType,
    Wallet,
)
from app.integrations.ai import extractor
from app.integrations.ai.transcription import Transcription
from app.integrations.redis.notifications import get_notification_bus
from app.integrations.redis.previews import (
    RECEIPT_PREFIX,
    VOICE_PREFIX,
    ReceiptPreviewStore,
    get_voice_preview_store,
)
from app.integrations.redis.rate_limit import RateLimiter, get_rate_limiter
from app.main import app
from app.modules.alerts import service as alerts_service
from app.modules.auth.deps import CurrentSession, get_current_session
from app.modules.transactions import service
from app.modules.transactions.audio_validation import (
    MAX_AUDIO_BYTES,
    detect_audio_type,
    validate_audio,
    wav_duration,
)
from app.modules.transactions.schemas import ReceiptConfirmRequest
from tests.sqlite_db import (  # noqa: F401
    TODAY,
    db,
    engine,
    make_budget,
    make_category,
    make_user,
    make_wallet,
)

VOICE_URL = "/api/v1/transactions/voice"
CONFIRM_URL = "/api/v1/transactions/voice/confirm"


def wav(seconds: float, byte_rate: int = 16000) -> bytes:
    """Cabecera WAV mínima que declara la duración pedida."""
    data_size = int(seconds * byte_rate)
    fmt = struct.pack("<HHIIHH", 1, 1, byte_rate // 2, byte_rate, 2, 16)
    return (
        b"RIFF" + struct.pack("<I", 36 + data_size) + b"WAVE"
        + b"fmt " + struct.pack("<I", 16) + fmt
        + b"data" + struct.pack("<I", data_size) + b"\x00" * 64
    )  # fmt: skip


WEBM = b"\x1a\x45\xdf\xa3\x9f\x42\x86\x81\x01\x42\x82\x84webm" + b"\x00" * 64


@pytest.fixture
def scenario(db):
    user = make_user(db)
    wallet = make_wallet(db, user)
    food = make_category(db, "Alimentación")
    others = make_category(db, "Otros")
    db.commit()
    return user, wallet, food, others


@pytest.fixture
def redis_client():
    return fakeredis.FakeRedis(decode_responses=True)


@pytest.fixture
def store(redis_client):
    return ReceiptPreviewStore(redis_client, VOICE_PREFIX)


@pytest.fixture
def heard(monkeypatch):
    """Fija lo que "escucha" el transcriptor simulado."""
    result = {"text": "Gasté 15 soles en el menú", "duration": None}

    def fake_transcribe(audio, mime_type, language="es-PE"):
        return Transcription(text=result["text"], duration_seconds=result["duration"])

    monkeypatch.setattr(service, "transcribe", fake_transcribe)
    return result


@pytest.fixture
def api(db, scenario, store, redis_client, heard):
    user = scenario[0]
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_voice_preview_store] = lambda: store
    app.dependency_overrides[get_rate_limiter] = lambda: RateLimiter(redis_client)
    app.dependency_overrides[get_notification_bus] = lambda: None
    app.dependency_overrides[get_current_session] = lambda: CurrentSession(
        user=user, session_id="sid", last_activity_at=datetime.now(UTC)
    )
    yield TestClient(app)
    app.dependency_overrides.clear()


def upload(api, audio: bytes = WEBM, **form):
    files = {"audio": ("nota.webm", audio, "audio/webm")}
    return api.post(VOICE_URL, files=files, data={"language": "es-PE"} | form)


def confirm_body(preview: dict, category, wallet, **changes) -> dict:
    return {
        "preview_id": preview["preview_id"],
        "type": "EXPENSE",
        "amount": "15.00",
        "currency": "PEN",
        "concept": "menú",
        "transaction_date": TODAY.isoformat(),
        "category_id": str(category.category_id),
        "wallet_id": str(wallet.wallet_id),
    } | changes


def error_code(response) -> str:
    return response.json()["error"]["code"]


@pytest.fixture(autouse=True)
def fixed_today(monkeypatch):
    """La fecha de negocio de los servicios es 2026-10-27, como en sqlite_db."""

    class Today(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime(2026, 10, 27, 12, tzinfo=tz)

    monkeypatch.setattr(service, "datetime", Today)
    monkeypatch.setattr(extractor, "datetime", Today)


# ---------------------------------------------------------------------------
# Validación de audio
# ---------------------------------------------------------------------------
@pytest.mark.parametrize(
    ("data", "expected"),
    [
        (WEBM, "audio/webm"),
        (b"OggS\x00\x02" + b"\x00" * 20, "audio/ogg"),
        (wav(1), "audio/wav"),
        (b"\x00\x00\x00\x20ftypM4A " + b"\x00" * 20, "audio/mp4"),
        (b"ID3\x04\x00" + b"\x00" * 20, "audio/mpeg"),
        (b"\xff\xfb\x90\x00" + b"\x00" * 20, "audio/mpeg"),
        (b"hola, soy un texto", None),
        (b"\x1a\x45\xdf\xa3" + b"matroska" + b"\x00" * 64, None),
        (b"\x89PNG\r\n\x1a\n" + b"\x00" * 20, None),
        (b"", None),
    ],
    ids=["webm", "ogg", "wav", "mp4", "mp3-id3", "mp3-frame", "texto", "mkv", "png", "vacio"],
)
def test_detects_real_audio_type(data, expected) -> None:
    assert detect_audio_type(data) == expected


def test_wav_duration_from_header() -> None:
    assert wav_duration(wav(12.5)) == pytest.approx(12.5)


@pytest.mark.cp("CP-VOZ-06")
def test_wav_longer_than_60_seconds_is_rejected() -> None:
    assert validate_audio(wav(60)).duration_seconds == pytest.approx(60)
    with pytest.raises(AppError) as error:
        validate_audio(wav(61))
    assert error.value.code == "AUDIO_TOO_LONG"


def test_wav_without_data_chunk_is_rejected() -> None:
    with pytest.raises(AppError) as error:
        validate_audio(b"RIFF\x24\x00\x00\x00WAVE")
    assert error.value.code == "UNSUPPORTED_MEDIA_TYPE"


@pytest.mark.parametrize(
    "text",
    ["", "   ", "a", "eh", "Mmm...", "eh, este, mmm"],
)
def test_unintelligible_transcripts(text) -> None:
    with pytest.raises(AppError) as error:
        service.clean_transcript(text)
    assert error.value.code == "AUDIO_UNINTELLIGIBLE"


def test_transcript_is_trimmed_and_capped() -> None:
    assert service.clean_transcript("  gasté   quince\nsoles ") == "gasté quince soles"
    assert len(service.clean_transcript("palabra " * 200)) == 500


# ---------------------------------------------------------------------------
# Vista previa
# ---------------------------------------------------------------------------
@pytest.mark.cp("CP-VOZ-01")
def test_preview_transcribes_without_saving(db, scenario, api, redis_client) -> None:
    _, wallet, food, _ = scenario

    response = upload(api)

    assert response.status_code == 200
    body = response.json()
    assert body["transcript"] == "Gasté 15 soles en el menú"
    assert body["requires_confirmation"] is True
    assert body["wallet_id"] == str(wallet.wallet_id)
    extracted = body["extracted"]
    assert (extracted["type"], extracted["amount"], extracted["currency"]) == (
        "EXPENSE",
        "15.00",
        "PEN",
    )
    assert extracted["transaction_date"] == TODAY.isoformat()
    assert extracted["category"]["name"] == food.name
    assert 0 <= body["confidence"] <= 1
    assert db.execute(select(Transaction)).scalars().all() == []


@pytest.mark.cp("CP-VOZ-08")
def test_preview_stores_only_text(scenario, api, redis_client) -> None:
    preview = upload(api).json()

    raw = redis_client.get(f"preview:{preview['preview_id']}")
    assert 590 <= redis_client.ttl(f"preview:{preview['preview_id']}") <= 600
    stored = json.loads(raw)
    assert set(stored["data"]) == {"transcript", "wallet_id"}
    assert "webm" not in raw
    assert redis_client.keys(f"{RECEIPT_PREFIX}:*") == []


@pytest.mark.cp("CP-VOZ-02")
def test_unintelligible_audio_is_rejected(api, heard, redis_client) -> None:
    heard["text"] = "mmm"

    response = upload(api)

    assert response.status_code == 422
    assert error_code(response) == "AUDIO_UNINTELLIGIBLE"
    assert redis_client.keys("preview:*") == []


@pytest.mark.cp("CP-VOZ-03")
def test_preview_without_amount_asks_for_it(api, heard) -> None:
    heard["text"] = "Compré pan"

    response = upload(api)

    assert response.status_code == 200
    assert response.json()["extracted"]["amount"] is None


def test_duration_reported_by_stt_is_enforced(api, heard) -> None:
    heard["duration"] = 61.0

    response = upload(api)

    assert response.status_code == 422
    assert error_code(response) == "AUDIO_TOO_LONG"


@pytest.mark.cp("CP-VOZ-05")
def test_unsupported_format(api) -> None:
    response = api.post(VOICE_URL, files={"audio": ("nota.txt", b"hola", "text/plain")})

    assert response.status_code == 415
    assert error_code(response) == "UNSUPPORTED_MEDIA_TYPE"


def test_declared_type_is_not_trusted(api) -> None:
    response = api.post(VOICE_URL, files={"audio": ("nota.webm", b"MZ\x90\x00", "audio/webm")})

    assert response.status_code == 415


@pytest.mark.cp("CP-VOZ-07")
def test_audio_larger_than_5_mb(api) -> None:
    response = upload(api, WEBM + b"\x00" * MAX_AUDIO_BYTES)

    assert response.status_code == 413
    assert error_code(response) == "AUDIO_TOO_LARGE"


@pytest.mark.cp("CP-VOZ-06")
def test_endpoint_rejects_long_wav(api) -> None:
    response = api.post(VOICE_URL, files={"audio": ("nota.wav", wav(75), "audio/wav")})

    assert response.status_code == 422
    assert error_code(response) == "AUDIO_TOO_LONG"


def test_preview_requires_a_wallet(db, api) -> None:
    for wallet in db.execute(select(Wallet)).scalars().all():
        db.delete(wallet)
    db.commit()

    response = upload(api)

    assert response.status_code == 409
    assert error_code(response) == "NO_ACTIVE_WALLET"


def test_preview_uses_requested_wallet(db, scenario, api) -> None:
    dollars = make_wallet(db, scenario[0], Currency.USD)
    db.commit()

    body = upload(api, wallet_id=str(dollars.wallet_id)).json()

    assert body["wallet_id"] == str(dollars.wallet_id)


def test_rate_limit_per_user(redis_client) -> None:
    limiter = RateLimiter(redis_client)
    user_id = uuid.uuid4()
    for _ in range(service.VOICE_REQUESTS_PER_MINUTE):
        limiter.hit("voice", user_id, service.VOICE_REQUESTS_PER_MINUTE)

    with pytest.raises(AppError) as error:
        limiter.hit("voice", user_id, service.VOICE_REQUESTS_PER_MINUTE)

    assert error.value.code == "RATE_LIMITED"
    limiter.hit("voice", uuid.uuid4(), service.VOICE_REQUESTS_PER_MINUTE)
    assert 0 < redis_client.ttl(f"ratelimit:voice:{user_id}") <= 60


def test_rate_limit_lets_requests_through_without_redis() -> None:
    server = fakeredis.FakeServer()
    server.connected = False
    limiter = RateLimiter(fakeredis.FakeRedis(server=server))

    limiter.hit("voice", uuid.uuid4(), 0)


# ---------------------------------------------------------------------------
# Confirmación
# ---------------------------------------------------------------------------
@pytest.mark.cp("CP-VOZ-01")
def test_confirm_saves_voice_transaction(db, scenario, api, redis_client) -> None:
    _, wallet, food, _ = scenario
    preview = upload(api).json()

    response = api.post(
        CONFIRM_URL,
        json=confirm_body(preview, food, wallet),
        headers={"Idempotency-Key": "k1"},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["message"] == "Listo, registré S/ 15.00 en Alimentación."
    assert body["wallet_balance"] == "985.00"
    assert body["transaction"]["source"] == "VOICE"
    db.expire_all()
    saved = db.execute(select(Transaction)).scalars().one()
    assert saved.source_type == SourceType.VOZ
    assert saved.source_input == "Gasté 15 soles en el menú"
    assert saved.amount == Decimal("15.00")
    assert db.get(Wallet, wallet.wallet_id).current_balance == Decimal("985.00")
    assert redis_client.keys("preview:*") == []


@pytest.mark.cp("CP-VOZ-11")
def test_confirm_saves_edited_values(db, scenario, api) -> None:
    _, wallet, _, others = scenario
    preview = upload(api).json()

    api.post(
        CONFIRM_URL,
        json=confirm_body(
            preview, others, wallet, amount="18.50", type="INCOME", concept="Reembolso",
            transaction_date="2026-10-26",
        ),
    )  # fmt: skip

    db.expire_all()
    saved = db.execute(select(Transaction)).scalars().one()
    assert (saved.amount, saved.type, saved.concept) == (
        Decimal("18.50"),
        TransactionType.INGRESO,
        "Reembolso",
    )
    assert saved.category_id == others.category_id
    assert db.get(Wallet, wallet.wallet_id).current_balance == Decimal("1018.50")


@pytest.mark.cp("CP-VOZ-13")
def test_retry_does_not_duplicate(db, scenario, api) -> None:
    _, wallet, food, _ = scenario
    preview = upload(api).json()
    body = confirm_body(preview, food, wallet)

    assert api.post(CONFIRM_URL, json=body).status_code == 201
    retry = api.post(CONFIRM_URL, json=body)

    assert retry.status_code == 409
    assert error_code(retry) == "PREVIEW_EXPIRED"
    assert len(db.execute(select(Transaction)).scalars().all()) == 1


def test_concurrent_confirmation_is_rejected(scenario, api, store) -> None:
    _, wallet, food, _ = scenario
    preview = upload(api).json()
    assert store.lock(uuid.UUID(preview["preview_id"]))

    response = api.post(CONFIRM_URL, json=confirm_body(preview, food, wallet))

    assert response.status_code == 409
    assert error_code(response) == "IDEMPOTENCY_IN_PROGRESS"


@pytest.mark.cp("CP-VOZ-10")
def test_expired_or_unknown_preview(scenario, api, redis_client) -> None:
    _, wallet, food, _ = scenario
    preview = upload(api).json()
    redis_client.delete(f"preview:{preview['preview_id']}")

    response = api.post(CONFIRM_URL, json=confirm_body(preview, food, wallet))

    assert response.status_code == 409
    assert error_code(response) == "PREVIEW_EXPIRED"


def test_foreign_preview_cannot_be_confirmed(db, scenario, api, store) -> None:
    _, wallet, food, _ = scenario
    stranger = make_user(db, "otra@example.com")
    db.commit()
    preview_id = uuid.uuid4()
    store.save(preview_id, stranger.user_id, {"transcript": "ajeno", "wallet_id": "x"})

    response = api.post(
        CONFIRM_URL, json=confirm_body({"preview_id": str(preview_id)}, food, wallet)
    )

    assert response.status_code == 409
    assert error_code(response) == "PREVIEW_EXPIRED"
    assert db.execute(select(Transaction)).scalars().all() == []


@pytest.mark.parametrize(
    ("changes", "status", "code"),
    [
        ({"amount": "0"}, 422, "INVALID_AMOUNT"),
        ({"amount": "abc"}, 422, "INVALID_AMOUNT"),
        ({"amount": "1.234"}, 422, "INVALID_AMOUNT_PRECISION"),
        ({"currency": "USD"}, 422, "CURRENCY_MISMATCH"),
        ({"transaction_date": "2026-10-29"}, 422, "INVALID_DATE"),
        ({"category_id": str(uuid.uuid4())}, 422, "INVALID_CATEGORY"),
        ({"wallet_id": str(uuid.uuid4())}, 409, "NO_ACTIVE_WALLET"),
        ({"type": "TRANSFER"}, 422, "VALIDATION_ERROR"),
    ],
)
def test_invalid_confirmation_keeps_preview(
    db, scenario, api, redis_client, changes, status, code
) -> None:
    _, wallet, food, _ = scenario
    preview = upload(api).json()

    response = api.post(CONFIRM_URL, json=confirm_body(preview, food, wallet, **changes))

    assert response.status_code == status
    assert error_code(response) == code
    assert db.execute(select(Transaction)).scalars().all() == []
    # Se puede corregir y volver a confirmar con el mismo preview.
    assert redis_client.get(f"preview:{preview['preview_id']}") is not None
    assert api.post(CONFIRM_URL, json=confirm_body(preview, food, wallet)).status_code == 201


def test_confirmation_evaluates_budget_alerts(db, scenario, api) -> None:
    user, wallet, food, _ = scenario
    make_budget(db, user, food, thresholds=(80,), amount="15.00")
    preview = upload(api).json()

    body = api.post(CONFIRM_URL, json=confirm_body(preview, food, wallet)).json()

    assert [a["percentage"] for a in body["alerts"]] == [80]
    assert len(db.execute(select(Alert)).scalars().all()) == 1


def test_database_failure_rolls_back_and_keeps_preview(
    db, scenario, api, redis_client, monkeypatch
) -> None:
    user, wallet, food, _ = scenario
    make_budget(db, user, food)
    preview = upload(api).json()

    def failing(*_args, **_kwargs):
        raise OperationalError("SELECT", None, Exception("timeout"))

    monkeypatch.setattr(alerts_service, "evaluate_expense", failing)
    response = api.post(CONFIRM_URL, json=confirm_body(preview, food, wallet))

    assert response.status_code == 500
    assert error_code(response) == "INTERNAL_ERROR"
    db.expire_all()
    assert db.execute(select(Transaction)).scalars().all() == []
    assert db.get(Wallet, wallet.wallet_id).current_balance == Decimal("1000.00")
    assert redis_client.get(f"preview:{preview['preview_id']}") is not None
    assert redis_client.get(f"preview:{preview['preview_id']}:lock") is None


# ---------------------------------------------------------------------------
# CU04: la confirmación comparte la persistencia (antes no hacía commit)
# ---------------------------------------------------------------------------
def test_receipt_confirmation_is_committed_and_alerts(db, scenario, redis_client) -> None:
    user, wallet, food, _ = scenario
    make_budget(db, user, food, thresholds=(80,), amount="40.00")
    receipts = ReceiptPreviewStore(redis_client)
    preview_id = uuid.uuid4()
    receipts.save(preview_id, user.user_id, {"ocr_text": "TOTAL S/ 45.90"})

    response = service.confirm_receipt(
        db,
        user,
        ReceiptConfirmRequest(
            preview_id=preview_id,
            amount="45.90",
            currency="PEN",
            concept="Supermercado",
            transaction_date=date(2026, 10, 27).isoformat(),
            category_id=food.category_id,
            wallet_id=wallet.wallet_id,
        ),
        receipts,
    )

    db.rollback()  # Lo que no se confirmó se pierde aquí.
    saved = db.execute(select(Transaction)).scalars().one()
    assert (saved.source_type, saved.source_input) == (SourceType.OCR, "TOTAL S/ 45.90")
    assert [a.percentage for a in response.alerts] == [80]
    assert redis_client.keys(f"{RECEIPT_PREFIX}:*") == []


# ---------------------------------------------------------------------------
# Entregable
# ---------------------------------------------------------------------------
def test_deliverable_file_exposes_the_module() -> None:
    path = Path(__file__).resolve().parents[1] / "app" / "KPB-RTV.py"
    spec = importlib.util.spec_from_file_location("kpb_rtv", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    for name in module.__all__:
        assert hasattr(module, name)
    assert module.confirm_voice is service.confirm_voice
