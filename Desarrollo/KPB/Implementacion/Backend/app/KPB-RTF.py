"""=============================================================================
KPB-RTF: COMPONENTE DE REGISTRO DE TRANSACCIÓN POR FOTO / OCR (CU04)
=============================================================================
Este archivo representa el entregable oficial de Línea Base para el Caso de Uso CU04.

Objetivo:
Permitir que un usuario capture o suba la imagen de un comprobante de pago (boleta o
factura en formato JPG o PNG). El sistema procesa la imagen exclusivamente en memoria
(sin guardarla en disco ni BD por privacidad RNF016), ejecuta visión artificial con OCR,
genera una vista previa temporal por 10 minutos (preview_id) y permite al usuario
revisar y confirmar los datos para persistir la transacción y actualizar el saldo.

Flujo en dos pasos (Regla BR-037):
1. POST /api/v1/transactions/receipt -> Extracción, visión y vista previa temporal.
2. POST /api/v1/transactions/receipt/confirm -> Confirmación explícita, guardado y saldo.

Módulos y componentes articulados:
- Router: app.modules.transactions.router (endpoints /receipt y /receipt/confirm)
- Servicio: app.modules.transactions.service (create_receipt_preview, confirm_receipt)
- Schemas: app.modules.transactions.schemas (ReceiptPreviewResponse, ReceiptConfirmRequest)
- Visión IA: app.integrations.ai.vision (extract_receipt_from_image)
- Almacén Temporal: app.integrations.redis.previews (ReceiptPreviewStore)
- Validador en Memoria: app.modules.transactions.image_validation (validate_and_prepare_image)
=============================================================================
"""

from app.integrations.ai.vision import ExtractedReceipt, extract_receipt_from_image
from app.integrations.redis.previews import ReceiptPreviewStore, get_preview_store
from app.modules.transactions.image_validation import ValidatedImage, validate_and_prepare_image
from app.modules.transactions.router import router
from app.modules.transactions.schemas import (
    ExtractedReceiptData,
    ReceiptConfirmRequest,
    ReceiptPreviewResponse,
    TextTransactionResponse,
    TransactionOut,
)
from app.modules.transactions.service import confirm_receipt, create_receipt_preview

__all__ = [
    # Router FastAPI con endpoints del CU04
    "router",
    # Lógica de servicio del CU04
    "create_receipt_preview",
    "confirm_receipt",
    # Modelos Pydantic del CU04
    "ExtractedReceiptData",
    "ReceiptPreviewResponse",
    "ReceiptConfirmRequest",
    "TextTransactionResponse",
    "TransactionOut",
    # Visión y validación de imagen
    "extract_receipt_from_image",
    "ExtractedReceipt",
    "validate_and_prepare_image",
    "ValidatedImage",
    # Almacén de vista previa
    "ReceiptPreviewStore",
    "get_preview_store",
]

