from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.entities import Transaction
from app.integrations.ai.extractor import ExtractedData
from app.modules.categories.schemas import CategorySuggested, CategorySuggestResponse
from app.modules.transactions import service
from app.modules.transactions.schemas import TextTransactionRequest
from tests.sqlite_db import engine, make_category, make_user, make_wallet


def test_text_preview_extracts_without_persisting_a_transaction(engine, monkeypatch) -> None:
    with Session(engine) as db:
        user = make_user(db)
        wallet = make_wallet(db, user)
        category = make_category(db, "Alimentación")
        category.user_id = user.user_id
        db.commit()
        starting_balance = wallet.current_balance

        monkeypatch.setattr(
            service,
            "extract_transaction_from_text",
            lambda **_: ExtractedData(
                type="EXPENSE",
                amount=Decimal("18.50"),
                currency="PEN",
                concept="almuerzo",
                merchant="Restaurante",
                transaction_date=date(2026, 11, 14),
                confidence=0.92,
            ),
        )
        monkeypatch.setattr(
            service.categories_service,
            "suggest_category",
            lambda *_: CategorySuggestResponse(
                category=CategorySuggested(id=category.category_id, name=category.name, icon="tag"),
                confidence=0.92,
                reason="mock",
                needs_review=False,
            ),
        )

        preview = service.create_text_preview(
            db, user, TextTransactionRequest(text="gasté 18.50 en almuerzo")
        )

        assert db.scalar(select(func.count()).select_from(Transaction)) == 0
        assert db.get(type(wallet), wallet.wallet_id).current_balance == starting_balance

    assert preview.wallet_id == wallet.wallet_id
    assert preview.extracted.amount == "18.50"
    assert preview.extracted.category is not None
    assert preview.extracted.category.id == category.category_id


def test_text_preview_requires_a_positive_amount(engine, monkeypatch) -> None:
    with Session(engine) as db:
        user = make_user(db)
        make_wallet(db, user)
        db.commit()
        monkeypatch.setattr(
            service,
            "extract_transaction_from_text",
            lambda **_: ExtractedData(
                type="EXPENSE",
                amount=None,
                currency="PEN",
                concept="almuerzo",
                merchant=None,
                transaction_date=date(2026, 11, 14),
                confidence=0.1,
            ),
        )
        monkeypatch.setattr(
            service.categories_service,
            "suggest_category",
            lambda *_: pytest.fail("No se debe clasificar un texto sin monto"),
        )

        with pytest.raises(AppError) as error:
            service.create_text_preview(db, user, TextTransactionRequest(text="compré un menú"))

    assert error.value.code == "AMOUNT_NOT_DETECTED"
    assert error.value.details == [{"field": "amount", "message": "El monto es obligatorio."}]


def test_text_preview_replies_to_a_pure_greeting_without_calling_ai(engine, monkeypatch) -> None:
    with Session(engine) as db:
        user = make_user(db)
        db.commit()
        monkeypatch.setattr(
            service,
            "extract_transaction_from_text",
            lambda **_: pytest.fail("Un saludo no debe invocar la IA"),
        )

        with pytest.raises(AppError) as error:
            service.create_text_preview(db, user, TextTransactionRequest(text="¡Buenos días!"))

    assert error.value.code == "GREETING_ONLY"


def test_text_extraction_route_is_registered() -> None:
    from fastapi.testclient import TestClient

    from app.modules.transactions.router import extractions_router
    from app.main import app

    assert any(
        getattr(route, "path", None) == "/extractions/text"
        for route in extractions_router.routes
    )
    # Una solicitud sin sesión debe llegar al guard de autenticación, no a 404.
    response = TestClient(app).post("/api/v1/extractions/text", json={"text": "menú 20"})
    assert response.status_code == 401
