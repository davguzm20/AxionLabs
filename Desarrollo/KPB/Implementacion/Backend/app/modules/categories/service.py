"""Capa de lógica de negocio (Servicio) para Categorías y Clasificación (CU05).

Implementa:
- BR-042: Clasificación de transacciones con IA (OpenAI + heurística local),
  con fallback automático a 'Otros' y needs_review=True si confianza < 0.60.
- BR-047–054: Ciclo de vida y reglas de negocio para categorías (unicidad por usuario,
  protección de categorías del sistema, reasignación automática a 'Otros' en eliminación).
"""

from __future__ import annotations

import logging
import uuid

from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.entities import Category, User
from app.integrations.ai.classifier import get_category_classifier
from app.modules.categories import repository
from app.modules.categories.repository import resolve_icon
from app.modules.categories.schemas import (
    CategoryCreate,
    CategoryItem,
    CategorySuggested,
    CategorySuggestRequest,
    CategorySuggestResponse,
    CategoryUpdate,
)

logger = logging.getLogger(__name__)


def _to_category_item(cat: Category, category_type: str = "EXPENSE") -> CategoryItem:
    """Convierte una entidad SQLAlchemy Category a un CategoryItem de API."""
    return CategoryItem(
        id=cat.category_id,
        name=cat.name,
        type=category_type,
        icon=resolve_icon(cat.name),
        is_system=cat.is_system,
        status="ACTIVE",
        created_at=cat.created_at,
    )


def suggest_category(
    db: Session,
    user: User,
    request: CategorySuggestRequest,
) -> CategorySuggestResponse:
    """Sugiere una categoría basada en el concepto y comercio de la transacción (CU05).

    Regla BR-042:
    - Si la confianza es >= 0.60 y la categoría es válida, se asigna con needs_review=False.
    - Si la confianza es < 0.60, o la categoría devuelta es inválida o falla la IA,
      se asigna 'Otros' y se marca needs_review=True.
    """
    # 1. Obtener todas las categorías candidatas del usuario y del sistema
    candidates_entities = repository.list_categories(
        db=db,
        user_id=user.user_id,
        include_system=True,
    )

    if not candidates_entities:
        fallback = repository.get_fallback_category(db, request.type)
        return CategorySuggestResponse(
            category=CategorySuggested(
                id=fallback.category_id,
                name=fallback.name,
                icon=resolve_icon(fallback.name),
            ),
            confidence=0.50,
            reason="No hay categorías disponibles en el sistema; asignando Otros.",
            needs_review=True,
        )

    # Preparar el payload de candidatos para el clasificador
    candidates_payload = [
        {
            "id": str(c.category_id),
            "name": c.name,
            "type": request.type,
            "is_system": c.is_system,
        }
        for c in candidates_entities
    ]

    # Mapa de búsqueda rápida por ID
    entities_by_id = {c.category_id: c for c in candidates_entities}

    # 2. Invocar el clasificador inteligente
    classifier = get_category_classifier()
    result = classifier.classify(
        category_type=request.type,
        concept=request.concept,
        merchant=request.merchant,
        candidates=candidates_payload,
    )

    # 3. Validar resultado según BR-042
    assigned_category: Category | None = None
    if result.category_id and result.category_id in entities_by_id:
        assigned_category = entities_by_id[result.category_id]

    # Umbral normativo de confianza: 0.60
    CONFIDENCE_THRESHOLD = 0.60

    if assigned_category is None or result.confidence < CONFIDENCE_THRESHOLD:
        fallback = repository.get_fallback_category(db, request.type)
        return CategorySuggestResponse(
            category=CategorySuggested(
                id=fallback.category_id,
                name=fallback.name,
                icon=resolve_icon(fallback.name),
            ),
            confidence=round(result.confidence, 2),
            reason=result.reason or "Confianza insuficiente; se asigna categoría Otros para revisión.",
            needs_review=True,
        )

    return CategorySuggestResponse(
        category=CategorySuggested(
            id=assigned_category.category_id,
            name=assigned_category.name,
            icon=resolve_icon(assigned_category.name),
        ),
        confidence=round(result.confidence, 2),
        reason=result.reason,
        needs_review=False,
    )


