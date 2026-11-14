"""Rutas de umbrales del CU08: /budgets/{budget_id}/thresholds."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.modules.alerts import service
from app.modules.alerts.schemas import (
    ThresholdCreate,
    ThresholdList,
    ThresholdOut,
    ThresholdReplace,
)
from app.modules.auth.deps import CurrentSession, get_current_session

router = APIRouter(prefix="/budgets/{budget_id}/thresholds", tags=["thresholds"])

DbSession = Annotated[Session, Depends(get_db)]
Current = Annotated[CurrentSession, Depends(get_current_session)]


@router.get("", response_model=ThresholdList, summary="Listar umbrales")
def list_thresholds(budget_id: uuid.UUID, db: DbSession, current: Current) -> ThresholdList:
    return ThresholdList(data=service.list_thresholds(db, current.user, budget_id))


@router.post(
    "", response_model=ThresholdOut, status_code=status.HTTP_201_CREATED, summary="Crear umbral"
)
def add_threshold(
    budget_id: uuid.UUID, data: ThresholdCreate, db: DbSession, current: Current
) -> ThresholdOut:
    return service.add_threshold(db, current.user, budget_id, data.percentage)


@router.put("", response_model=ThresholdList, summary="Reemplazar umbrales")
def replace_thresholds(
    budget_id: uuid.UUID, data: ThresholdReplace, db: DbSession, current: Current
) -> ThresholdList:
    return ThresholdList(
        data=service.replace_thresholds(db, current.user, budget_id, data.thresholds)
    )


@router.delete(
    "/{threshold_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Desactivar umbral"
)
def deactivate_threshold(
    budget_id: uuid.UUID, threshold_id: uuid.UUID, db: DbSession, current: Current
) -> Response:
    service.deactivate_threshold(db, current.user, budget_id, threshold_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
