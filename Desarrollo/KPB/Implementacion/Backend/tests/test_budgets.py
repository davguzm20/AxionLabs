# ruff: noqa: F811
# Las fixtures de pytest importadas de tests.sqlite_db parecen redefinirse.
"""Pruebas del CU07 (KPB-CTG): presupuestos, periodos, consumo e impacto.

Usan el ORM real sobre SQLite en memoria (tests/sqlite_db.py) con la fecha fija
2026-10-27 (martes) en America/Lima.
"""

import importlib.util
import uuid
from datetime import UTC, date, datetime
from decimal import Decimal
from pathlib import Path
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.core.errors import AppError
from app.database import get_db
from app.entities import (
    Alert,
    Budget,
    BudgetStatus,
    BudgetThreshold,
    Currency,
    PeriodType,
    SourceType,
    Transaction,
    TransactionStatus,
    TransactionType,
)
from app.main import app
from app.modules.alerts.service import evaluate_expense
from app.modules.auth.deps import CurrentSession, get_current_session
from app.modules.budgets import service
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

URL = "/api/v1/budgets"


@pytest.fixture
def scenario(db):
    user = make_user(db)
    wallet = make_wallet(db, user)
    category = make_category(db)
    db.commit()
    return user, wallet, category


@pytest.fixture
def api(db, scenario):
    """Cliente autenticado como el usuario del escenario."""
    user = scenario[0]
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_session] = lambda: CurrentSession(
        user=user, session_id="sid", last_activity_at=datetime.now(UTC)
    )
    yield TestClient(app)
    app.dependency_overrides.clear()


def record(
    db,
    wallet,
    category,
    amount: str,
    when: datetime | None = None,
    kind: TransactionType = TransactionType.GASTO,
) -> Transaction:
    transaction = Transaction(
        user_id=wallet.user_id,
        wallet_id=wallet.wallet_id,
        category_id=category.category_id,
        amount=Decimal(amount),
        type=kind,
        currency=wallet.currency,
        transacted_at=when or datetime(2026, 10, 27, 12, tzinfo=LIMA),
        status=TransactionStatus.CONFIRMADA,
        source_type=SourceType.TEXTO,
    )
    db.add(transaction)
    db.commit()
    return transaction


def payload(category, **changes) -> dict:
    return {
        "category_id": str(category.category_id),
        "currency": "PEN",
        "amount": "300.00",
        "period_type": "MONTHLY",
        "start_date": None,
        "period_days": None,
    } | changes


def error_code(response) -> str:
    return response.json()["error"]["code"]


# ---------------------------------------------------------------------------
# Crear
# ---------------------------------------------------------------------------
@pytest.mark.cp("CP-PRE-01")
def test_create_monthly_budget(db, scenario, api) -> None:
    _, wallet, category = scenario
    record(db, wallet, category, "120.00")

    response = api.post(URL, json=payload(category), headers={"Idempotency-Key": "k1"})

    assert response.status_code == 201
    body = response.json()
    assert body["category"] == {"id": str(category.category_id), "name": "Alimentación", "icon": "tag"}
    assert body["currency"] == "PEN"
    assert body["amount"] == "300.00"
    assert body["period_type"] == "MONTHLY"
    assert (body["start_date"], body["period_days"]) == (None, None)
    assert (body["period_start"], body["period_end"]) == ("2026-10-01", "2026-10-31")
    assert (body["consumed"], body["remaining"], body["percentage"]) == ("120.00", "180.00", 40.0)
    assert body["status"] == "ACTIVE"
    assert [(t["percentage"], t["triggered"]) for t in body["thresholds"]] == [(80, False)]

    stored = db.execute(select(Budget)).scalars().one()
    assert (stored.period_type, stored.period_days) == (PeriodType.MENSUAL, 30)


