# ruff: noqa: F811
# Las fixtures de pytest importadas de tests.sqlite_db parecen redefinirse.
"""Pruebas del CU08 (KPB-MA): evaluacion de umbrales, bandeja, umbrales y SSE.

Los flujos corren con el ORM real sobre SQLite en memoria, para ejercer consultas,
restricciones y rollback sin servicios externos. Lo propio de PostgreSQL (bloqueos,
zona horaria en la columna) se comprueba sobre el SQL compilado o queda para las
pruebas contra la base real.
"""

import asyncio
import importlib.util
import json
import uuid
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from unittest.mock import MagicMock

import fakeredis
import fakeredis.aioredis
import pytest
from sqlalchemy import select
from sqlalchemy.dialects import postgresql
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.database import get_db
from app.entities import (
    Alert,
    AlertPriority,
    AlertType,
    Budget,
    BudgetStatus,
    BudgetThreshold,
    Category,
    Currency,
    Notification,
    NotificationStatus,
    PeriodType,
    SourceType,
    Transaction,
    TransactionStatus,
    TransactionType,
    Wallet,
)
from app.integrations.ai.extractor import ExtractedData
from app.integrations.redis.notifications import (
    NotificationBus,
    get_notification_bus,
    user_channel,
)
from app.main import app
from app.modules.alerts import service as alerts_service
from app.modules.alerts.service import build_body, build_title, evaluate_expense
from app.modules.auth.deps import CurrentSession, get_current_session
from app.modules.budgets import repository as budgets_repository
from app.modules.budgets.periods import current_period
from app.modules.notifications import sse
from app.modules.transactions import service as transactions_service
from app.modules.transactions.schemas import TextTransactionRequest
from tests.sqlite_db import (  # noqa: F401
    LIMA,
    TODAY,
    db,
    engine,
    make_budget,
    make_category,
    make_user,
    make_wallet,
)


def spend(
    db: Session,
    wallet: Wallet,
    category: Category,
    amount: str,
    on: date = TODAY,
    kind: TransactionType = TransactionType.GASTO,
) -> list:
    """Registra un gasto y lo evalua, como hace el servicio de transacciones."""
    transaction = Transaction(
        user_id=wallet.user_id,
        wallet_id=wallet.wallet_id,
        category_id=category.category_id,
        amount=Decimal(amount),
        type=kind,
        currency=wallet.currency,
        concept="gasto",
        transacted_at=datetime(on.year, on.month, on.day, 12, tzinfo=LIMA),
        status=TransactionStatus.CONFIRMADA,
        source_type=SourceType.TEXTO,
    )
    db.add(transaction)
    db.flush()
    emitted = evaluate_expense(db, transaction, today=TODAY)
    db.commit()
    return emitted


@pytest.fixture
def scenario(db):
    user = make_user(db)
    return user, make_wallet(db, user), make_category(db)


# ---------------------------------------------------------------------------
# Periodos (03-domain/calculations.md)
# ---------------------------------------------------------------------------
@pytest.mark.parametrize(
    ("period_type", "days", "start_date", "today", "expected"),
    [
        (PeriodType.SEMANAL, 7, TODAY, TODAY, (date(2026, 10, 26), date(2026, 11, 1))),
        (PeriodType.MENSUAL, 30, TODAY, TODAY, (date(2026, 10, 1), date(2026, 10, 31))),
        (PeriodType.MENSUAL, 30, TODAY, date(2028, 2, 10), (date(2028, 2, 1), date(2028, 2, 29))),
        (
            PeriodType.PERSONALIZADO,
            10,
            date(2026, 10, 1),
            TODAY,
            (date(2026, 10, 21), date(2026, 10, 30)),
        ),
        (
            PeriodType.PERSONALIZADO,
            10,
            date(2026, 12, 1),
            TODAY,
            (date(2026, 12, 1), date(2026, 12, 10)),
        ),
    ],
)
def test_current_period(period_type, days, start_date, today, expected) -> None:
    budget = Budget(period_type=period_type, period_days=days, start_date=start_date)
    assert current_period(budget, today) == expected


