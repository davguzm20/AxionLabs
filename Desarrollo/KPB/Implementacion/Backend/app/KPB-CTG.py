"""=============================================================================
KPB-CTG: MÓDULO DE TOPE DE GASTO (CU07)
=============================================================================
Este archivo representa el entregable oficial de Línea Base para el Caso de Uso CU07.

Objetivo:
Permitir que el usuario defina un tope de gasto por categoría, con periodo semanal,
mensual o personalizado y uno o varios umbrales, y que vea el consumo, el restante y
el porcentaje del periodo vigente.

Módulos y componentes articulados:
- Router: app.modules.budgets.router (GET/POST /budgets, GET/PATCH/DELETE /budgets/{id},
  GET /budgets/{id}/impact)
- Servicio: app.modules.budgets.service
- Schemas: app.modules.budgets.schemas
- Repositorio: app.modules.budgets.repository
- Periodos: app.modules.budgets.periods
- Umbrales (/budgets/{id}/thresholds): app.modules.alerts (KPB-MA, CU08)

Pendiente: validar tipo (gasto) y estado de la categoría cuando la tabla categories
tenga esas columnas (INVALID_CATEGORY_TYPE, CATEGORY_INACTIVE).
=============================================================================
"""

from app.modules.budgets.periods import current_period, has_started, today_lima
from app.modules.budgets.repository import (
    active_budget_for_category,
    consumed_in_period,
    get_budget,
    get_category,
    list_budgets,
)
from app.modules.budgets.router import router
from app.modules.budgets.schemas import (
    BudgetCategory,
    BudgetCreate,
    BudgetImpact,
    BudgetList,
    BudgetOut,
    BudgetUpdate,
)
from app.modules.budgets.service import (
    create_budget,
    deactivate_budget,
    get_impact,
    parse_amount,
    resolve_period,
    update_budget,
)
from app.modules.budgets.service import get_budget as get_budget_detail
from app.modules.budgets.service import list_budgets as list_budget_details

__all__ = [
    "BudgetCategory",
    "BudgetCreate",
    "BudgetImpact",
    "BudgetList",
    "BudgetOut",
    "BudgetUpdate",
    "active_budget_for_category",
    "consumed_in_period",
    "create_budget",
    "current_period",
    "deactivate_budget",
    "get_budget",
    "get_budget_detail",
    "get_category",
    "get_impact",
    "has_started",
    "list_budget_details",
    "list_budgets",
    "parse_amount",
    "resolve_period",
    "router",
    "today_lima",
    "update_budget",
]