@pytest.mark.cp("CP-PRE-02")
def test_create_weekly_budget_starts_on_monday(scenario, api) -> None:
    category = scenario[2]

    body = api.post(URL, json=payload(category, period_type="WEEKLY")).json()

    assert (body["period_start"], body["period_end"]) == ("2026-10-26", "2026-11-01")


@pytest.mark.cp("CP-PRE-03")
def test_create_custom_budget(scenario, api) -> None:
    category = scenario[2]

    body = api.post(
        URL, json=payload(category, period_type="CUSTOM", start_date="2026-10-01", period_days=10)
    ).json()

    assert (body["start_date"], body["period_days"]) == ("2026-10-01", 10)
    assert (body["period_start"], body["period_end"]) == ("2026-10-21", "2026-10-30")


def test_custom_budget_not_started_has_no_consumption(db, scenario, api) -> None:
    _, wallet, category = scenario
    record(db, wallet, category, "120.00")

    body = api.post(
        URL, json=payload(category, period_type="CUSTOM", start_date="2026-12-01", period_days=10)
    ).json()

    assert (body["period_start"], body["period_end"]) == ("2026-12-01", "2026-12-10")
    assert body["consumed"] == "0.00"


def test_custom_budget_not_started_does_not_alert(db, scenario) -> None:
    user, wallet, category = scenario
    make_budget(
        db,
        user,
        category,
        thresholds=(80,),
        period_type=PeriodType.PERSONALIZADO,
        period_days=10,
        start_date=date(2026, 10, 28),
    )
    transaction = record(db, wallet, category, "300.00", datetime(2026, 10, 28, 12, tzinfo=LIMA))

    assert evaluate_expense(db, transaction, today=TODAY) == []


def test_create_with_thresholds(db, scenario, api) -> None:
    category = scenario[2]

    body = api.post(URL, json=payload(category, thresholds=[100, 80])).json()

    assert [t["percentage"] for t in body["thresholds"]] == [80, 100]
    assert db.execute(select(Budget)).scalars().one().threshold_percentage == Decimal("80.00")


@pytest.mark.cp("CP-PRE-04")
@pytest.mark.parametrize(
    ("amount", "code"),
    [
        ("0", "INVALID_AMOUNT"),
        ("-1", "INVALID_AMOUNT"),
        ("abc", "INVALID_AMOUNT"),
        ("NaN", "INVALID_AMOUNT"),
        ("100000000.00", "INVALID_AMOUNT"),
        ("10.123", "INVALID_AMOUNT_PRECISION"),
    ],
)
def test_invalid_amount(scenario, api, amount, code) -> None:
    response = api.post(URL, json=payload(scenario[2], amount=amount))

    assert response.status_code == 422
    assert error_code(response) == code


def test_maximum_amount_is_accepted(scenario, api) -> None:
    response = api.post(URL, json=payload(scenario[2], amount="99999999.99"))

    assert response.status_code == 201


@pytest.mark.parametrize(
    ("changes", "code"),
    [
        ({"currency": "EUR"}, "INVALID_CURRENCY"),
        ({"period_type": "DAILY"}, "INVALID_PERIOD"),
        ({"period_type": "CUSTOM", "period_days": 10}, "CUSTOM_PERIOD_REQUIRED"),
        ({"period_type": "CUSTOM", "start_date": "2026-10-01"}, "CUSTOM_PERIOD_REQUIRED"),
        ({"period_type": "CUSTOM", "start_date": "2026-10-01", "period_days": 0}, "INVALID_PERIOD_DAYS"),
        ({"period_type": "CUSTOM", "start_date": "2026-10-01", "period_days": 367}, "INVALID_PERIOD_DAYS"),
        ({"thresholds": []}, "INVALID_THRESHOLD"),
        ({"thresholds": [0]}, "INVALID_THRESHOLD"),
    ],
    ids=["moneda", "periodo", "sin-fecha", "sin-dias", "0-dias", "367-dias", "sin-umbrales", "umbral-0"],
)
def test_invalid_budget_is_rejected(db, scenario, api, changes, code) -> None:
    """CP-PRE-16 y CP-PRE-17 incluidos; nada se guarda."""
    response = api.post(URL, json=payload(scenario[2], **changes))

    assert response.status_code == 422
    assert error_code(response) == code
    assert db.execute(select(Budget)).scalars().all() == []


