# KhipuBot - Backend

API del sistema de gestion de finanzas personales KhipuBot (KPB).

## Requisitos

- Python 3.14
- [uv](https://docs.astral.sh/uv/) 0.13.0 o superior
  (instalar con `curl -LsSf https://astral.sh/uv/install.sh | sh`)

## Ejecutar en local

```bash
uv sync
uv run uvicorn app.main:app --reload
```

## Donde probar

| Que | URL |
|---|---|
| Raiz | http://localhost:8000/ (redirige a /docs) |
| Health check | http://localhost:8000/health |
| Documentacion interactiva | http://localhost:8000/docs |
| Esquema OpenAPI | http://localhost:8000/openapi.json |

## Pruebas

```bash
uv run pytest
uv run pytest --cov=app
```
