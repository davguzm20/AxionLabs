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

app = FastAPI(
    title="KhipuBot API",
    version="0.1.0",
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
