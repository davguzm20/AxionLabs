from sqlalchemy import select
from sqlalchemy.orm import Session

from app.entities import Category
from app.modules.auth import repository as auth_repository
from app.modules.categories import repository as categories_repository
from app.modules.categories import service as categories_service
from tests.sqlite_db import engine


def test_new_user_receives_the_default_category_catalog(engine) -> None:
    with Session(engine) as db:
        user = auth_repository.add_user_with_wallet(
            db, "Andrea", "Quispe", "andrea@example.com", "hash"
        )
        db.commit()

        categories = list(
            db.scalars(
                select(Category)
                .where(Category.user_id == user.user_id)
                .order_by(Category.name)
            )
        )

    assert {category.name for category in categories} == {
        "Alimentación",
        "Transporte",
        "Salud",
        "Otros",
    }


def test_fallback_otros_uses_the_authenticated_users_uuid(engine) -> None:
    with Session(engine) as db:
        first_user = auth_repository.add_user_with_wallet(
            db, "Andrea", "Quispe", "andrea@example.com", "hash"
        )
        second_user = auth_repository.add_user_with_wallet(
            db, "Bruno", "Ramos", "bruno@example.com", "hash"
        )
        db.commit()
        first_user_id = first_user.user_id
        second_user_id = second_user.user_id

        fallback = categories_repository.get_fallback_category(db, second_user_id)

    assert fallback.user_id == second_user_id
    assert fallback.user_id != first_user_id
    assert fallback.name == "Otros"


def test_category_list_filters_the_default_catalog_by_transaction_type(engine) -> None:
    with Session(engine) as db:
        user = auth_repository.add_user_with_wallet(
            db, "Andrea", "Quispe", "andrea@example.com", "hash"
        )
        db.commit()

        expenses = categories_service.list_categories(db, user, category_type="EXPENSE")
        incomes = categories_service.list_categories(db, user, category_type="INCOME")

    assert {category.name for category in expenses} == {
        "Alimentación", "Transporte", "Salud", "Otros"
    }
    assert incomes == []
