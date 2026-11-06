"""Rutas de notificaciones del CU08."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse
from redis import asyncio as aioredis
from sqlalchemy.orm import Session

from app.database import get_db
from app.entities import NotificationStatus
from app.integrations.redis.notifications import NotificationBus, get_notification_bus
from app.modules.auth.deps import CurrentSession, get_current_session
from app.modules.notifications import service, sse
from app.modules.notifications.schemas import (
    MessageOut,
    NotificationList,
    NotificationOut,
)

router = APIRouter(prefix="/notifications", tags=["notifications"])

DbSession = Annotated[Session, Depends(get_db)]
Current = Annotated[CurrentSession, Depends(get_current_session)]
Bus = Annotated[NotificationBus, Depends(get_notification_bus)]
StreamClient = Annotated[aioredis.Redis, Depends(sse.get_stream_client)]


@router.get("", response_model=NotificationList, summary="Listar notificaciones")
def list_notifications(
    db: DbSession,
    current: Current,
    status: NotificationStatus | None = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
) -> NotificationList:
    return service.list_notifications(db, current.user, status, page, page_size)


@router.patch("/read-all", response_model=MessageOut, summary="Marcar todas como leídas")
def mark_all_read(db: DbSession, current: Current) -> MessageOut:
    service.mark_all_read(db, current.user)
    return MessageOut(message="Notificaciones marcadas como leídas.")


@router.patch(
    "/{notification_id}/read", response_model=NotificationOut, summary="Marcar una como leída"
)
def mark_read(
    notification_id: uuid.UUID, db: DbSession, current: Current, bus: Bus
) -> NotificationOut:
    return service.mark_read(db, current.user, notification_id, bus)


@router.get("/stream", summary="Eventos de notificaciones en tiempo real (SSE)")
async def stream(db: DbSession, current: Current, client: StreamClient) -> StreamingResponse:
    user_id = current.user.user_id
    # La sesion de BD vive hasta que termina la respuesta: sin esto, cada stream
    # abierto retendria una de las pocas conexiones del pool.
    await run_in_threadpool(db.close)
    events = await sse.open_stream(client, user_id, current.session_id, sse.HEARTBEAT_SECONDS)
    return StreamingResponse(
        events,
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
