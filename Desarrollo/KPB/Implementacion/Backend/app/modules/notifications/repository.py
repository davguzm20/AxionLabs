"""Consultas de notificaciones, siempre filtradas por el usuario autenticado."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import case, func, select, update
from sqlalchemy.orm import Session

from app.entities import Notification, NotificationStatus


def page_of(
    db: Session,
    user_id: uuid.UUID,
    status: NotificationStatus | None,
    page: int,
    page_size: int,
) -> tuple[list[Notification], int]:
    """Pagina con las no leidas primero y, dentro de cada grupo, las mas recientes."""
    filters = [Notification.user_id == user_id]
    if status is not None:
        filters.append(Notification.status == status)

    total = db.execute(select(func.count()).select_from(Notification).where(*filters)).scalar_one()
    unread_first = case((Notification.status == NotificationStatus.UNREAD, 0), else_=1)
    stmt = (
        select(Notification)
        .where(*filters)
        .order_by(unread_first, Notification.created_at.desc(), Notification.notification_id)
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    return list(db.execute(stmt).scalars().all()), total


def get_notification(
    db: Session, user_id: uuid.UUID, notification_id: uuid.UUID
) -> Notification | None:
    stmt = select(Notification).where(
        Notification.notification_id == notification_id,
        Notification.user_id == user_id,
    )
    return db.execute(stmt).scalars().first()


def mark_all_read(db: Session, user_id: uuid.UUID, read_at: datetime) -> None:
    db.execute(
        update(Notification)
        .where(
            Notification.user_id == user_id,
            Notification.status == NotificationStatus.UNREAD,
        )
        .values(status=NotificationStatus.READ, read_at=read_at)
    )