# ---------------------------------------------------------------------------
# Mensajes (03-domain/notifications.md)
# ---------------------------------------------------------------------------
@pytest.mark.parametrize(
    ("percentage", "remaining", "expected"),
    [
        (80, "60.00", "Cruzaste el 80% de tu presupuesto de Alimentación."),
        (100, "0.00", "Alcanzaste el 100% de tu presupuesto de Alimentación."),
        (100, "-25.00", "Cruzaste el 100% de tu presupuesto de Alimentación."),
    ],
)
def test_title(percentage, remaining, expected) -> None:
    assert build_title("Alimentación", percentage, Decimal(remaining)) == expected


@pytest.mark.parametrize(
    ("percentage", "consumed", "expected"),
    [
        (80, "240.00", "Gastado: S/ 240.00 de S/ 300.00. Te quedan S/ 60.00."),
        (100, "300.00", "Límite: S/ 300.00. Gastado: S/ 300.00 de S/ 300.00."),
        (
            80,
            "325.00",
            ("Superaste tu presupuesto de Alimentación en S/ 25.00. "
            "Gastado: S/ 325.00 de S/ 300.00."),
        ),
    ],
)
def test_body(percentage, consumed, expected) -> None:
    limit = Decimal("300.00")
    spent = Decimal(consumed)
    assert build_body("Alimentación", percentage, spent, limit, limit - spent, "S/") == expected


def test_long_category_fits_title_column() -> None:
    title = build_title("x" * 100, 100, Decimal(0))
    assert len(title) == 120
    assert title.endswith("….")


# ---------------------------------------------------------------------------
# Evaluacion de umbrales
# ---------------------------------------------------------------------------
@pytest.mark.cp("CP-ALE-01")
def test_crossing_80_emits_alert_and_unread_notification(db, scenario) -> None:
    user, wallet, category = scenario
    budget = make_budget(db, user, category)

    alerts = spend(db, wallet, category, "240.00")

    assert [a.percentage for a in alerts] == [80]
    assert alerts[0].priority == "NORMAL"
    assert (alerts[0].consumed, alerts[0].limit, alerts[0].remaining) == (
        "240.00",
        "300.00",
        "60.00",
    )
    stored = db.execute(select(Alert)).scalars().one()
    assert stored.budget_id == budget.budget_id
    assert stored.period_start == date(2026, 10, 1)
    assert stored.alert_type == AlertType.UMBRAL
    notification = db.execute(select(Notification)).scalars().one()
    assert notification.alert_id == stored.alert_id
    assert notification.status == NotificationStatus.UNREAD
    assert notification.title == "Cruzaste el 80% de tu presupuesto de Alimentación."


@pytest.mark.cp("CP-ALE-11")
def test_below_threshold_does_not_alert_but_exact_does(db, scenario) -> None:
    user, wallet, category = scenario
    make_budget(db, user, category)

    assert spend(db, wallet, category, "239.99") == []
    assert [a.percentage for a in spend(db, wallet, category, "0.01")] == [80]


@pytest.mark.cp("CP-ALE-02")
def test_crossing_100_is_high_priority(db, scenario) -> None:
    user, wallet, category = scenario
    make_budget(db, user, category, thresholds=(100,))

    alert = spend(db, wallet, category, "300.00")[0]

    assert alert.priority == "HIGH"
    assert alert.title.startswith("Alcanzaste el 100%")
    assert db.execute(select(Alert)).scalars().one().priority == AlertPriority.HIGH


@pytest.mark.cp("CP-ALE-03")
def test_one_expense_emits_every_crossed_threshold(db, scenario) -> None:
    user, wallet, category = scenario
    make_budget(db, user, category)

    alerts = spend(db, wallet, category, "300.00")

    assert sorted(a.percentage for a in alerts) == [80, 100]
    assert len(db.execute(select(Notification)).scalars().all()) == 2


