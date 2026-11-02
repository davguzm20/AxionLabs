"""KPB-RTT: Lógica de negocio del Caso de Uso CU02 (Registro de Transacción por Texto).

Orquesta:
1. Extracción con IA (OpenAI o Mock).
2. Validaciones de negocio (monto existente, coherencia de moneda, fechas válidas).
3. Clasificación de categoría con fallback a 'Otros' y needs_review.
4. Actualización atómica de saldos de monedero y persistencia en PostgreSQL.
"""

from __future__ import annotations

import logging
import uuid
from datetime import date, datetime, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.entities import (
    Category,
    Currency,
    SourceType,
    Transaction,
    TransactionStatus,
    TransactionType,
    User,
    Wallet,
)
from app.integrations.ai.extractor import extract_transaction_from_text
from app.modules.transactions import repository
from app.modules.transactions.schemas import (
    CategoryInfo,
    TextTransactionRequest,
    TextTransactionResponse,
    TransactionCorrectionRequest,
    TransactionOut,
)

logger = logging.getLogger(__name__)
LIMA_TZ = ZoneInfo("America/Lima")


def _get_currency_symbol(currency: Currency) -> str:
    """Devuelve el símbolo monetario de uso habitual."""
    return "S/" if currency == Currency.PEN else "$"


def _validate_transaction_date(tx_date: date) -> None:
    """Regla BR-032: La fecha no puede ser más de 1 día en el futuro ni anterior a 5 años."""
    today = datetime.now(LIMA_TZ).date()
    max_future = today + timedelta(days=1)
    min_past = today - timedelta(days=365 * 5)

    if tx_date > max_future or tx_date < min_past:
        raise AppError(
            422,
            "INVALID_DATE",
            "La fecha no puede ser más de un día futura ni anterior a 5 años.",
        )


def create_from_text(
    db: Session,
    user: User,
    data: TextTransactionRequest,
) -> TextTransactionResponse:
    """Ejecuta el flujo completo del CU02 a partir del texto ingresado por el usuario."""
    # 1. Validar longitud del texto de entrada
    raw_text = data.text.strip()
    if not (1 <= len(raw_text) <= 500):
        raise AppError(
            422,
            "VALIDATION_ERROR",
            "El texto debe tener entre 1 y 500 caracteres.",
        )

    # 2. Obtener el monedero activo con bloqueo pesimista (FOR UPDATE) para garantizar atomicidad
    wallet = repository.get_wallet(db, user.user_id, data.wallet_id, for_update=True)
    if wallet is None:
        raise AppError(
            409,
            "NO_ACTIVE_WALLET",
            "Crea un monedero antes de registrar una transacción.",
        )

    default_currency_str = "PEN" if wallet.currency == Currency.PEN else "USD"

    # 3. Invocar al servicio de IA (OpenAI o Mock)
    extracted = extract_transaction_from_text(
        text=raw_text,
        client_timezone=data.client_timezone,
        default_currency=default_currency_str,
    )

    # 4. Validar que la IA haya detectado un monto válido (Regla BR-038)
    if extracted.amount is None or extracted.amount <= Decimal("0.00"):
        raise AppError(
            422,
            "AMOUNT_NOT_FOUND",
            "No pude identificar el monto. ¿Cuánto fue el gasto o ingreso?",
        )

    # 5. Validar coherencia de moneda entre la transacción y el monedero (Regla BR-041)
    if extracted.currency:
        extracted_curr = extracted.currency.upper()
        if (extracted_curr == "PEN" and wallet.currency != Currency.PEN) or (
            extracted_curr == "USD" and wallet.currency != Currency.USD
        ):
            curr_name = "soles" if wallet.currency == Currency.PEN else "dólares"
            other_name = "dólares" if wallet.currency == Currency.PEN else "soles"
            raise AppError(
                422,
                "CURRENCY_MISMATCH",
                f"El monedero es en {curr_name}. Elige un monedero en {other_name} o registra el monto en {curr_name}.",
            )

    # 6. Validar fecha (Regla BR-032)
    tx_date = extracted.transaction_date or datetime.now(LIMA_TZ).date()
    _validate_transaction_date(tx_date)

    # 7. Asignar categoría (CU05)
    # Busca por concepto o palabra clave; si la confianza es baja o no encuentra, usa 'Otros'
    category = None
    needs_review = False

    if extracted.concept:
        category = repository.get_category_by_name(db, user.user_id, extracted.concept)

    if category is None or extracted.confidence < 0.60:
        category = repository.get_fallback_category(db)
        needs_review = True

    # 8. Determinar tipo y delta para el saldo del monedero
    if extracted.type == "INCOME":
        tx_type = TransactionType.INGRESO
        balance_delta = extracted.amount
    else:
        tx_type = TransactionType.GASTO
        balance_delta = -extracted.amount

    # 9. Crear la entidad Transaction
    transacted_datetime = datetime(
        tx_date.year, tx_date.month, tx_date.day, 12, 0, 0, tzinfo=LIMA_TZ
    )

    transaction = Transaction(
        user_id=user.user_id,
        wallet_id=wallet.wallet_id,
        category_id=category.category_id,
        amount=extracted.amount,
        type=tx_type,
        currency=wallet.currency,
        concept=extracted.concept or "Gasto registrado por texto",
        transacted_at=transacted_datetime,
        status=TransactionStatus.CONFIRMADA,
        source_input=raw_text,
        source_type=SourceType.TEXTO,
    )

    # 10. Persistir y actualizar saldo atómicamente
    repository.save_transaction_and_update_balance(
        db=db,
        transaction=transaction,
        wallet=wallet,
        balance_delta=balance_delta,
    )

    # 11. Armar respuesta según contrato OpenAPI
    symbol = _get_currency_symbol(wallet.currency)
    formatted_amount = f"{transaction.amount:.2f}"
    formatted_balance = f"{wallet.current_balance:.2f}"
    formatted_date = tx_date.isoformat()
    created_at_iso = transaction.created_at.isoformat() if transaction.created_at else transacted_datetime.isoformat()

    message = (
        f"Registré {symbol} {formatted_amount} en {category.name}. "
        "Si algo no está bien, puedes corregirlo."
    )

    return TextTransactionResponse(
        transaction=TransactionOut(
            id=transaction.transaction_id,
            type="INCOME" if transaction.type == TransactionType.INGRESO else "EXPENSE",
            amount=formatted_amount,
            currency=wallet.currency.value,
            concept=transaction.concept,
            merchant=extracted.merchant,
            transaction_date=formatted_date,
            wallet_id=wallet.wallet_id,
            category=CategoryInfo(
                id=category.category_id,
                name=category.name,
                icon="tag",
            ),
            source="TEXT",
            needs_review=needs_review,
            created_at=created_at_iso,
        ),
        wallet_balance=formatted_balance,
        alerts=[],  # Slice 004 no emite alertas (se integran en Slice 008)
        message=message,
    )


