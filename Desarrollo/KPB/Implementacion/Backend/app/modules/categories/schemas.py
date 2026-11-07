"""Esquemas Pydantic para el módulo de Categorías y Clasificación (CU05).

Define los contratos de entrada y salida para:
- Listado y administración de categorías de usuario y de sistema.
- Sugerencia de categoría automática con IA (POST /categories/suggest).
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class CategorySuggested(BaseModel):
    """Información básica de la categoría sugerida por el clasificador."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    icon: str = "tag"


class CategorySuggestRequest(BaseModel):
    """Petición de sugerencia de categoría para un concepto y comercio."""

    type: Literal["EXPENSE", "INCOME"] = Field(
        default="EXPENSE",
        description="Tipo de transacción (EXPENSE o INCOME)",
    )
    concept: str = Field(
        ...,
        min_length=1,
        max_length=200,
        description="Concepto o descripción textual del gasto o ingreso",
    )
    merchant: str | None = Field(
        default=None,
        max_length=100,
        description="Nombre del comercio o proveedor (opcional)",
    )


class CategorySuggestResponse(BaseModel):
    """Respuesta con la categoría sugerida y metadatos de confianza."""

    category: CategorySuggested
    confidence: float = Field(
        ...,
        ge=0.0,
        le=1.0,
        description="Nivel de certidumbre entre 0.0 y 1.0 según BR-042",
    )
    reason: str = Field(
        ...,
        description="Explicación breve del motivo de la asignación de categoría",
    )
    needs_review: bool = Field(
        ...,
        description="True si la confianza fue < 0.60 o se usó fallback 'Otros'",
    )


class CategoryItem(BaseModel):
    """Representación de una categoría en la API."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    type: str = "EXPENSE"
    icon: str = "tag"
    is_system: bool = False
    status: str = "ACTIVE"
    created_at: datetime | None = None


class CategoryList(BaseModel):
    """Contenedor de lista de categorías devuelto por GET /categories."""

    data: list[CategoryItem]


class CategoryCreate(BaseModel):
    """Datos para crear una categoría propia del usuario."""

    name: str = Field(
        ...,
        min_length=1,
        max_length=100,
        description="Nombre único de la categoría para el usuario",
    )
    type: Literal["EXPENSE", "INCOME"] = Field(
        default="EXPENSE",
        description="Tipo de categoría (EXPENSE o INCOME)",
    )
    icon: str | None = Field(
        default="tag",
        max_length=50,
        description="Nombre del icono Lucide (ej: utensils, bus, users)",
    )
    description: str | None = Field(
        default=None,
        max_length=255,
        description="Descripción opcional de la categoría",
    )


class CategoryUpdate(BaseModel):
    """Datos permitidos para modificar una categoría propia del usuario."""

    name: str | None = Field(
        default=None,
        min_length=1,
        max_length=100,
        description="Nuevo nombre para la categoría",
    )
    icon: str | None = Field(
        default=None,
        max_length=50,
        description="Nuevo icono",
    )
    status: Literal["ACTIVE", "INACTIVE"] | None = Field(
        default=None,
        description="Estado activo o inactivo (desactivación lógica)",
    )
    description: str | None = Field(
        default=None,
        max_length=255,
        description="Nueva descripción",
    )

