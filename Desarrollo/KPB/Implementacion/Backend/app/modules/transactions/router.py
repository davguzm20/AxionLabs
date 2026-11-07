"""Controlador FastAPI (Router) para el módulo de Transacciones (CU02).

Rutas expuestas:
- POST /api/v1/transactions/text: Registra una transacción procesando texto libre con IA.
- PATCH /api/v1/transactions/{transaction_id}: Corrige concepto o categoría de una transacción.
- GET /api/v1/transactions/{transaction_id}: Consulta una transacción específica.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Header, Response, status
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.database import get_db
from app.modules.auth.deps import CurrentSession, get_current_session
from app.modules.transactions import repository, service
from app.modules.transactions.schemas import (
    CategoryInfo,
    TextTransactionRequest,
    TextTransactionResponse,
    TransactionCorrectionRequest,
    TransactionOut,
)


def _no_cache(response: Response) -> None:
    """Evita cachear respuestas de transacciones financieras."""
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"


router = APIRouter(
    prefix="/transactions",
    tags=["transactions"],
    dependencies=[Depends(_no_cache)],
)

# Inyección de dependencias tipadas
DbSession = Annotated[Session, Depends(get_db)]
Current = Annotated[CurrentSession, Depends(get_current_session)]


@router.post(
    "/text",
    response_model=TextTransactionResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Registrar transacción por texto libre (CU02)",
)
def create_transaction_from_text(
    data: TextTransactionRequest,
    db: DbSession,
    current: Current,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> TextTransactionResponse:
    """CU02: El usuario escribe una frase (ej: 'Gasté 15 soles en almuerzo'),

    el sistema extrae la información con IA, clasifica la categoría, guarda la transacción
    y descuenta el monto del saldo del monedero.
    """
    return service.create_from_text(
        db=db,
        user=current.user,
        data=data,
    )


@router.patch(
    "/{transaction_id}",
    response_model=TransactionOut,
    summary="Corregir categoría o concepto de una transacción",
)
def patch_transaction(
    transaction_id: uuid.UUID,
    data: TransactionCorrectionRequest,
    db: DbSession,
    current: Current,
) -> TransactionOut:
    """Permite al usuario corregir la categoría o el concepto sugerido por la IA.

    No altera los montos ni el saldo del monedero.
    """
    return service.correct_transaction(
        db=db,
        user=current.user,
        transaction_id=transaction_id,
        data=data,
    )


@router.get(
    "/{transaction_id}",
    response_model=TransactionOut,
    summary="Consultar una transacción por ID",
)
def get_transaction(
    transaction_id: uuid.UUID,
    db: DbSession,
    current: Current,
) -> TransactionOut:
    """Obtiene los datos de una transacción existente."""
    transaction = repository.get_transaction_by_id(db, current.user.user_id, transaction_id)
    if transaction is None:
        raise AppError(404, "TRANSACTION_NOT_FOUND", "Transacción no encontrada.")

    category_name = transaction.category.name if transaction.category else "Otros"
    tx_date_str = transaction.transacted_at.date().isoformat()
    created_str = transaction.created_at.isoformat() if transaction.created_at else tx_date_str

    return TransactionOut(
        id=transaction.transaction_id,
        type="INCOME" if transaction.type.value in ("INGRESO", "income") else "EXPENSE",
        amount=f"{transaction.amount:.2f}",
        currency=transaction.currency.value,
        concept=transaction.concept,
        merchant=None,
        transaction_date=tx_date_str,
        wallet_id=transaction.wallet_id,
        category=CategoryInfo(
            id=transaction.category_id,
            name=category_name,
            icon="tag",
        ),
        source="TEXT",
        needs_review=False,
        created_at=created_str,
    )

