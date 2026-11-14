from fastapi import FastAPI
from fastapi.responses import RedirectResponse

from app.core.errors import register_error_handlers
from app.modules.alerts.router import router as thresholds_router
from app.modules.auth.router import router as auth_router
from app.modules.budgets.router import router as budgets_router
from app.modules.categories.router import router as categories_router
from app.modules.notifications.router import router as notifications_router
from app.modules.transactions.router import router as transactions_router
from app.modules.wallets.router import router as wallets_router

# Metadatos OpenAPI para documentación interactiva en Swagger (/docs) y ReDoc (/redoc)
API_DESCRIPTION = """
**KhipuBot API** es el backend REST para el asistente inteligente de finanzas personales.

### Autenticación
Todos los endpoints protegidos requieren el encabezado HTTP:
`Authorization: Bearer <access_token>` (obtenido mediante `/api/v1/auth/login` o `/api/v1/auth/register`).

### Casos de Uso cubiertos
- **CU01:** Registro, inicio de sesión, cierre de sesión y perfil.
- **CU02:** Registro de transacciones mediante texto en lenguaje natural (IA).
- **CU03:** Registro de transacciones mediante voz (transcripción + confirmación).
- **CU04:** Registro de transacciones mediante foto de comprobante / OCR (visión + confirmación).
- **CU05:** Clasificación automática de categorías con IA y administración de catálogo.
- **CU06:** Creación y consulta de monederos virtuales.
- **CU07:** Definición de presupuestos (topes de gasto) y cálculo de impacto.
- **CU08:** Gestión de umbrales de alerta y notificaciones en tiempo real (SSE).
"""

OPENAPI_TAGS = [
    {
        "name": "auth",
        "description": "CU01 — Registro de cuentas, autenticación JWT, cierre de sesión y perfil.",
    },
    {
        "name": "transactions",
        "description": "CU02, CU03 y CU04 — Registro por texto natural, voz y comprobantes OCR; consulta y corrección.",
    },
    {
        "name": "categories",
        "description": "CU05 — Clasificación automática con IA y gestión de categorías del sistema y de usuario.",
    },
    {
        "name": "wallets",
        "description": "CU06 — Creación, listado y consulta de monederos virtuales (PEN / USD).",
    },
    {
        "name": "budgets",
        "description": "CU07 — Topes de gasto por categoría, periodos y evaluación de consumo.",
    },
    {
        "name": "thresholds",
        "description": "CU08 — Configuración de porcentajes de umbral de alerta por presupuesto.",
    },
    {
        "name": "notifications",
        "description": "CU08 — Listado, lectura y transmisión de alertas en tiempo real (SSE).",
    },
]

app = FastAPI(
    title="KhipuBot API",
    version="0.1.0",
    description=API_DESCRIPTION,
    openapi_tags=OPENAPI_TAGS,
    contact={
        "name": "AxionLabs — Proyecto KhipuBot",
    },
)
app.openapi_version = "3.0.3"

# Registro de manejadores de error globales de la API
register_error_handlers(app)

# Registro de módulos funcionales (CU)
app.include_router(auth_router, prefix="/api/v1")
app.include_router(categories_router, prefix="/api/v1")
app.include_router(transactions_router, prefix="/api/v1")
app.include_router(budgets_router, prefix="/api/v1")
app.include_router(thresholds_router, prefix="/api/v1")
app.include_router(notifications_router, prefix="/api/v1")
app.include_router(wallets_router, prefix="/api/v1")


@app.api_route("/", methods=["GET", "HEAD"], include_in_schema=False)
def root() -> RedirectResponse:
    return RedirectResponse("/docs", status_code=302)


@app.get("/health")
def health() -> dict[str, str]:
    """Health check del servicio. No consulta la base de datos."""
    return {"status": "ok", "service": "kpb-backend"}
