"""=============================================================================
KPB-RTT: COMPONENTE DE REGISTRO DE TRANSACCIÓN POR TEXTO (CU02)
=============================================================================
Este archivo representa el entregable oficial de Línea Base para el Caso de Uso CU02.

Objetivo:
Permitir que un usuario registre gastos o ingresos escribiendo frases en lenguaje
natural (ej: 'Gasté 15 soles en el menú'). El sistema procesa la frase mediante IA,
asigna la categoría correspondiente, actualiza el saldo del monedero de forma atómica
y persiste la transacción.

Módulos y componentes articulados:
- Router: app.modules.transactions.router
- Servicio: app.modules.transactions.service
- Schemas: app.modules.transactions.schemas
- Repositorio: app.modules.transactions.repository
- Extractor IA: app.integrations.ai.extractor
=============================================================================
"""

from app.modules.transactions.repository import (
    get_category_by_id,
    get_category_by_name,
    get_fallback_category,
    get_transaction_by_id,
    get_wallet,
    save_transaction_and_update_balance,
)
from app.modules.transactions.router import router
from app.modules.transactions.schemas import (
    CategoryInfo,
    TextTransactionRequest,
    TextTransactionResponse,
    TransactionCorrectionRequest,
    TransactionOut,
)
from app.modules.transactions.service import correct_transaction, create_from_text

__all__ = [
    # Router FastAPI
    "router",
    # Funciones de servicio
    "create_from_text",
    "correct_transaction",
    # Modelos Pydantic
    "TextTransactionRequest",
    "TextTransactionResponse",
    "TransactionCorrectionRequest",
    "TransactionOut",
    "CategoryInfo",
    # Acceso a datos
    "get_wallet",
    "get_category_by_name",
    "get_fallback_category",
    "get_category_by_id",
    "get_transaction_by_id",
    "save_transaction_and_update_balance",
]