@pytest.mark.cp("CP-ALE-12")
def test_overspending_reports_negative_remaining(db, scenario) -> None:
    user, wallet, category = scenario
    make_budget(db, user, category, thresholds=(100,))

    alert = spend(db, wallet, category, "325.00")[0]

    assert alert.remaining == "-25.00"
    assert alert.body.startswith("Superaste tu presupuesto de Alimentación en S/ 25.00.")
    assert db.execute(select(Alert)).scalars().one().alert_type == AlertType.SOBREGIRO


def test_huge_overspending_does_not_overflow_detected_percentage(db, scenario) -> None:
    """Una alerta nunca debe revertir el gasto por desbordar NUMERIC(6,2)."""
    user, wallet, category = scenario
    make_budget(db, user, category, thresholds=(100,), amount="1.00")

    spend(db, wallet, category, "99999.00")

    assert db.execute(select(Alert)).scalars().one().detected_percentage == Decimal("9999.99")


@pytest.mark.cp("CP-ALE-04")
def test_same_period_does_not_duplicate(db, scenario) -> None:
    user, wallet, category = scenario
    make_budget(db, user, category)

    assert len(spend(db, wallet, category, "240.00")) == 1
    assert spend(db, wallet, category, "10.00") == []
    assert [a.percentage for a in spend(db, wallet, category, "50.00")] == [100]
    assert len(db.execute(select(Alert)).scalars().all()) == 2


@pytest.mark.cp("CP-ALE-05")
def test_inactive_budget_does_not_alert(db, scenario) -> None:
    user, wallet, category = scenario
    make_budget(db, user, category, status=BudgetStatus.INACTIVO)

    assert spend(db, wallet, category, "300.00") == []


@pytest.mark.cp("CP-ALE-10")
def test_without_budget_no_alert(db, scenario) -> None:
    _, wallet, category = scenario

    assert spend(db, wallet, category, "300.00") == []


def test_income_does_not_alert(db, scenario) -> None:
    user, wallet, category = scenario
    make_budget(db, user, category)

    assert spend(db, wallet, category, "300.00", kind=TransactionType.INGRESO) == []


@pytest.mark.cp("CP-ALE-13")
def test_other_currency_does_not_alert_or_count(db, scenario) -> None:
    user, wallet, category = scenario
    make_budget(db, user, category)
    dollars = make_wallet(db, user, Currency.USD)

    assert spend(db, dollars, category, "300.00") == []
    assert spend(db, wallet, category, "100.00") == []


def test_other_category_and_user_do_not_count(db, scenario) -> None:
    user, wallet, category = scenario
    make_budget(db, user, category)
    other_category = make_category(db, "Transporte")
    other_user = make_user(db, "otra@example.com")
    other_wallet = make_wallet(db, other_user)

    spend(db, wallet, other_category, "300.00")
    spend(db, other_wallet, category, "300.00")

    assert spend(db, wallet, category, "100.00") == []


@pytest.mark.cp("CP-ALE-19")
def test_editing_budget_does_not_reset_issued_alerts(db, scenario) -> None:
    user, wallet, category = scenario
    budget = make_budget(db, user, category, thresholds=(80,))
    spend(db, wallet, category, "240.00")

    budget.amount = Decimal("250.00")
    db.commit()

    assert spend(db, wallet, category, "1.00") == []