@pytest.mark.parametrize("days", [1, 366])
def test_custom_period_limits_are_accepted(scenario, api, days) -> None:
    response = api.post(
        URL, json=payload(scenario[2], period_type="CUSTOM", start_date="2026-10-01", period_days=days)
    )

    assert response.status_code == 201
    assert response.json()["period_days"] == days


def test_duplicate_thresholds_conflict(scenario, api) -> None:
    response = api.post(URL, json=payload(scenario[2], thresholds=[80, 80]))

    assert response.status_code == 409
    assert error_code(response) == "THRESHOLD_EXISTS"


def test_unknown_or_foreign_category_is_invalid(db, scenario, api) -> None:
    stranger = make_user(db, "otra@example.com")
    foreign = make_category(db, "Ajena")
    foreign.user_id = stranger.user_id
    db.commit()

    for category_id in (uuid.uuid4(), foreign.category_id):
        response = api.post(URL, json=payload(scenario[2], category_id=str(category_id)))
        assert response.status_code == 422
        assert error_code(response) == "INVALID_CATEGORY"


@pytest.mark.cp("CP-PRE-06")
def test_one_active_budget_per_category(scenario, api) -> None:
    category = scenario[2]
    api.post(URL, json=payload(category))

    response = api.post(URL, json=payload(category, currency="USD"))

    assert response.status_code == 409
    assert error_code(response) == "BUDGET_EXISTS"


def test_inactive_budget_does_not_block_a_new_one(scenario, api) -> None:
    category = scenario[2]
    first = api.post(URL, json=payload(category)).json()
    api.delete(f"{URL}/{first['id']}")

    assert api.post(URL, json=payload(category)).status_code == 201


def test_concurrent_duplicate_is_reported_as_conflict() -> None:
    """Si dos altas pasan la verificacion previa, el indice unico de PostgreSQL decide."""
    session = MagicMock()
    session.commit.side_effect = IntegrityError(
        "INSERT", None, Exception('duplicate key value violates unique constraint "uq_budgets_active_category"')
    )

    with pytest.raises(AppError) as error:
        service._commit_or_conflict(session)

    assert error.value.code == "BUDGET_EXISTS"
    session.rollback.assert_called_once()


# ---------------------------------------------------------------------------
# Consumo
# ---------------------------------------------------------------------------
@pytest.mark.cp("CP-PRE-07")
def test_consumption_only_counts_matching_expenses(db, scenario, api) -> None:
    """CP-PRE-08 (ingresos) y CP-PRE-14 (otra moneda) incluidos."""
    user, wallet, category = scenario
    other_category = make_category(db, "Transporte")
    dollars = make_wallet(db, user, Currency.USD)
    db.commit()
    record(db, wallet, category, "100.00")
    record(db, wallet, category, "20.00")
    record(db, wallet, category, "500.00", kind=TransactionType.INGRESO)
    record(db, dollars, category, "50.00")
    record(db, wallet, other_category, "70.00")
    record(db, wallet, category, "40.00", datetime(2026, 9, 30, 12, tzinfo=LIMA))

    body = api.post(URL, json=payload(category)).json()

    assert body["consumed"] == "120.00"


def test_pending_transactions_do_not_consume(db, scenario, api) -> None:
    _, wallet, category = scenario
    record(db, wallet, category, "100.00").status = TransactionStatus.PENDIENTE
    db.commit()

    assert api.post(URL, json=payload(category)).json()["consumed"] == "0.00"


