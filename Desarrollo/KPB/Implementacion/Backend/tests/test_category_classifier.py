import uuid

from app.integrations.ai.classifier import CategoryClassifier


def _candidate(name: str, category_type: str) -> dict[str, str]:
    return {"id": str(uuid.uuid4()), "name": name, "type": category_type}


def test_menu_is_classified_as_food_and_ignores_income_candidates() -> None:
    food = _candidate("Alimentación", "EXPENSE")
    others = _candidate("Otros", "EXPENSE")
    investments = _candidate("Inversiones", "INCOME")

    result = CategoryClassifier()._classify_with_heuristics(
        "EXPENSE", "Menú ejecutivo", None, [food, others, investments]
    )

    assert result.category_id == uuid.UUID(food["id"])
    assert result.category_name == "Alimentación"


def test_expense_fallback_uses_otros_instead_of_an_income_category() -> None:
    others = _candidate("Otros", "EXPENSE")
    investments = _candidate("Inversiones", "INCOME")

    result = CategoryClassifier()._classify_with_heuristics(
        "EXPENSE", "concepto desconocido", None, [others, investments]
    )

    assert result.category_id == uuid.UUID(others["id"])
    assert result.category_name == "Otros"
