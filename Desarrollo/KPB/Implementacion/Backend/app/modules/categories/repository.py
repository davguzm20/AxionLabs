"""Capa de acceso a datos (Repositorio) para Categorías (CU05).

Gestiona consultas y persistencia sobre la tabla `categories`, respetando el aislamiento
multitenant (categorías del sistema con user_id=None vs categorías propias del usuario).
"""

from __future__ import annotations

import uuid
from typing import Sequence

from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from app.entities import Budget, Category, Transaction

# Iconos estándar por defecto según el catálogo de KPB-Specs
DEFAULT_ICONS: dict[str, str] = {
    "alimentación": "utensils",
    "transporte": "bus",
    "salud": "heart-pulse",
    "hogar": "home",
    "servicios": "receipt",
    "entretenimiento": "gamepad-2",
    "educación": "graduation-cap",
    "mascotas": "paw-print",
    "salario": "briefcase",
    "ventas": "store",
    "inversiones": "trending-up",
    "regalos": "gift",
    "otros": "tag",
}


def resolve_icon(category_name: str, custom_icon: str | None = None) -> str:
    """Resuelve el icono Lucide apropiado para una categoría."""
    if custom_icon and custom_icon.strip():
        return custom_icon.strip()
    return DEFAULT_ICONS.get(category_name.strip().lower(), "tag")


def list_categories(
    db: Session,
    user_id: uuid.UUID,
    category_type: str | None = None,
    include_system: bool = True,
    status_filter: str | None = None,
) -> list[Category]:
    """Lista las categorías disponibles para el usuario (propias y del sistema)."""
    stmt = select(Category)

    if include_system:
        stmt = stmt.where((Category.user_id == user_id) | (Category.user_id.is_(None)))
    else:
        stmt = stmt.where(Category.user_id == user_id)

    # Ordenar priorizando categorías del sistema primero y luego alfabéticamente
    stmt = stmt.order_by(Category.user_id.asc().nullsfirst(), Category.name.asc())

    return list(db.execute(stmt).scalars().all())


def get_category_by_id(
    db: Session,
    user_id: uuid.UUID,
    category_id: uuid.UUID,
) -> Category | None:
    """Obtiene una categoría por su ID verificando pertenencia o sistema."""
    stmt = select(Category).where(
        Category.category_id == category_id,
        (Category.user_id == user_id) | (Category.user_id.is_(None)),
    )
    return db.execute(stmt).scalars().first()


def get_category_by_name(
    db: Session,
    user_id: uuid.UUID,
    name: str,
) -> Category | None:
    """Busca una categoría por nombre (case-insensitive) para el usuario o sistema."""
    clean_name = name.strip()
    stmt = (
        select(Category)
        .where(
            (Category.user_id == user_id) | (Category.user_id.is_(None)),
            func.lower(Category.name) == clean_name.lower(),
        )
        .order_by(Category.user_id.desc().nullslast())  # Prioriza la propia del usuario
    )
    return db.execute(stmt).scalars().first()


def get_fallback_category(db: Session, category_type: str = "EXPENSE") -> Category:
    """Obtiene la categoría del sistema 'Otros'. Si no existiera en la BD, la crea."""
    stmt = select(Category).where(
        Category.user_id.is_(None),
        func.lower(Category.name) == "otros",
    )
    category = db.execute(stmt).scalars().first()
    if category is not None:
        return category

    # Fallback de respaldo si aún no se corrió el seed en la BD
    fallback = Category(
        name="Otros",
        description="Categoría por defecto para gastos sin clasificar",
    )
    db.add(fallback)
    db.flush()
    return fallback


def create_category(
    db: Session,
    user_id: uuid.UUID,
    name: str,
    description: str | None = None,
) -> Category:
    """Crea una nueva categoría propia para el usuario."""
    category = Category(
        user_id=user_id,
        name=name.strip(),
        description=description.strip() if description else None,
    )
    db.add(category)
    db.flush()
    return category


def update_category(
    db: Session,
    category: Category,
    name: str | None = None,
    description: str | None = None,
) -> Category:
    """Actualiza los datos de una categoría."""
    if name is not None:
        category.name = name.strip()
    if description is not None:
        category.description = description.strip() if description else None

    db.flush()
    return category


def delete_category(db: Session, category: Category) -> None:
    """Elimina una categoría propia del usuario según ADR-016.

    - Si tiene transacciones vinculadas, las reasigna automáticamente a 'Otros'.
    - Si tiene presupuestos asociados, los desvincula o elimina.
    - Finalmente elimina físicamente la categoría.
    """
    fallback = get_fallback_category(db)

    # Reasignar transacciones asociadas a la categoría 'Otros'
    db.execute(
        update(Transaction)
        .where(Transaction.category_id == category.category_id)
        .values(category_id=fallback.category_id)
    )

    # Eliminar presupuestos asociados a esta categoría
    db.execute(
        delete(Budget).where(Budget.category_id == category.category_id)
    )

    # Eliminar la categoría
    db.delete(category)
    db.flush()


def count_transactions_for_category(db: Session, category_id: uuid.UUID) -> int:
    """Cuenta cuántas transacciones están usando esta categoría."""
    stmt = (
        select(func.count())
        .select_from(Transaction)
        .where(Transaction.category_id == category_id)
    )
    return db.execute(stmt).scalar() or 0

