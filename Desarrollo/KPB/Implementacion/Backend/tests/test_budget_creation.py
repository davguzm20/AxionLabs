from sqlalchemy import select
from sqlalchemy.orm import Session

from app.entities import Budget, BudgetThreshold
from app.modules.budgets.schemas import BudgetCreate
from app.modules.budgets.service import create_budget, list_budgets
from app.modules.categories import repository as categories_repository
from tests.sqlite_db import engine, make_budget, make_category, make_user


def test_create_budget_flushes_parent_before_thresholds(engine) -> None:
    with Session(engine) as db:
        user = make_user(db)
        category = make_category(db, "Alimentacion")
        category.user_id = user.user_id
        db.commit()

        created = create_budget(
            db,
            user,
            BudgetCreate(
                category_id=category.category_id,
                currency="PEN",
                amount="250.00",
                period_type="MONTHLY",
                thresholds=[75, 80],
            ),
        )
        db.expire_all()

        budget = db.get(Budget, created.id)
        thresholds = list(
            db.scalars(
                select(BudgetThreshold)
                .where(BudgetThreshold.budget_id == created.id)
                .order_by(BudgetThreshold.percentage)
            )
        )

    assert budget is not None
    assert [threshold.percentage for threshold in thresholds] == [75, 80]


def test_list_budgets_keeps_categories_without_an_active_cap(engine) -> None:
    with Session(engine) as db:
        user = make_user(db)
        categories_repository.ensure_default_categories(db, user.user_id)
        category = categories_repository.get_category_by_name(db, user.user_id, "Otros")
        assert category is not None
        budget = make_budget(db, user, category, amount="420")

        result = list_budgets(db, user, "ACTIVE", None)

    by_name = {item.category.name: item for item in result}
    assert len(by_name) == 4
    assert by_name["Otros"].id == budget.budget_id
    assert by_name["Otros"].amount == "420.00"
    assert by_name["Alimentación"].id is None
    assert by_name["Alimentación"].amount is None
    assert by_name["Alimentación"].percentage == 0.0
    assert by_name["Alimentación"].status == "NONE"
