"""Dependencias de FastAPI para proteger endpoints con Authorization: Bearer <token>."""

from dataclasses import dataclass
from datetime import datetime
from typing import Annotated

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.config import get_auth_settings
from app.core.errors import AppError
from app.core.security import InvalidTokenError, decode_access_token
from app.database import get_db
from app.entities import User, UserStatus
from app.integrations.redis.sessions import SessionStore, auth_unavailable, get_session_store
from app.modules.auth import repository
from app.modules.auth.service import Client

_bearer = HTTPBearer(auto_error=False)


def get_jwt_secret() -> str:
    try:
        return get_auth_settings().jwt_secret
    except ValidationError as error:
        raise auth_unavailable() from error


def get_client(request: Request) -> Client:
    return Client(
        ip=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )


@dataclass
class CurrentSession:
    user: User
    session_id: str
    last_activity_at: datetime


def get_current_session(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    db: Annotated[Session, Depends(get_db)],
    store: Annotated[SessionStore, Depends(get_session_store)],
    secret: Annotated[str, Depends(get_jwt_secret)],
) -> CurrentSession:
    unauthorized = AppError(401, "UNAUTHORIZED", "Inicia sesión para continuar.")
    if credentials is None:
        raise unauthorized
    try:
        user_id, sid = decode_access_token(credentials.credentials, secret)
    except InvalidTokenError:
        raise unauthorized from None

    session = store.touch(sid)
    if session is None or session["user_id"] != str(user_id):
        raise AppError(401, "SESSION_EXPIRED", "Tu sesión expiró por inactividad.")

    user = repository.get_user(db, user_id)
    if user is None or user.status != UserStatus.ACTIVO:
        store.delete(sid, user_id)
        raise unauthorized

    return CurrentSession(
        user=user,
        session_id=sid,
        last_activity_at=datetime.fromisoformat(session["last_activity_at"]),
    )
