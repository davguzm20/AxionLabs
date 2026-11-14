"""=============================================================================
KPB-API: API REST DOCUMENTADA Y FUNCIONAL 
=============================================================================
Este archivo representa el entregable oficial de Línea Base para la API REST
del sistema KhipuBot, implementada con FastAPI y documentada con OpenAPI 3.0.3.

Objetivo:
Exponer de manera unificada, funcional y documentada todos los endpoints que
soportan los Casos de Uso CU01 a CU08, con validación de esquemas Pydantic,
manejo estandarizado de errores y documentación interactiva en /docs y /redoc.

Módulos y componentes articulados:
- Aplicación principal: app.main (app, health, root, OpenAPI metadata)
- Manejo de errores: app.core.errors (register_error_handlers)
- CU01 Autenticación: app.modules.auth.router (/api/v1/auth)
- CU02, CU03 y CU04 Transacciones: app.modules.transactions.router (/api/v1/transactions)
- CU05 Categorías e IA: app.modules.categories.router (/api/v1/categories)
- CU06 Monederos: app.modules.wallets.router (/api/v1/wallets)
- CU07 Presupuestos: app.modules.budgets.router (/api/v1/budgets)
- CU08 Umbrales y Notificaciones: app.modules.alerts.router &
  app.modules.notifications.router (/api/v1/budgets/{id}/thresholds, /api/v1/notifications)

Ejecución directa:
    uvicorn app.KPB-API:app --reload --port 8000
=============================================================================
"""

from app.core.errors import register_error_handlers
from app.main import (
    API_DESCRIPTION,
    OPENAPI_TAGS,
    app,
    auth_router,
    budgets_router,
    categories_router,
    health,
    notifications_router,
    root,
    thresholds_router,
    transactions_router,
    wallets_router,
)

__all__ = [
    # Instancia principal de FastAPI
    "app",
    # Metadatos y documentación OpenAPI / Swagger
    "API_DESCRIPTION",
    "OPENAPI_TAGS",
    # Endpoints base
    "root",
    "health",
    # Manejadores globales
    "register_error_handlers",
    # Routers por módulo funcional (CU01 - CU08)
    "auth_router",
    "transactions_router",
    "categories_router",
    "wallets_router",
    "budgets_router",
    "thresholds_router",
    "notifications_router",
]

