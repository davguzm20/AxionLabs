"""KPB-AUTH: logica del CU01 (registro, login, sesion y logout).

Trabaja con las tablas actuales de la base (KPB-SCHEMA.sql) a traves de las
entidades de KPB-ENT. Como users no tiene columnas de intentos fallidos, el
conteo y la duracion del bloqueo se llevan en Redis; el estado BLOQUEADO
se guarda en la base para que quede registrado.
"""

import logging
import uuid
from dataclasses import dataclass

from email_validator import EmailNotValidError, validate_email
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.core.security import (
    create_access_token,
    hash_password,
    is_strong_password,
    verify_password,
)
from app.entities import User, UserStatus
from app.integrations.redis.sessions import SESSION_TTL_SECONDS, LockoutStore, SessionStore
from app.modules.auth import repository
from app.modules.auth.schemas import LoginRequest, RegisterRequest

logger = logging.getLogger(__name__)


@dataclass
class Client:
    """Datos de la peticion que se guardan en la sesion y en access_logs."""

    ip: str | None
    user_agent: str | None


@dataclass
class AuthResult:
    user: User
    access_token: str
    expires_in: int


def _invalid_credentials() -> AppError:
    return AppError(
        401, "INVALID_CREDENTIALS", "Correo o contraseña incorrectos. Inténtalo de nuevo."
    )


def _account_locked() -> AppError:
    return AppError(
        423, "ACCOUNT_LOCKED", "Tu cuenta se bloqueó por 30 minutos."
    )


def _start_session(store: SessionStore, secret: str, user: User, client: Client) -> AuthResult:
    sid = store.create(user.user_id, client.ip, client.user_agent)
    token = create_access_token(user.user_id, sid, secret)
    return AuthResult(user=user, access_token=token, expires_in=SESSION_TTL_SECONDS)


def register(
    db: Session, store: SessionStore, secret: str, data: RegisterRequest, client: Client
) -> AuthResult:
    name, surname = data.name.strip(), data.surname.strip()
    blank = [field for field, value in (("name", name), ("surname", surname)) if not value]
    if blank:
        raise AppError(
            422,
            "VALIDATION_ERROR",
            "Revisa los campos marcados.",
            [{"field": field, "message": "Este campo es obligatorio."} for field in blank],
        )
    try:
        email = validate_email(data.email, check_deliverability=False).normalized.lower()
    except EmailNotValidError:
        raise AppError(422, "INVALID_EMAIL", "Ingresa un correo válido.") from None
    if not is_strong_password(data.password):
        raise AppError(
            422, "WEAK_PASSWORD", "Usa al menos 8 caracteres, con una letra y un número."
        )
    if data.password != data.confirm_password:
        raise AppError(422, "PASSWORD_MISMATCH", "Las contraseñas no coinciden.")
    if not data.accept_terms:
        raise AppError(422, "TERMS_NOT_ACCEPTED", "Debes aceptar los términos para continuar.")

    email_taken = AppError(409, "EMAIL_ALREADY_EXISTS", "Ese correo ya tiene una cuenta.")
    if repository.get_user_by_email(db, email) is not None:
        raise email_taken

    # Usuario y monedero inicial en una sola transaccion
    try:
        user = repository.add_user_with_wallet(
            db, name, surname, email, hash_password(data.password)
        )
        db.commit()
    except IntegrityError:
        db.rollback()
        raise email_taken from None
    db.refresh(user)

    return _start_session(store, secret, user, client)


def login(
    db: Session,
    store: SessionStore,
    lockout: LockoutStore,
    secret: str,
    data: LoginRequest,
    client: Client,
) -> AuthResult:
    user = repository.get_user_by_email(db, data.email)

    if user is not None and user.status == UserStatus.BLOQUEADO:
        if lockout.is_locked(user.user_id):
            raise _account_locked()
        # BR-013: pasados los 30 minutos se libera el bloqueo
        user.status = UserStatus.ACTIVO
        db.commit()

    # Se verifica aunque el usuario no exista, para no revelarlo por el tiempo de respuesta
    if not verify_password(data.password, user.password if user else None):
        _register_failure(db, lockout, user, client)
    assert user is not None

    if user.status == UserStatus.INACTIVO:
        raise AppError(403, "ACCOUNT_INACTIVE", "Tu cuenta no está activa. Contacta a soporte.")

    lockout.clear(user.user_id)
    repository.add_access_log(db, user.user_id, success=True, device=client.user_agent)
    db.commit()
    db.refresh(user)

    return _start_session(store, secret, user, client)


def _register_failure(
    db: Session, lockout: LockoutStore, user: User | None, client: Client
) -> None:
    """Cuenta el fallo; al tercero bloquea 30 minutos (BR-012). Siempre lanza un error."""
    if user is None:
        # access_logs exige user_id: un correo inexistente no se puede registrar
        raise _invalid_credentials()

    repository.add_access_log(db, user.user_id, success=False, device=client.user_agent)
    if user.status == UserStatus.INACTIVO or not lockout.register_failure(user.user_id):
        db.commit()
        raise _invalid_credentials()

    user.status = UserStatus.BLOQUEADO
    db.commit()
    # Pendiente: enviar el correo de bloqueo cuando exista el servicio de correo
    logger.warning("Cuenta bloqueada por intentos fallidos: user_id=%s", user.user_id)
    raise _account_locked()


def logout(store: SessionStore, user_id: uuid.UUID, sid: str) -> None:
    store.delete(sid, user_id)