@pytest.mark.cp("CP-ALE-20")
def test_new_period_allows_new_alert(db, scenario) -> None:
    user, wallet, category = scenario
    budget = make_budget(db, user, category, thresholds=(80,))
    spend(db, wallet, category, "240.00")

    start, _end = current_period(budget, date(2026, 11, 3))
    transaction = Transaction(
        user_id=user.user_id,
        wallet_id=wallet.wallet_id,
        category_id=category.category_id,
        amount=Decimal("240.00"),
        type=TransactionType.GASTO,
        currency=Currency.PEN,
        transacted_at=datetime(2026, 11, 3, 12, tzinfo=LIMA),
        status=TransactionStatus.CONFIRMADA,
        source_type=SourceType.TEXTO,
    )
    db.add(transaction)
    db.flush()

    alerts = evaluate_expense(db, transaction, today=date(2026, 11, 3))

    assert start == date(2026, 11, 1)
    assert [a.consumed for a in alerts] == ["240.00"]


@pytest.mark.cp("CP-ALE-21")
def test_closed_period_expense_is_not_retroactive(db, scenario) -> None:
    user, wallet, category = scenario
    make_budget(db, user, category)

    assert spend(db, wallet, category, "300.00", on=date(2026, 9, 30)) == []
    assert spend(db, wallet, category, "100.00") == []


def test_budget_without_thresholds_uses_default_80(db, scenario) -> None:
    user, wallet, category = scenario
    make_budget(db, user, category, thresholds=())

    assert [a.percentage for a in spend(db, wallet, category, "240.00")] == [80]


@pytest.mark.cp("CP-ALE-18")
def test_five_thresholds(db, scenario) -> None:
    user, wallet, category = scenario
    make_budget(db, user, category, thresholds=(50, 60, 70, 80, 90))

    assert len(spend(db, wallet, category, "300.00")) == 5


def test_budgets_are_locked_and_filtered_by_owner() -> None:
    """El bloqueo serializa gastos simultaneos: el segundo ve el consumo del primero."""
    session = MagicMock()
    budgets_repository.active_budgets_for_expense(session, uuid.uuid4(), uuid.uuid4(), Currency.PEN)

    statement = session.execute.call_args.args[0]
    sql = str(statement.compile(dialect=postgresql.dialect()))
    assert "FOR UPDATE" in sql
    assert "budgets.user_id =" in sql


def test_consumption_uses_lima_day_boundaries() -> None:
    session = MagicMock()
    session.execute.return_value.scalar_one.return_value = 0
    budget = Budget(user_id=uuid.uuid4(), category_id=uuid.uuid4(), currency=Currency.PEN)

    budgets_repository.consumed_in_period(
        session, budget, date(2026, 10, 1), date(2026, 10, 31)
    )

    params = session.execute.call_args.args[0].compile(dialect=postgresql.dialect()).params
    bounds = sorted(v for v in params.values() if isinstance(v, datetime))
    assert bounds[0].astimezone(UTC) == datetime(2026, 10, 1, 5, tzinfo=UTC)
    assert bounds[1].astimezone(UTC) == datetime(2026, 11, 1, 5, tzinfo=UTC)


# ---------------------------------------------------------------------------
# Integracion con el registro por texto (CU02)
# ---------------------------------------------------------------------------
@pytest.fixture
def registered(db, scenario, monkeypatch):
    """Registro por texto con la IA simulada y la fecha fija."""
    user, wallet, category = scenario

    def extract(**_kwargs) -> ExtractedData:
        return ExtractedData(
            amount=Decimal("240.00"),
            currency="PEN",
            concept=category.name,
            merchant=None,
            transaction_date=TODAY,
            type="EXPENSE",
            confidence=0.95,
        )

    monkeypatch.setattr(transactions_service, "extract_transaction_from_text", extract)
    db.commit()
    return user, wallet, category


def test_expense_response_includes_alerts_and_publishes_after_commit(db, registered) -> None:
    user, _wallet, category = registered
    make_budget(db, user, category)
    redis_client = fakeredis.FakeRedis(decode_responses=True)
    pubsub = redis_client.pubsub()
    pubsub.subscribe(user_channel(user.user_id))
    pubsub.get_message()

    response = transactions_service.create_from_text(
        db, user, TextTransactionRequest(text="gasté 240"), bus=NotificationBus(redis_client)
    )

    assert [a.percentage for a in response.alerts] == [80]
    assert response.wallet_balance == "760.00"
    published = json.loads(pubsub.get_message()["data"])
    assert published["event"] == "alert.created"
    assert published["id"] == str(response.alerts[0].id)
    assert published["data"]["percentage"] == 80
    assert "title" not in published["data"]