@pytest.mark.cp("CP-PRE-12")
def test_month_boundary_in_lima(db, scenario, api) -> None:
    _, wallet, category = scenario
    record(db, wallet, category, "10.00", datetime(2026, 10, 31, 23, 59, tzinfo=LIMA))
    record(db, wallet, category, "99.00", datetime(2026, 11, 1, 0, 0, tzinfo=LIMA))
    record(db, wallet, category, "5.00", datetime(2026, 10, 1, 0, 0, tzinfo=LIMA))

    assert api.post(URL, json=payload(category)).json()["consumed"] == "15.00"


@pytest.mark.cp("CP-PRE-13")
def test_week_boundary_in_lima(db, scenario, api) -> None:
    _, wallet, category = scenario
    record(db, wallet, category, "10.00", datetime(2026, 10, 25, 23, 59, tzinfo=LIMA))  # domingo
    record(db, wallet, category, "7.00", datetime(2026, 10, 26, 0, 0, tzinfo=LIMA))  # lunes

    body = api.post(URL, json=payload(category, period_type="WEEKLY")).json()

    assert body["consumed"] == "7.00"


@pytest.mark.cp("CP-PRE-18")
def test_overspent_budget_is_allowed(db, scenario, api) -> None:
    _, wallet, category = scenario
    record(db, wallet, category, "315.00")

    response = api.post(URL, json=payload(category))

    assert response.status_code == 201
    assert (response.json()["remaining"], response.json()["percentage"]) == ("-15.00", 105.0)


def test_percentage_has_one_decimal(db, scenario, api) -> None:
    _, wallet, category = scenario
    record(db, wallet, category, "1.00")

    assert api.post(URL, json=payload(category, amount="3.00")).json()["percentage"] == 33.3


@pytest.mark.cp("CP-PRE-09")
def test_impact(db, scenario, api) -> None:
    _, wallet, category = scenario
    budget_id = api.post(URL, json=payload(category)).json()["id"]
    record(db, wallet, category, "120.00")

    assert api.get(f"{URL}/{budget_id}/impact").json() == {
        "consumed": "120.00",
        "remaining": "180.00",
        "percentage": 40.0,
        "will_exceed": False,
    }

    record(db, wallet, category, "181.00")
    impact = api.get(f"{URL}/{budget_id}/impact").json()
    assert (impact["remaining"], impact["will_exceed"]) == ("-1.00", True)


# ---------------------------------------------------------------------------
# Listar y detalle
# ---------------------------------------------------------------------------
def test_list_and_filters(db, scenario, api) -> None:
    _, wallet, category = scenario
    transport = make_category(db, "Transporte")
    db.commit()
    food = api.post(URL, json=payload(category, thresholds=[80, 100])).json()
    api.post(URL, json=payload(transport))
    api.delete(f"{URL}/{food['id']}")
    record(db, wallet, category, "240.00")

    everything = api.get(URL).json()["data"]
    active = api.get(f"{URL}?status=ACTIVE").json()["data"]
    by_category = api.get(f"{URL}?category_id={category.category_id}").json()["data"]

    assert len(everything) == 2
    assert [b["category"]["name"] for b in active] == ["Transporte"]
    assert [b["id"] for b in by_category] == [food["id"]]
    assert by_category[0]["status"] == "INACTIVE"
    assert by_category[0]["consumed"] == "240.00"


def test_list_reports_triggered_thresholds(db, scenario, api) -> None:
    user, wallet, category = scenario
    make_budget(db, user, category, thresholds=(80, 100))
    evaluate_expense(db, record(db, wallet, category, "240.00"), today=TODAY)
    db.commit()

    budget = api.get(URL).json()["data"][0]

    assert [(t["percentage"], t["triggered"]) for t in budget["thresholds"]] == [
        (80, True),
        (100, False),
    ]


