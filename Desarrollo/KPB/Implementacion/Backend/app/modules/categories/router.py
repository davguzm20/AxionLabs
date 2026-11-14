"""Controlador FastAPI (Router) para el módulo de Categorías y Clasificación (CU05).

Rutas expuestas:
- POST /api/v1/categories/suggest: Sugiere categoría mediante IA o heurística (CU05).
- GET /api/v1/categories: Lista categorías disponibles (sistema y personalizadas).
- POST /api/v1/categories: Crea una categoría de usuario.
- GET /api/v1/categories/{category_id}: Obtiene una categoría específica.
- PATCH /api/v1/categories/{category_id}: Actualiza nombre o descripción.
- DELETE /api/v1/categories/{category_id}: Elimina categoría reasignando transacciones a 'Otros'.
"""

from __future__ import annotations

import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Header, Response, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.modules.auth.deps import CurrentSession, get_current_session
from app.modules.categories import service
from app.modules.categories.schemas import (
    CategoryCreate,
    CategoryItem,
    CategoryList,
    CategorySuggestRequest,
    CategorySuggestResponse,
    CategoryUpdate,
)


def _no_cache(response: Response) -> None:
    """Evita cachear respuestas de categorías."""
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"


router = APIRouter(
    prefix="/categories",
    tags=["categories"],
    dependencies=[Depends(_no_cache)],
)

DbSession = Annotated[Session, Depends(get_db)]
Current = Annotated[CurrentSession, Depends(get_current_session)]


@router.post(
    "/suggest",
    response_model=CategorySuggestResponse,
    summary="Sugerir categoría automáticamente con IA (CU05)",
)
def suggest_category(
    data: CategorySuggestRequest,
    db: DbSession,
    current: Current,
) -> CategorySuggestResponse:
    """Analiza el concepto y comercio de una transacción y sugiere la categoría correspondiente."""
    return service.suggest_category(db, current.user, data)


@router.get(
    "",
    response_model=CategoryList,
    summary="Listar categorías",
)
def list_categories(
    db: DbSession,
    current: Current,
    type: Literal["EXPENSE", "INCOME"] | None = None,
    include_system: bool = True,
    status: Literal["ACTIVE", "INACTIVE"] | None = None,
) -> CategoryList:
    """Lista las categorías del usuario autenticado y las categorías del sistema."""
    items = service.list_categories(
        db=db,
        user=current.user,
        category_type=type,
        include_system=include_system,
        status_filter=status,
    )
    return CategoryList(data=items)


@router.post(
    "",
    response_model=CategoryItem,
    status_code=status.HTTP_201_CREATED,
    summary="Crear categoría personalizada",
)
def create_category(
    data: CategoryCreate,
    db: DbSession,
    current: Current,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> CategoryItem:
    """Crea una nueva categoría propia para el usuario autenticado."""
    return service.create_category(db, current.user, data)


@router.get(
    "/{category_id}",
    response_model=CategoryItem,
    summary="Detalle de categoría",
)
def get_category(
    category_id: uuid.UUID,
    db: DbSession,
    current: Current,
) -> CategoryItem:
    """Obtiene el detalle de una categoría por su identificador."""
    return service.get_category(db, current.user, category_id)


@router.patch(
    "/{category_id}",
    response_model=CategoryItem,
    summary="Actualizar categoría propia",
)
def update_category(
    category_id: uuid.UUID,
    data: CategoryUpdate,
    db: DbSession,
    current: Current,
) -> CategoryItem:
    """Modifica el nombre o descripción de una categoría propia del usuario."""
    return service.update_category(db, current.user, category_id, data)


@router.delete(
    "/{category_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Eliminar categoría propia",
)
def delete_category(
    category_id: uuid.UUID,
    db: DbSession,
    current: Current,
) -> None:
    """Elimina una categoría propia reasignando transacciones a 'Otros' (ADR-016)."""
    service.delete_category(db, current.user, category_id)

