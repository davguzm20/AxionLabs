"""Bandeja de notificaciones del CU08."""

from __future__ import annotations

import math
import uuid
from datetime import UTC, datetime

from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.entities import NotificationStatus, User
from app.integrations.redis.notifications import NotificationBus
from app.modules.notifications import repository
from app.modules.notifications.schemas import (
    NotificationList,
    NotificationOut,
    PageMeta,
)


def list_notifications(
    db: Session,
    user: User,
    status: NotificationStatus | None,
    page: int,
    page_size: int,
) -> NotificationList:
    rows, total = repository.page_of(db, user.user_id, status, page, page_size)
    return NotificationList(
        data=[NotificationOut.of(row) for row in rows],
        meta=PageMeta(
            page=page,
            page_size=page_size,
            total=total,
            pages=math.ceil(total / page_size),
        ),
    )


def mark_read(
    db: Session, user: User, notification_id: uuid.UUID, bus: NotificationBus
) -> NotificationOut:
    """Marca una como leida y avisa a las otras pestanas del usuario."""
    notification = repository.get_notification(db, user.user_id, notification_id)
    if notification is None:
        raise AppError(404, "NOT_FOUND", "No encontramos lo que buscas.")

    if notification.status != NotificationStatus.READ:
        notification.status = NotificationStatus.READ
        notification.read_at = datetime.now(UTC)
        db.commit()
        bus.publish(
            user.user_id,
            "notification.read",
            str(notification_id),
            {"id": str(notification_id), "status": NotificationStatus.READ.value},
        )
    return NotificationOut.of(notification)


def mark_all_read(db: Session, user: User) -> None:
    repository.mark_all_read(db, user.user_id, datetime.now(UTC))
    db.commit()