def test_list_rejects_unknown_status(api) -> None:
    response = api.get(f"{URL}?status=OTRO")

    assert response.status_code == 422
    assert error_code(response) == "VALIDATION_ERROR"


def test_detail(scenario, api) -> None:
    created = api.post(URL, json=payload(scenario[2])).json()

    assert api.get(f"{URL}/{created['id']}").json() == created


@pytest.mark.cp("CP-PRE-15")
def test_foreign_budget_is_not_found(db, api) -> None:
    owner = make_user(db, "duena@example.com")
    budget = make_budget(db, owner, make_category(db, "Ajena"))

    for method, path, body in [
        ("GET", f"{URL}/{budget.budget_id}", None),
        ("GET", f"{URL}/{budget.budget_id}/impact", None),
        ("PATCH", f"{URL}/{budget.budget_id}", {"amount": "1.00"}),
        ("DELETE", f"{URL}/{budget.budget_id}", None),
        ("GET", f"{URL}/{uuid.uuid4()}", None),
    ]:
        response = api.request(method, path, json=body)
        assert response.status_code == 404, path
        assert error_code(response) == "NOT_FOUND"
    db.expire_all()
    assert db.get(Budget, budget.budget_id).amount == Decimal("300.00")
    assert api.get(URL).json()["data"] == []


# ---------------------------------------------------------------------------
# Editar, desactivar y reactivar
# ---------------------------------------------------------------------------
@pytest.mark.cp("CP-PRE-11")
def test_update_amount_and_period_recalculates(db, scenario, api) -> None:
    _, wallet, category = scenario
    record(db, wallet, category, "60.00")
    record(db, wallet, category, "40.00", datetime(2026, 10, 2, 12, tzinfo=LIMA))
    budget_id = api.post(URL, json=payload(category)).json()["id"]

    body = api.patch(
        f"{URL}/{budget_id}",
        json={"amount": "120.00", "period_type": "WEEKLY", "start_date": None, "period_days": None},
    ).json()

    assert (body["amount"], body["period_type"]) == ("120.00", "WEEKLY")
    assert (body["period_start"], body["consumed"], body["percentage"]) == ("2026-10-26", "60.00", 50.0)


def test_update_to_custom_and_back(db, scenario, api) -> None:
    budget_id = api.post(URL, json=payload(scenario[2])).json()["id"]

    missing = api.patch(f"{URL}/{budget_id}", json={"period_type": "CUSTOM"})
    custom = api.patch(
        f"{URL}/{budget_id}", json={"period_type": "CUSTOM", "start_date": "2026-10-20", "period_days": 5}
    ).json()
    only_days = api.patch(f"{URL}/{budget_id}", json={"period_days": 3}).json()
    monthly = api.patch(f"{URL}/{budget_id}", json={"period_type": "MONTHLY"}).json()

    assert error_code(missing) == "CUSTOM_PERIOD_REQUIRED"
    assert (custom["period_start"], custom["period_end"]) == ("2026-10-25", "2026-10-29")
    assert (only_days["start_date"], only_days["period_days"]) == ("2026-10-20", 3)
    assert (monthly["start_date"], monthly["period_days"], monthly["period_start"]) == (
        None,
        None,
        "2026-10-01",
    )
    assert db.execute(select(Budget)).scalars().one().period_days == 30


@pytest.mark.parametrize(
    ("changes", "code"),
    [
        ({"amount": "0"}, "INVALID_AMOUNT"),
        ({"amount": None}, "INVALID_AMOUNT"),
        ({"period_type": "YEARLY"}, "INVALID_PERIOD"),
        ({"period_type": None}, "INVALID_PERIOD"),
    ],
)
def test_update_rejects_invalid_values(db, scenario, api, changes, code) -> None:
    budget_id = api.post(URL, json=payload(scenario[2])).json()["id"]

    response = api.patch(f"{URL}/{budget_id}", json=changes)

    assert response.status_code == 422
    assert error_code(response) == code
    assert api.get(f"{URL}/{budget_id}").json()["amount"] == "300.00"