def test_evaluation_failure_rolls_back_the_expense(db, registered, monkeypatch) -> None:
    user, wallet, category = registered
    make_budget(db, user, category)
    bus = MagicMock(spec=NotificationBus)

    def failing(*_args, **_kwargs):
        raise OperationalError("SELECT", None, Exception("timeout"))

    monkeypatch.setattr(alerts_service.repository, "issued_threshold_ids", failing)

    with pytest.raises(AppError) as error:
        transactions_service.create_from_text(
            db, user, TextTransactionRequest(text="gasté 240"), bus=bus
        )

    assert error.value.code == "INTERNAL_ERROR"
    db.expire_all()
    assert db.execute(select(Transaction)).scalars().all() == []
    assert db.get(Wallet, wallet.wallet_id).current_balance == Decimal("1000.00")
    bus.publish.assert_not_called()


def test_redis_failure_keeps_expense_and_notification(db, registered) -> None:
    user, _wallet, category = registered
    make_budget(db, user, category)
    server = fakeredis.FakeServer()
    server.connected = False
    down = fakeredis.FakeRedis(server=server, decode_responses=True)

    response = transactions_service.create_from_text(
        db, user, TextTransactionRequest(text="gasté 240"), bus=NotificationBus(down)
    )

    assert len(response.alerts) == 1
    assert len(db.execute(select(Notification)).scalars().all()) == 1


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@pytest.fixture
def api(db, scenario):
    """Cliente autenticado como el usuario del escenario, con eventos capturados."""
    from fastapi.testclient import TestClient

    user = scenario[0]
    bus = MagicMock(spec=NotificationBus)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_notification_bus] = lambda: bus
    app.dependency_overrides[get_current_session] = lambda: CurrentSession(
        user=user, session_id="sid", last_activity_at=datetime.now(UTC)
    )
    client = TestClient(app)
    client.bus = bus
    yield client
    app.dependency_overrides.clear()


def thresholds_url(budget: Budget | uuid.UUID) -> str:
    budget_id = budget.budget_id if isinstance(budget, Budget) else budget
    return f"/api/v1/budgets/{budget_id}/thresholds"


def test_list_thresholds_reports_triggered(db, scenario, api) -> None:
    user, wallet, category = scenario
    budget = make_budget(db, user, category)
    spend(db, wallet, category, "240.00")

    response = api.get(thresholds_url(budget))

    assert response.status_code == 200
    assert [(t["percentage"], t["triggered"]) for t in response.json()["data"]] == [
        (80, True),
        (100, False),
    ]


def test_add_threshold(db, scenario, api) -> None:
    user, _, category = scenario
    budget = make_budget(db, user, category, thresholds=(80,))

    response = api.post(thresholds_url(budget), json={"percentage": 90})

    assert response.status_code == 201
    assert response.json()["percentage"] == 90
    assert response.json()["triggered"] is False


@pytest.mark.cp("CP-ALE-09")
@pytest.mark.parametrize("percentage", [0, 101, -5])
def test_invalid_threshold_is_rejected(db, scenario, api, percentage) -> None:
    user, _, category = scenario
    budget = make_budget(db, user, category)

    response = api.post(thresholds_url(budget), json={"percentage": percentage})

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "INVALID_THRESHOLD"
    assert response.json()["error"]["message"] == "Ingresa un porcentaje entre 1% y 100%."


def test_non_integer_threshold_is_rejected(db, scenario, api) -> None:
    user, _, category = scenario
    budget = make_budget(db, user, category)

    assert api.post(thresholds_url(budget), json={"percentage": 80.5}).status_code == 422
    assert api.post(thresholds_url(budget), json={"percentage": "80"}).status_code == 422