def list_categories(
    db: Session,
    user: User,
    category_type: str | None = None,
    include_system: bool = True,
    status_filter: str | None = None,
) -> list[CategoryItem]:
    """Lista las categorías del usuario y del sistema."""
    entities = repository.list_categories(
        db=db,
        user_id=user.user_id,
        category_type=category_type,
        include_system=include_system,
        status_filter=status_filter,
    )
    return [_to_category_item(cat, category_type or "EXPENSE") for cat in entities]


def get_category(
    db: Session,
    user: User,
    category_id: uuid.UUID,
) -> CategoryItem:
    """Obtiene el detalle de una categoría por su ID."""
    cat = repository.get_category_by_id(db, user.user_id, category_id)
    if cat is None:
        raise AppError(
            status_code=404,
            code="INVALID_CATEGORY",
            message="La categoría solicitada no existe o no tienes acceso a ella.",
        )
    return _to_category_item(cat)


def create_category(
    db: Session,
    user: User,
    data: CategoryCreate,
) -> CategoryItem:
    """Crea una categoría personalizada para el usuario (BR-034, BR-047)."""
    # Verificar si ya existe una categoría con este nombre para el usuario
    existing = repository.get_category_by_name(db, user.user_id, data.name)
    if existing is not None and existing.user_id == user.user_id:
        raise AppError(
            status_code=409,
            code="CATEGORY_NAME_EXISTS",
            message=f"Ya tienes una categoría creada con el nombre '{data.name}'.",
        )

    new_cat = repository.create_category(
        db=db,
        user_id=user.user_id,
        name=data.name,
        description=data.description,
    )
    db.commit()
    db.refresh(new_cat)
    return _to_category_item(new_cat, data.type)


def update_category(
    db: Session,
    user: User,
    category_id: uuid.UUID,
    data: CategoryUpdate,
) -> CategoryItem:
    """Actualiza una categoría del usuario. Prohíbe modificar las del sistema."""
    cat = repository.get_category_by_id(db, user.user_id, category_id)
    if cat is None:
        raise AppError(
            status_code=404,
            code="INVALID_CATEGORY",
            message="La categoría solicitada no existe.",
        )

    # Las categorías del sistema son de solo lectura
    if cat.is_system:
        raise AppError(
            status_code=403,
            code="SYSTEM_CATEGORY",
            message="Las categorías del sistema no pueden ser editadas ni eliminadas.",
        )

    # Si se actualiza el nombre, validar duplicados
    if data.name and data.name.strip().lower() != cat.name.strip().lower():
        existing = repository.get_category_by_name(db, user.user_id, data.name)
        if existing is not None and existing.category_id != cat.category_id and existing.user_id == user.user_id:
            raise AppError(
                status_code=409,
                code="CATEGORY_NAME_EXISTS",
                message=f"Ya existe otra categoría con el nombre '{data.name}'.",
            )

    updated_cat = repository.update_category(
        db=db,
        category=cat,
        name=data.name,
        description=data.description,
    )
    db.commit()
    db.refresh(updated_cat)
    return _to_category_item(updated_cat)


def delete_category(
    db: Session,
    user: User,
    category_id: uuid.UUID,
) -> None:
    """Elimina una categoría propia del usuario reasignando transacciones a 'Otros' (ADR-016)."""
    cat = repository.get_category_by_id(db, user.user_id, category_id)
    if cat is None:
        raise AppError(
            status_code=404,
            code="INVALID_CATEGORY",
            message="La categoría solicitada no existe.",
        )

    if cat.is_system:
        raise AppError(
            status_code=403,
            code="SYSTEM_CATEGORY",
            message="Las categorías del sistema no pueden ser eliminadas.",
        )

    if cat.is_fallback:
        raise AppError(
            status_code=403,
            code="SYSTEM_CATEGORY",
            message="La categoría base 'Otros' no puede ser eliminada.",
        )

    repository.delete_category(db, cat)
    db.commit()

