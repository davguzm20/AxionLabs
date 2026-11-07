"""Rutas del CU07: /budgets. Los umbrales estan en app.modules.alerts.router."""

from __future__ import annotations

import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Header, Response, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.modules.auth.deps import CurrentSession, get_current_session
from app.modules.budgets import service
from app.modules.budgets.schemas import (
    BudgetCreate,
    BudgetImpact,
    BudgetList,
    BudgetOut,
    BudgetUpdate,
)

router = APIRouter(prefix="/budgets", tags=["budgets"])

DbSession = Annotated[Session, Depends(get_db)]
Current = Annotated[CurrentSession, Depends(get_current_session)]


@router.get("", response_model=BudgetList, summary="Listar presupuestos")
def list_budgets(
    db: DbSession,
    current: Current,
    status: Literal["ACTIVE", "INACTIVE"] | None = None,
    category_id: uuid.UUID | None = None,
) -> BudgetList:
    return BudgetList(data=service.list_budgets(db, current.user, status, category_id))


@router.post(
    "", response_model=BudgetOut, status_code=status.HTTP_201_CREATED, summary="Crear presupuesto"
)
def create_budget(
    data: BudgetCreate,
    db: DbSession,
    current: Current,
    # Aceptado pero aun sin efecto, igual que en CU02: no hay capa de idempotencia.
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> BudgetOut:
    return service.create_budget(db, current.user, data)


@router.get("/{budget_id}", response_model=BudgetOut, summary="Detalle de presupuesto")
def get_budget(budget_id: uuid.UUID, db: DbSession, current: Current) -> BudgetOut:
    return service.get_budget(db, current.user, budget_id)


@router.patch("/{budget_id}", response_model=BudgetOut, summary="Actualizar o reactivar")
def update_budget(
    budget_id: uuid.UUID, data: BudgetUpdate, db: DbSession, current: Current
) -> BudgetOut:
    return service.update_budget(db, current.user, budget_id, data)


@router.delete(
    "/{budget_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Desactivar presupuesto"
)
def deactivate_budget(budget_id: uuid.UUID, db: DbSession, current: Current) -> Response:
    service.deactivate_budget(db, current.user, budget_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{budget_id}/impact", response_model=BudgetImpact, summary="Impacto actual")
def get_impact(budget_id: uuid.UUID, db: DbSession, current: Current) -> BudgetImpact:
    return service.get_impact(db, current.user, budget_id)