@pytest.mark.cp("CP-PRE-24")
def test_duplicate_active_threshold_conflicts(db, scenario, api) -> None:
    user, _, category = scenario
    budget = make_budget(db, user, category, thresholds=(80,))

    response = api.post(thresholds_url(budget), json={"percentage": 80})

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "THRESHOLD_EXISTS"


def test_replace_thresholds(db, scenario, api) -> None:
    user, _, category = scenario
    budget = make_budget(db, user, category, thresholds=(80, 100))

    response = api.put(thresholds_url(budget), json={"thresholds": [75, 100]})

    assert response.status_code == 200
    assert [t["percentage"] for t in response.json()["data"]] == [75, 100]
    stored = db.execute(select(BudgetThreshold)).scalars().all()
    assert {t.percentage: t.is_active for t in stored} == {75: True, 80: False, 100: True}


@pytest.mark.parametrize(
    ("thresholds", "status", "code"),
    [
        ([], 422, "INVALID_THRESHOLD"),
        ([0, 80], 422, "INVALID_THRESHOLD"),
        ([80, 80], 409, "THRESHOLD_EXISTS"),
    ],
)
def test_replace_rejects_invalid_lists(db, scenario, api, thresholds, status, code) -> None:
    user, _, category = scenario
    budget = make_budget(db, user, category)

    response = api.put(thresholds_url(budget), json={"thresholds": thresholds})

    assert response.status_code == status
    assert response.json()["error"]["code"] == code


def test_removing_and_restoring_threshold_does_not_repeat_alert(db, scenario, api) -> None:
    """Editar umbrales no reinicia las alertas del periodo (03-domain/notifications.md)."""
    user, wallet, category = scenario
    budget = make_budget(db, user, category, thresholds=(80, 100))
    spend(db, wallet, category, "240.00")

    api.put(thresholds_url(budget), json={"thresholds": [100]})
    api.post(thresholds_url(budget), json={"percentage": 80})

    assert spend(db, wallet, category, "1.00") == []
    assert len(db.execute(select(BudgetThreshold)).scalars().all()) == 2


def test_delete_threshold_deactivates_and_keeps_history(db, scenario, api) -> None:
    user, wallet, category = scenario
    budget = make_budget(db, user, category, thresholds=(80, 100))
    spend(db, wallet, category, "240.00")
    target = api.get(thresholds_url(budget)).json()["data"][0]

    response = api.delete(f"{thresholds_url(budget)}/{target['id']}")

    assert response.status_code == 204
    assert [t["percentage"] for t in api.get(thresholds_url(budget)).json()["data"]] == [100]
    assert len(db.execute(select(Alert)).scalars().all()) == 1


def test_last_threshold_cannot_be_deleted(db, scenario, api) -> None:
    user, _, category = scenario
    budget = make_budget(db, user, category, thresholds=(80,))
    target = api.get(thresholds_url(budget)).json()["data"][0]

    response = api.delete(f"{thresholds_url(budget)}/{target['id']}")

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "INVALID_THRESHOLD"


def test_other_users_budget_is_not_found(db, api) -> None:
    owner = make_user(db, "duena@example.com")
    budget = make_budget(db, owner, make_category(db, "Ajena"))

    assert api.get(thresholds_url(budget)).status_code == 404
    assert api.post(thresholds_url(budget), json={"percentage": 90}).status_code == 404
    assert api.put(thresholds_url(budget), json={"thresholds": [90]}).status_code == 404
    assert api.delete(f"{thresholds_url(budget)}/{uuid.uuid4()}").status_code == 404
    assert api.get(thresholds_url(uuid.uuid4())).status_code == 404