def correct_transaction(
    db: Session,
    user: User,
    transaction_id: uuid.UUID,
    data: TransactionCorrectionRequest,
) -> TransactionOut:
    """Permite corregir concepto o categoría de una transacción existente (PATCH).

    Regla BR-043/044: No altera montos ni saldos del monedero.
    """
    transaction = repository.get_transaction_by_id(db, user.user_id, transaction_id)
    if transaction is None:
        raise AppError(404, "TRANSACTION_NOT_FOUND", "Transacción no encontrada.")

    # 1. Si se solicita cambio de categoría, validar existencia
    if data.category_id is not None:
        category = repository.get_category_by_id(db, user.user_id, data.category_id)
        if category is None:
            raise AppError(422, "INVALID_CATEGORY", "La categoría seleccionada no existe.")
        transaction.category_id = category.category_id

    # 2. Si se solicita cambio de concepto, actualizarlo
    if data.concept is not None:
        clean_concept = data.concept.strip()
        if clean_concept:
            transaction.concept = clean_concept[:200]

    db.commit()
    db.refresh(transaction)

    # Cargar datos de la categoría para responder
    current_category = repository.get_category_by_id(db, user.user_id, transaction.category_id)
    cat_name = current_category.name if current_category else "Otros"

    tx_date_str = transaction.transacted_at.date().isoformat()
    created_str = transaction.created_at.isoformat() if transaction.created_at else tx_date_str

    return TransactionOut(
        id=transaction.transaction_id,
        type="INCOME" if transaction.type == TransactionType.INGRESO else "EXPENSE",
        amount=f"{transaction.amount:.2f}",
        currency=transaction.currency.value,
        concept=transaction.concept,
        merchant=None,
        transaction_date=tx_date_str,
        wallet_id=transaction.wallet_id,
        category=CategoryInfo(
            id=transaction.category_id,
            name=cat_name,
            icon="tag",
        ),
        source="TEXT",
        needs_review=False,
        created_at=created_str,
    )

