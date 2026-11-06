"""=============================================================================
KPB-MA: MÓDULO DE ALERTAS DE UMBRAL (CU08)
=============================================================================
Este archivo representa el entregable oficial de Línea Base para el Caso de Uso CU08.

Objetivo:
Cada vez que el usuario registra un gasto, comparar el consumo acumulado del periodo
con los umbrales de sus presupuestos activos y emitir, sin duplicar, una alerta por
cada umbral cruzado: se guarda junto con su notificación, se devuelve en la respuesta
del gasto y se envía en tiempo real por SSE.

Módulos y componentes articulados:
- Evaluación y umbrales: app.modules.alerts.service
- Rutas de umbrales: app.modules.alerts.router
- Bandeja: app.modules.notifications.service, app.modules.notifications.router
- SSE: app.modules.notifications.sse, app.integrations.redis.notifications
- Periodo y consumo (parte mínima del CU07): app.modules.budgets
- Esquema de base de datos: migrations/KPB-MA-001-alertas.sql

Pendiente: correo de alertas (T-008-12, T-008-13 y T-008-14).
=============================================================================
"""

from app.integrations.redis.notifications import NotificationBus, get_notification_bus
from app.modules.alerts.router import router as thresholds_router
from app.modules.alerts.schemas import (
    AlertOut,
    ThresholdCreate,
    ThresholdList,
    ThresholdOut,
    ThresholdReplace,
)
from app.modules.alerts.service import (
    add_threshold,
    build_body,
    build_title,
    deactivate_threshold,
    evaluate_expense,
    list_thresholds,
    publish_alerts,
    replace_thresholds,
)
from app.modules.budgets.periods import current_period
from app.modules.budgets.repository import (
    active_budgets_for_expense,
    consumed_in_period,
)
from app.modules.notifications.router import router as notifications_router
from app.modules.notifications.schemas import NotificationList, NotificationOut
from app.modules.notifications.service import (
    list_notifications,
    mark_all_read,
    mark_read,
)
from app.modules.notifications.sse import open_stream

__all__ = [
    "AlertOut",
    "NotificationBus",
    "NotificationList",
    "NotificationOut",
    "ThresholdCreate",
    "ThresholdList",
    "ThresholdOut",
    "ThresholdReplace",
    "active_budgets_for_expense",
    "add_threshold",
    "build_body",
    "build_title",
    "consumed_in_period",
    "current_period",
    "deactivate_threshold",
    "evaluate_expense",
    "get_notification_bus",
    "list_notifications",
    "list_thresholds",
    "mark_all_read",
    "mark_read",
    "notifications_router",
    "open_stream",
    "publish_alerts",
    "replace_thresholds",
    "thresholds_router",
]
