from fastapi import FastAPI
from fastapi.responses import RedirectResponse

from app.core.errors import register_error_handlers
from app.modules.auth.router import router as auth_router

app = FastAPI(
    title="KhipuBot API",
    version="0.1.0",
)
app.openapi_version = "3.0.3"
register_error_handlers(app)
app.include_router(auth_router, prefix="/api/v1")


@app.api_route("/", methods=["GET", "HEAD"], include_in_schema=False)
def root() -> RedirectResponse:
    return RedirectResponse("/docs", status_code=302)


@app.get("/health")
def health() -> dict[str, str]:
    """Health check del servicio. No consulta la base de datos."""
    return {"status": "ok", "service": "kpb-backend"}
