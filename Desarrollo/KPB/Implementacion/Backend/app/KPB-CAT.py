"""=============================================================================
KPB-CAT: MÓDULO DE CLASIFICACIÓN AUTOMÁTICA DE CATEGORÍAS (CU05)
=============================================================================
Este archivo representa el entregable oficial de Línea Base para el Caso de Uso CU05.

Objetivo:
Permitir que el sistema analice el concepto y comercio de una transacción y sugiera
automáticamente la categoría correspondiente empleando Inteligencia Artificial (OpenAI
gpt-4o-mini) con salida JSON estructurada y fallback heurístico peruano determinista.
Asimismo, provee la administración y catálogo completo de categorías de usuario y sistema.

Módulos y componentes articulados:
- Router: app.modules.categories.router (POST /categories/suggest, GET/POST /categories,
  GET/PATCH/DELETE /categories/{id})
- Servicio: app.modules.categories.service
- Schemas: app.modules.categories.schemas
- Repositorio: app.modules.categories.repository
- Clasificador IA: app.integrations.ai.classifier (Prompt oficial classify-category)
=============================================================================
"""

from app.integrations.ai.classifier import (
    CategoryClassifier,
    ClassificationResult,
    get_category_classifier,
)
from app.modules.categories.repository import (
    create_category as repo_create_category,
    delete_category as repo_delete_category,
    get_category_by_id,
    get_category_by_name,
    get_fallback_category,
    list_categories as repo_list_categories,
    resolve_icon,
    update_category as repo_update_category,
)
from app.modules.categories.router import router
from app.modules.categories.schemas import (
    CategoryCreate,
    CategoryItem,
    CategoryList,
    CategorySuggested,
    CategorySuggestRequest,
    CategorySuggestResponse,
    CategoryUpdate,
)
from app.modules.categories.service import (
    create_category,
    delete_category,
    get_category,
    list_categories,
    suggest_category,
    update_category,
)

__all__ = [
    # Router FastAPI
    "router",
    # Lógica de Servicio
    "suggest_category",
    "list_categories",
    "get_category",
    "create_category",
    "update_category",
    "delete_category",
    # Motor de Clasificación con IA
    "CategoryClassifier",
    "ClassificationResult",
    "get_category_classifier",
    # Modelos Pydantic
    "CategorySuggestRequest",
    "CategorySuggestResponse",
    "CategorySuggested",
    "CategoryItem",
    "CategoryList",
    "CategoryCreate",
    "CategoryUpdate",
    # Acceso a Datos
    "get_category_by_id",
    "get_category_by_name",
    "get_fallback_category",
    "repo_list_categories",
    "repo_create_category",
    "repo_update_category",
    "repo_delete_category",
    "resolve_icon",
]