@pytest.mark.cp("CP-PRE-21")
@pytest.mark.parametrize("changes", [{"currency": "USD"}, {"category_id": str(uuid.uuid4())}])
def test_category_and_currency_are_immutable(db, scenario, api, changes) -> None:
    budget_id = api.post(URL, json=payload(scenario[2])).json()["id"]

    response = api.patch(f"{URL}/{budget_id}", json=changes | {"amount": "500.00"})

    assert response.status_code == 422
    assert error_code(response) == "VALIDATION_ERROR"
    stored = db.execute(select(Budget)).scalars().one()
    assert (stored.currency, stored.amount) == (Currency.PEN, Decimal("300.00"))


def test_editing_keeps_issued_alerts(db, scenario, api) -> None:
    """Editar el monto no reinicia las alertas del periodo (BR-072)."""
    user, wallet, category = scenario
    budget = make_budget(db, user, category, thresholds=(80,))
    evaluate_expense(db, record(db, wallet, category, "240.00"), today=TODAY)
    db.commit()

    api.patch(f"{URL}/{budget.budget_id}", json={"amount": "250.00"})

    assert evaluate_expense(db, record(db, wallet, category, "1.00"), today=TODAY) == []
    assert api.get(f"{URL}/{budget.budget_id}").json()["thresholds"][0]["triggered"] is True


@pytest.mark.cp("CP-PRE-10")
def test_delete_deactivates_keeps_alerts_and_stops_alerting(db, scenario, api) -> None:
    user, wallet, category = scenario
    budget = make_budget(db, user, category, thresholds=(80, 100))
    evaluate_expense(db, record(db, wallet, category, "240.00"), today=TODAY)
    db.commit()

    response = api.delete(f"{URL}/{budget.budget_id}")

    assert response.status_code == 204
    assert api.get(f"{URL}/{budget.budget_id}").json()["status"] == "INACTIVE"
    assert len(db.execute(select(Alert)).scalars().all()) == 1
    assert len(db.execute(select(BudgetThreshold)).scalars().all()) == 2
    assert evaluate_expense(db, record(db, wallet, category, "100.00"), today=TODAY) == []
    assert api.delete(f"{URL}/{budget.budget_id}").status_code == 204


@pytest.mark.cp("CP-PRE-22")
def test_reactivate_budget(db, scenario, api) -> None:
    category = scenario[2]
    first = api.post(URL, json=payload(category)).json()
    api.patch(f"{URL}/{first['id']}", json={"status": "INACTIVE"})

    reactivated = api.patch(f"{URL}/{first['id']}", json={"status": "ACTIVE"})

    assert reactivated.status_code == 200
    assert reactivated.json()["status"] == "ACTIVE"
    assert db.execute(select(Budget)).scalars().one().status == BudgetStatus.ACTIVO


def test_reactivate_conflicts_with_another_active_budget(db, scenario, api) -> None:
    category = scenario[2]
    first = api.post(URL, json=payload(category)).json()
    api.delete(f"{URL}/{first['id']}")
    api.post(URL, json=payload(category, amount="500.00"))

    response = api.patch(f"{URL}/{first['id']}", json={"status": "ACTIVE"})

    assert response.status_code == 409
    assert error_code(response) == "BUDGET_EXISTS"
    db.expire_all()
    assert db.get(Budget, uuid.UUID(first["id"])).status == BudgetStatus.INACTIVO


# ---------------------------------------------------------------------------
# Entregable
# ---------------------------------------------------------------------------
def test_deliverable_file_exposes_the_module() -> None:
    path = Path(__file__).resolve().parents[1] / "app" / "KPB-CTG.py"
    spec = importlib.util.spec_from_file_location("kpb_ctg", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    for name in module.__all__:
        assert hasattr(module, name)
    assert module.create_budget is service.create_budget
