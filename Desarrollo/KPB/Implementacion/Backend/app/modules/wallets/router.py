"""Rutas del módulo de Monederos (CU06).

- POST /api/v1/wallets: crea un monedero (API-16).
- GET /api/v1/wallets: lista los monederos del usuario (API-17).
- GET /api/v1/wallets/{wallet_id}: consulta un monedero (API-18).
"""

import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.modules.auth.deps import CurrentSession, get_current_session
from app.modules.wallets import service
from app.modules.wallets.schemas import (
    CreateWalletRequest,
    CreateWalletResponse,
    WalletListResponse,
    WalletOut,
)


def _no_store(response: Response) -> None:
    response.headers["Cache-Control"] = "no-store"


router = APIRouter(prefix="/wallets", tags=["wallets"], dependencies=[Depends(_no_store)])

DbSession = Annotated[Session, Depends(get_db)]
Current = Annotated[CurrentSession, Depends(get_current_session)]


@router.post("", status_code=status.HTTP_201_CREATED)
def create_wallet(
    data: CreateWalletRequest, db: DbSession, current: Current
) -> CreateWalletResponse:
    """CU06: crea un monedero con nombre, tipo, moneda y saldo inicial."""
    return service.create_wallet(db, current.user.user_id, data)


@router.get("")
def list_wallets(
    db: DbSession,
    current: Current,
    status: Literal["ACTIVE", "INACTIVE"] | None = None,
) -> WalletListResponse:
    return WalletListResponse(data=service.list_wallets(db, current.user.user_id, status))


@router.get("/{wallet_id}")
def get_wallet(wallet_id: uuid.UUID, db: DbSession, current: Current) -> WalletOut:
    return service.get_wallet(db, current.user.user_id, wallet_id)
