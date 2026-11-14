"""Contratos de la bandeja de notificaciones (04-api/endpoints/notifications.md)."""

from __future__ import annotations

import uuid

from pydantic import BaseModel

from app.entities import Notification
from app.modules.alerts.schemas import iso_utc


class NotificationOut(BaseModel):
    id: uuid.UUID
    type: str
    title: str
    body: str
    status: str
    alert_id: uuid.UUID | None
    created_at: str
    read_at: str | None

    @classmethod
    def of(cls, notification: Notification) -> NotificationOut:
        return cls(
            id=notification.notification_id,
            type=notification.type.value,
            title=notification.title,
            body=notification.body,
            status=notification.status.value,
            alert_id=notification.alert_id,
            created_at=iso_utc(notification.created_at),
            read_at=iso_utc(notification.read_at) if notification.read_at else None,
        )


class PageMeta(BaseModel):
    page: int
    page_size: int
    total: int
    pages: int


class NotificationList(BaseModel):
    data: list[NotificationOut]
    meta: PageMeta


class MessageOut(BaseModel):
    message: str