def add_notification(db, user, title="Aviso", minutes_ago=0, status=NotificationStatus.UNREAD):
    notification = Notification(
        user_id=user.user_id,
        title=title,
        body="Cuerpo",
        status=status,
        created_at=datetime(2026, 10, 27, 15, tzinfo=UTC) - timedelta(minutes=minutes_ago),
    )
    db.add(notification)
    db.commit()
    return notification


def test_notifications_list_unread_first_then_recent(db, scenario, api) -> None:
    user = scenario[0]
    add_notification(db, user, "leida reciente", 0, NotificationStatus.READ)
    add_notification(db, user, "no leida antigua", 30)
    add_notification(db, user, "no leida reciente", 10)

    body = api.get("/api/v1/notifications").json()

    assert [n["title"] for n in body["data"]] == [
        "no leida reciente",
        "no leida antigua",
        "leida reciente",
    ]
    assert body["meta"] == {"page": 1, "page_size": 20, "total": 3, "pages": 1}


def test_notifications_filter_and_pagination(db, scenario, api) -> None:
    user = scenario[0]
    for minutes in range(3):
        add_notification(db, user, f"n{minutes}", minutes)
    add_notification(db, user, "leida", status=NotificationStatus.READ)

    body = api.get("/api/v1/notifications?status=UNREAD&page=2&page_size=2").json()

    assert [n["title"] for n in body["data"]] == ["n2"]
    assert body["meta"] == {"page": 2, "page_size": 2, "total": 3, "pages": 2}


@pytest.mark.parametrize("query", ["status=OTRO", "page=0", "page_size=101"])
def test_notifications_invalid_query(api, query) -> None:
    response = api.get(f"/api/v1/notifications?{query}")

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


@pytest.mark.cp("CP-ALE-15")
def test_mark_read_updates_and_notifies_other_tabs(db, scenario, api) -> None:
    user = scenario[0]
    notification = add_notification(db, user)
    url = f"/api/v1/notifications/{notification.notification_id}/read"

    response = api.patch(url)

    assert response.status_code == 200
    assert response.json()["status"] == "READ"
    assert response.json()["read_at"] is not None
    assert response.json()["created_at"] == "2026-10-27T15:00:00Z"
    api.bus.publish.assert_called_once()
    assert api.bus.publish.call_args.args[1] == "notification.read"

    assert api.patch(url).status_code == 200
    api.bus.publish.assert_called_once()


@pytest.mark.cp("CP-ALE-16")
def test_mark_all_read_only_touches_own_notifications(db, scenario, api) -> None:
    user = scenario[0]
    other = make_user(db, "otra@example.com")
    add_notification(db, user)
    foreign = add_notification(db, other)

    response = api.patch("/api/v1/notifications/read-all")

    assert response.json() == {"message": "Notificaciones marcadas como leídas."}
    assert api.get("/api/v1/notifications?status=UNREAD").json()["meta"]["total"] == 0
    db.expire_all()
    assert db.get(Notification, foreign.notification_id).status == NotificationStatus.UNREAD


def test_other_users_notification_is_hidden(db, scenario, api) -> None:
    other = make_user(db, "otra@example.com")
    foreign = add_notification(db, other)

    assert api.get("/api/v1/notifications").json()["data"] == []
    response = api.patch(f"/api/v1/notifications/{foreign.notification_id}/read")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "NOT_FOUND"


# ---------------------------------------------------------------------------
# SSE
# ---------------------------------------------------------------------------
def aio_client(server: fakeredis.FakeServer) -> fakeredis.aioredis.FakeRedis:
    return fakeredis.aioredis.FakeRedis(server=server, decode_responses=True)


def test_format_event() -> None:
    raw = json.dumps({"event": "alert.created", "id": "a1", "data": {"category": "Alimentación"}})

    assert sse.format_event(raw) == (
        'event: alert.created\nid: a1\ndata: {"category": "Alimentación"}\n\n'
    )


