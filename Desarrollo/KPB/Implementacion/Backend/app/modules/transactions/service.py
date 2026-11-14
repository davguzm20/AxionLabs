"""KPB-RTT / KPB-RTV / KPB-RTF: Registro de transacciones por texto (CU02), voz (CU03) y foto (CU04).

Orquesta:
1. Extracción con IA (Texto libre y Visión multimodal).
2. Validaciones de negocio (monto existente, coherencia de moneda, fechas válidas, formato de imagen).
3. Clasificación de categoría con fallback a 'Otros'.
4. Manejo de vistas previas temporales en Redis (TTL 10 min) para voz y comprobantes.
5. Actualización atómica de saldos de monedero y persistencia en PostgreSQL.
"""

from __future__ import annotations

import logging
import uuid
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation
from zoneinfo import ZoneInfo

from sqlalchemy.exc import SQLAlchemyError
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
from app.integrations.redis.notifications import NotificationBus
from app.modules.alerts import service as alerts_service
from app.integrations.ai.transcription import transcribe
from app.integrations.ai.vision import extract_receipt_from_image
from app.integrations.redis.rate_limit import RateLimiter
from app.integrations.redis.previews import ReceiptPreviewStore
from app.modules.transactions import repository
from app.modules.alerts.schemas import AlertOut
from app.modules.categories import service as categories_service
from app.modules.categories.schemas import CategorySuggestRequest
from app.modules.transactions.audio_validation import (
    MAX_AUDIO_SECONDS,
    audio_too_long,
    validate_audio,
)
from app.modules.transactions.image_validation import validate_and_prepare_image
from app.modules.transactions.schemas import (
    CategoryInfo,
    ExtractedReceiptData,
    ReceiptConfirmRequest,
    ReceiptPreviewResponse,
    TextTransactionRequest,
    TextTransactionResponse,
    TransactionCorrectionRequest,
    TransactionOut,
    VoiceConfirmRequest,
    VoicePreviewResponse,
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


# =============================================================================
# CU02: Registro de Transacción por Texto Libre
# =============================================================================

def persist_confirmed(
    db: Session,
    user: User,
    transaction: Transaction,
    wallet: Wallet,
    balance_delta: Decimal,
    bus: NotificationBus | None,
) -> list[AlertOut]:
    """Guarda la transacción, actualiza el saldo y evalúa alertas en una sola transacción de BD.

    Si algo falla se revierte todo (07-architecture/backend.md). Las alertas se publican
    por SSE solo después del commit.
    """
    try:
        repository.save_transaction_and_update_balance(
            db=db,
            transaction=transaction,
            wallet=wallet,
            balance_delta=balance_delta,
        )
        alerts = alerts_service.evaluate_expense(db, transaction)
        db.commit()
    except SQLAlchemyError as error:
        db.rollback()
        # Solo el tipo: el mensaje de SQLAlchemy incluye los montos de la consulta.
        logger.error("No se pudo registrar la transacción: %s", type(error).__name__)
        raise AppError(500, "INTERNAL_ERROR", "Ocurrió un error. Intenta de nuevo.") from None
    db.refresh(transaction)
    db.refresh(wallet)

    if bus is not None:
        alerts_service.publish_alerts(bus, user.user_id, alerts)
    return alerts


def create_from_text(
    db: Session,
    user: User,
    data: TextTransactionRequest,
    bus: NotificationBus | None = None,
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

    # 10. Persistir, actualizar saldo y evaluar alertas (CU08) en una sola transacción de BD
    alerts = persist_confirmed(db, user, transaction, wallet, balance_delta, bus)

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
        alerts=alerts,
        message=message,
    )


def correct_transaction(
    db: Session,
    user: User,
    transaction_id: uuid.UUID,
    data: TransactionCorrectionRequest,
) -> TransactionOut:
    """Permite corregir concepto o categoría de una transacción existente (PATCH)."""
    transaction = repository.get_transaction_by_id(db, user.user_id, transaction_id)
    if transaction is None:
        raise AppError(404, "TRANSACTION_NOT_FOUND", "Transacción no encontrada.")

    if data.category_id is not None:
        category = repository.get_category_by_id(db, user.user_id, data.category_id)
        if category is None:
            raise AppError(422, "INVALID_CATEGORY", "La categoría seleccionada no existe.")
        transaction.category_id = category.category_id

    if data.concept is not None:
        clean_concept = data.concept.strip()
        if clean_concept:
            transaction.concept = clean_concept[:200]

    db.commit()
    db.refresh(transaction)

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


# =============================================================================
# CU04: Registro de Transacción por Foto / OCR (Paso 1: Vista Previa)
# =============================================================================

def create_receipt_preview(
    db: Session,
    user: User,
    file_bytes: bytes,
    filename: str | None,
    content_type: str | None,
    wallet_id: uuid.UUID | None,
    preview_store: ReceiptPreviewStore,
) -> ReceiptPreviewResponse:
    """Procesa una imagen en memoria, ejecuta visión OCR y genera un preview temporal (TTL 10 min).

    Reglas de KPB-Specs:
    - La foto nunca se guarda en disco ni en base de datos.
    - Se procesa y optimiza en memoria volátil.
    - Se almacena temporalmente en Redis (preview_id) para confirmación posterior.
    """
    # 1. Validar y optimizar imagen en memoria (dimensiones, formato, tamaño máx. 8 MB)
    validated = validate_and_prepare_image(
        file_bytes=file_bytes,
        filename=filename,
        declared_content_type=content_type,
    )

    # 2. Verificar que el usuario tenga un monedero activo
    wallet = repository.get_wallet(db, user.user_id, wallet_id)
    if wallet is None:
        raise AppError(
            409,
            "NO_ACTIVE_WALLET",
            "Crea o activa un monedero antes de escanear comprobantes.",
        )

    default_curr = "PEN" if wallet.currency == Currency.PEN else "USD"

    # 3. Invocar IA de visión (OpenAI Vision o Mock)
    extracted = extract_receipt_from_image(
        image_bytes=validated.data,
        mime_type=validated.mime_type,
        default_currency=default_curr,
    )

    # Si la imagen es ilegible o no es un comprobante
    if (
        extracted.confidence < 0.30
        and extracted.amount is None
        and not extracted.merchant
        and not extracted.ocr_text
    ):
        raise AppError(
            422,
            "IMAGE_UNCLEAR",
            "La imagen no es suficientemente clara o no parece un comprobante. Toma otra foto con mejor iluminación.",
        )

    # 4. Clasificar categoría tentativa
    category = None
    search_term = extracted.merchant or extracted.concept or ""
    if search_term:
        category = repository.get_category_by_name(db, user.user_id, search_term)

    if category is None:
        category = repository.get_fallback_category(db)

    # 5. Generar preview_id temporal
    preview_id = uuid.uuid4()
    formatted_amount = f"{extracted.amount:.2f}" if extracted.amount is not None else None
    tx_date_str = (
        extracted.transaction_date.isoformat()
        if extracted.transaction_date
        else datetime.now(LIMA_TZ).date().isoformat()
    )

    # 6. Estructura que se guarda en el almacén temporal (10 minutos)
    preview_payload = {
        "preview_id": str(preview_id),
        "amount": formatted_amount,
        "currency": extracted.currency or default_curr,
        "merchant": extracted.merchant,
        "ruc": extracted.ruc,
        "transaction_date": tx_date_str,
        "concept": extracted.concept or extracted.merchant or "Consumo de comprobante",
        "category_id": str(category.category_id),
        "category_name": category.name,
        "wallet_id": str(wallet.wallet_id),
        "ocr_text": extracted.ocr_text,
        "confidence": extracted.confidence,
    }

    # Guardar en Redis/memoria sin la imagen
    preview_store.save(preview_id, user.user_id, preview_payload, ttl_seconds=600)

    # 7. Armar respuesta de vista previa
    category_info = CategoryInfo(
        id=category.category_id,
        name=category.name,
        icon="tag",
    )

    extracted_out = ExtractedReceiptData(
        type="EXPENSE",
        amount=formatted_amount,
        currency=extracted.currency or default_curr,
        concept=preview_payload["concept"],
        merchant=extracted.merchant,
        ruc=extracted.ruc,
        transaction_date=tx_date_str,
        category=category_info,
    )

    return ReceiptPreviewResponse(
        preview_id=preview_id,
        ocr_text=extracted.ocr_text,
        extracted=extracted_out,
        confidence=extracted.confidence,
        requires_confirmation=True,
    )


# =============================================================================
# CU04: Registro de Transacción por Foto / OCR (Paso 2: Confirmación y Guardado)
# =============================================================================

def confirm_receipt(
    db: Session,
    user: User,
    data: ReceiptConfirmRequest,
    preview_store: ReceiptPreviewStore,
    bus: NotificationBus | None = None,
) -> TextTransactionResponse:
    """CU04 - Paso 2: Confirma y persiste una transacción a partir de un comprobante previo.

    1. Valida que el preview_id exista y pertenezca al usuario (no vencido, 10 min).
    2. Valida monto, monedero, moneda y fecha.
    3. Persiste en PostgreSQL con source_type = SourceType.OCR y source_input = ocr_text.
    4. Actualiza saldo del monedero atómicamente.
    5. Evalúa alertas de presupuesto.
    6. Elimina el preview temporal.
    """
    # 1. Recuperar datos temporales del preview
    preview_data = preview_store.get(data.preview_id, user.user_id)
    if preview_data is None:
        raise AppError(
            409,
            "PREVIEW_EXPIRED",
            "La vista previa del comprobante ha expirado o no existe. Por favor, sube la foto nuevamente.",
        )

    # 2. Validar monto
    try:
        amount = Decimal(str(data.amount).replace(",", "."))
        if amount <= Decimal("0.00"):
            raise ValueError()
    except Exception:
        raise AppError(
            422,
            "INVALID_AMOUNT",
            "El monto confirmado debe ser un valor positivo válido.",
        )

    # 3. Obtener el monedero con bloqueo pesimista
    wallet = repository.get_wallet(db, user.user_id, data.wallet_id, for_update=True)
    if wallet is None:
        raise AppError(
            409,
            "NO_ACTIVE_WALLET",
            "El monedero seleccionado no existe o está inactivo.",
        )

    # 4. Validar coherencia de moneda
    data_curr = data.currency.upper()
    if (data_curr == "PEN" and wallet.currency != Currency.PEN) or (
        data_curr == "USD" and wallet.currency != Currency.USD
    ):
        curr_name = "soles" if wallet.currency == Currency.PEN else "dólares"
        other_name = "dólares" if wallet.currency == Currency.PEN else "soles"
        raise AppError(
            422,
            "CURRENCY_MISMATCH",
            f"El monedero es en {curr_name}. Elige un monedero en {other_name} o registra el monto en {curr_name}.",
        )

    # 5. Validar fecha
    try:
        tx_date = date.fromisoformat(data.transaction_date)
    except ValueError:
        raise AppError(422, "INVALID_DATE", "Formato de fecha no válido. Usa YYYY-MM-DD.")
    _validate_transaction_date(tx_date)

    # 6. Validar categoría
    category = repository.get_category_by_id(db, user.user_id, data.category_id)
    if category is None:
        raise AppError(422, "INVALID_CATEGORY", "La categoría seleccionada no existe o no es válida.")

    # 7. Determinar tipo y saldo
    is_income = data.type.upper() == "INCOME"
    tx_type = TransactionType.INGRESO if is_income else TransactionType.GASTO
    balance_delta = amount if is_income else -amount

    transacted_datetime = datetime(
        tx_date.year, tx_date.month, tx_date.day, 12, 0, 0, tzinfo=LIMA_TZ
    )

    # 8. Crear transacción
    ocr_text = preview_data.get("ocr_text")
    transaction = Transaction(
        user_id=user.user_id,
        wallet_id=wallet.wallet_id,
        category_id=category.category_id,
        amount=amount,
        type=tx_type,
        currency=wallet.currency,
        concept=data.concept.strip() or "Comprobante escaneado",
        transacted_at=transacted_datetime,
        status=TransactionStatus.CONFIRMADA,
        source_input=ocr_text,
        source_type=SourceType.OCR,
    )

    # 9-10. Guardar, actualizar saldo, evaluar alertas y confirmar en una sola transacción de BD
    alerts = persist_confirmed(db, user, transaction, wallet, balance_delta, bus)

    # 11. Eliminar preview de Redis
    preview_store.delete(data.preview_id)

    # 12. Respuesta
    symbol = _get_currency_symbol(wallet.currency)
    formatted_amount = f"{transaction.amount:.2f}"
    formatted_balance = f"{wallet.current_balance:.2f}"
    merchant_info = f" ({data.merchant})" if data.merchant else ""
    message = (
        f"Registré {symbol} {formatted_amount} en {category.name}{merchant_info} a partir del comprobante."
    )

    return TextTransactionResponse(
        transaction=TransactionOut(
            id=transaction.transaction_id,
            type="INCOME" if transaction.type == TransactionType.INGRESO else "EXPENSE",
            amount=formatted_amount,
            currency=wallet.currency.value,
            concept=transaction.concept,
            merchant=data.merchant,
            transaction_date=tx_date.isoformat(),
            wallet_id=wallet.wallet_id,
            category=CategoryInfo(
                id=category.category_id,
                name=category.name,
                icon="tag",
            ),
            source="RECEIPT",
            needs_review=False,
            created_at=transaction.created_at.isoformat() if transaction.created_at else transacted_datetime.isoformat(),
        ),
        wallet_balance=formatted_balance,
        alerts=alerts,
        message=message,
    )


# =============================================================================
# CU03: Registro de Transacción por Voz
# =============================================================================

VOICE_REQUESTS_PER_MINUTE = 30
# Respuestas que no aportan contenido (12-prompts/system-prompts/transcribe.md).
FILLER_WORDS = {"mmm", "mm", "hmm", "eh", "ehh", "ehm", "ah", "ahh", "uh", "um", "este"}


def _unintelligible() -> AppError:
    return AppError(
        422,
        "AUDIO_UNINTELLIGIBLE",
        "No pude entender el audio. ¿Puedes repetirlo o escribirlo?",
    )


def clean_transcript(text: str) -> str:
    """Texto útil de la transcripción, o AUDIO_UNINTELLIGIBLE si no lo hay (BR-083)."""
    cleaned = " ".join(text.split())
    words = [w.strip(".,;:¡!¿?…").lower() for w in cleaned.split()]
    if len(cleaned) < 2 or all(not w or w in FILLER_WORDS for w in words):
        raise _unintelligible()
    return cleaned[:500]


def create_voice_preview(
    db: Session,
    user: User,
    audio: bytes,
    wallet_id: uuid.UUID | None,
    language: str,
    preview_store: ReceiptPreviewStore,
    rate_limiter: RateLimiter,
) -> VoicePreviewResponse:
    """CU03 - Paso 1: transcribe, extrae y clasifica sin guardar nada en la BD.

    El audio vive solo en memoria durante la petición; el preview guarda texto.
    """
    rate_limiter.hit("voice", user.user_id, VOICE_REQUESTS_PER_MINUTE)
    validated = validate_audio(audio)

    wallet = repository.get_wallet(db, user.user_id, wallet_id)
    if wallet is None:
        raise AppError(
            409, "NO_ACTIVE_WALLET", "Crea un monedero antes de registrar una transacción."
        )

    transcription = transcribe(validated.data, validated.mime_type, language)
    if (transcription.duration_seconds or 0) > MAX_AUDIO_SECONDS:
        raise audio_too_long()
    transcript = clean_transcript(transcription.text)

    extracted = extract_transaction_from_text(
        text=transcript, default_currency=wallet.currency.value
    )
    tx_type = "INCOME" if extracted.type == "INCOME" else "EXPENSE"
    concept = (extracted.concept or transcript)[:200]
    suggestion = categories_service.suggest_category(
        db,
        user,
        CategorySuggestRequest(type=tx_type, concept=concept, merchant=extracted.merchant),
    )

    # Sin monto el preview igual se muestra: el usuario lo completa antes de confirmar.
    amount = f"{extracted.amount:.2f}" if extracted.amount and extracted.amount > 0 else None
    tx_date = (extracted.transaction_date or datetime.now(LIMA_TZ).date()).isoformat()
    currency = (extracted.currency or wallet.currency.value).upper()

    preview_id = uuid.uuid4()
    preview_store.save(
        preview_id,
        user.user_id,
        {"transcript": transcript, "wallet_id": str(wallet.wallet_id)},
        ttl_seconds=600,
    )

    return VoicePreviewResponse(
        preview_id=preview_id,
        transcript=transcript,
        wallet_id=wallet.wallet_id,
        extracted=ExtractedReceiptData(
            type=tx_type,
            amount=amount,
            currency=currency,
            concept=concept,
            merchant=extracted.merchant,
            ruc=None,
            transaction_date=tx_date,
            category=CategoryInfo(
                id=suggestion.category.id,
                name=suggestion.category.name,
                icon=suggestion.category.icon or "tag",
            ),
        ),
        confidence=round(min(max(extracted.confidence, 0.0), 1.0), 2),
        requires_confirmation=True,
    )


def _parse_confirmed_amount(raw: str) -> Decimal:
    try:
        amount = Decimal(raw.strip())
    except (InvalidOperation, AttributeError):
        amount = None
    if amount is None or not amount.is_finite() or not Decimal(0) < amount <= Decimal("99999999.99"):
        raise AppError(422, "INVALID_AMOUNT", "Ingresa un monto válido (máximo 99,999,999.99).")
    if amount.as_tuple().exponent < -2:
        raise AppError(422, "INVALID_AMOUNT_PRECISION", "Usa como máximo dos decimales.")
    return amount.quantize(Decimal("0.01"))


def confirm_voice(
    db: Session,
    user: User,
    data: VoiceConfirmRequest,
    preview_store: ReceiptPreviewStore,
    bus: NotificationBus | None = None,
) -> TextTransactionResponse:
    """CU03 - Paso 2: guarda los datos revisados por el usuario.

    El preview se usa una sola vez: un reintento después de guardar responde
    PREVIEW_EXPIRED en vez de duplicar la transacción.
    """
    expired = AppError(
        409, "PREVIEW_EXPIRED", "La vista previa expiró. Graba la nota de voz otra vez."
    )
    preview = preview_store.get(data.preview_id, user.user_id)
    if preview is None:
        raise expired
    if not preview_store.lock(data.preview_id):
        raise AppError(
            409, "IDEMPOTENCY_IN_PROGRESS", "La solicitud está en proceso. Espera un momento."
        )
    try:
        # Releído con el candado tomado: otra confirmación pudo terminar entre medio.
        if preview_store.get(data.preview_id, user.user_id) is None:
            raise expired
        response = _save_voice_transaction(db, user, data, preview["transcript"], bus)
        preview_store.delete(data.preview_id)
        return response
    finally:
        preview_store.unlock(data.preview_id)


def _save_voice_transaction(
    db: Session,
    user: User,
    data: VoiceConfirmRequest,
    transcript: str,
    bus: NotificationBus | None,
) -> TextTransactionResponse:
    amount = _parse_confirmed_amount(data.amount)

    wallet = repository.get_wallet(db, user.user_id, data.wallet_id, for_update=True)
    if wallet is None:
        raise AppError(
            409, "NO_ACTIVE_WALLET", "El monedero seleccionado no existe o está inactivo."
        )
    if data.currency != wallet.currency.value:
        name = "soles" if wallet.currency == Currency.PEN else "dólares"
        raise AppError(
            422,
            "CURRENCY_MISMATCH",
            f"El monedero es en {name}. Elige otro monedero o registra el monto en {name}.",
        )
    _validate_transaction_date(data.transaction_date)

    category = repository.get_category_by_id(db, user.user_id, data.category_id)
    if category is None:
        raise AppError(422, "INVALID_CATEGORY", "Selecciona una categoría válida.")

    is_income = data.type == "INCOME"
    tx_date = data.transaction_date
    transacted_at = datetime(tx_date.year, tx_date.month, tx_date.day, 12, tzinfo=LIMA_TZ)
    transaction = Transaction(
        user_id=user.user_id,
        wallet_id=wallet.wallet_id,
        category_id=category.category_id,
        amount=amount,
        type=TransactionType.INGRESO if is_income else TransactionType.GASTO,
        currency=wallet.currency,
        concept=data.concept.strip(),
        transacted_at=transacted_at,
        status=TransactionStatus.CONFIRMADA,
        source_input=transcript,
        source_type=SourceType.VOZ,
    )
    alerts = persist_confirmed(
        db, user, transaction, wallet, amount if is_income else -amount, bus
    )

    symbol = _get_currency_symbol(wallet.currency)
    return TextTransactionResponse(
        transaction=TransactionOut(
            id=transaction.transaction_id,
            type=data.type,
            amount=f"{transaction.amount:.2f}",
            currency=wallet.currency.value,
            concept=transaction.concept,
            merchant=data.merchant,
            transaction_date=tx_date.isoformat(),
            wallet_id=wallet.wallet_id,
            category=CategoryInfo(id=category.category_id, name=category.name, icon="tag"),
            source="VOICE",
            needs_review=False,
            created_at=(transaction.created_at or transacted_at).isoformat(),
        ),
        wallet_balance=f"{wallet.current_balance:.2f}",
        alerts=alerts,
        message=f"Listo, registré {symbol} {transaction.amount:.2f} en {category.name}.",
    )
