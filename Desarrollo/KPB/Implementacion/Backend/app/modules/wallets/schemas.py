"""Modelos Pydantic del módulo de Monederos (CU06).

Montos como string con dos decimales ("200.00") e identificadores UUID,
según KPB-API (API-16, API-17 y API-18).
"""

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class CreateWalletRequest(BaseModel):
    """Payload para crear un monedero.

    El nombre, el tipo, la moneda y el saldo se validan en el servicio para
    responder WALLET_NAME_EMPTY, INITIAL_BALANCE_INVALID, etc.
    """

    model_config = ConfigDict(extra="ignore")

    name: str
    type: str
    currency: str
    initial_balance: str | None = None


class WalletOut(BaseModel):
    id: uuid.UUID
    name: str
    type: str
    currency: str
    initial_balance: str
    # balance y current_balance llevan el mismo valor: el frontend lee cualquiera
    balance: str
    current_balance: str
    is_default: bool
    status: str
    has_transactions: bool
    transaction_count: int
    created_at: datetime


class CreateWalletResponse(BaseModel):
    wallet: WalletOut
    confirmation_message: str


class WalletListResponse(BaseModel):
    data: list[WalletOut]