@pytest.mark.cp("CP-ALE-14")
def test_stream_delivers_only_own_events_and_heartbeat() -> None:
    async def run() -> tuple[str, str | None]:
        server = fakeredis.FakeServer()
        publisher = aio_client(server)
        await publisher.set("session:sid", "{}")
        user_id, other_id = uuid.uuid4(), uuid.uuid4()
        events = await sse.open_stream(aio_client(server), user_id, "sid", heartbeat=0.01)

        foreign = {"event": "alert.created", "id": "ajena", "data": {"percentage": 90}}
        own = {"event": "alert.created", "id": "propia", "data": {"percentage": 80}}
        await publisher.publish(user_channel(other_id), json.dumps(foreign))
        await publisher.publish(user_channel(user_id), json.dumps(own))

        received = ""
        async for chunk in events:
            received += chunk
            if chunk == ": ping\n\n" and "propia" in received:
                # Terminar la sesion debe cerrar el stream y liberar la conexion.
                await publisher.delete("session:sid")
        return received, await publisher.get(f"sse:connections:{user_id}")

    received, connections = asyncio.run(asyncio.wait_for(run(), timeout=10))

    assert received.startswith("retry: 3000\n\n")
    assert "id: propia" in received
    assert "id: ajena" not in received
    assert connections is None


def test_stream_limits_connections_per_user() -> None:
    async def run() -> tuple[str, str]:
        server = fakeredis.FakeServer()
        observer = aio_client(server)
        user_id = uuid.uuid4()
        key = f"sse:connections:{user_id}"
        await observer.set(key, sse.MAX_CONNECTIONS)
        with pytest.raises(AppError) as error:
            await sse.open_stream(aio_client(server), user_id, "sid", heartbeat=0.01)
        return error.value.code, await observer.get(key)

    code, connections = asyncio.run(asyncio.wait_for(run(), timeout=10))

    assert code == "RATE_LIMITED"
    assert int(connections) == sse.MAX_CONNECTIONS


def test_stream_endpoint_releases_db_connection_and_sets_headers(api, monkeypatch) -> None:
    monkeypatch.setattr(sse, "HEARTBEAT_SECONDS", 0.01)
    server = fakeredis.FakeServer()
    app.dependency_overrides[sse.get_stream_client] = lambda: aio_client(server)
    session = MagicMock(spec=Session)
    app.dependency_overrides[get_db] = lambda: session

    # Sin sesion en Redis, el stream termina en el primer latido.
    response = api.get("/api/v1/notifications/stream")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    assert response.headers["cache-control"] == "no-cache"
    assert response.headers["x-accel-buffering"] == "no"
    assert response.text == "retry: 3000\n\n"
    session.close.assert_called_once()


def test_stream_requires_authentication(client) -> None:
    response = client.get("/api/v1/notifications/stream")

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "UNAUTHORIZED"


# ---------------------------------------------------------------------------
# Entregable y migracion
# ---------------------------------------------------------------------------
BACKEND = Path(__file__).resolve().parents[1]


def test_deliverable_file_exposes_the_module() -> None:
    spec = importlib.util.spec_from_file_location("kpb_ma", BACKEND / "app" / "KPB-MA.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    for name in module.__all__:
        assert hasattr(module, name)
    assert module.evaluate_expense is evaluate_expense


@pytest.mark.parametrize("model", [Alert, BudgetThreshold, Notification])
def test_migration_declares_every_new_column(model) -> None:
    """Evita que KPB-ENT y el script de migracion se desalineen."""
    migration = (BACKEND / "migrations" / "KPB-MA-001-alertas.sql").read_text(encoding="utf-8")
    legacy = {
        "alert_id", "user_id", "budget_id", "alert_type", "message", "detected_percentage",
        "remaining_balance", "is_read", "triggered_at", "created_at", "updated_at",
    }  # fmt: skip
    columns = {c.name for c in model.__table__.columns}
    if model is Alert:
        columns -= legacy
    for column in columns:
        assert column in migration
