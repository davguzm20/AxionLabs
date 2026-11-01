"""Contrasenas (Argon2id) y tokens JWT segun KPB-Specs (04-api/authentication.md)."""

import re
import uuid
from datetime import UTC, datetime, timedelta

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

# Argon2id: 64 MB, 3 iteraciones, paralelismo 4
_hasher = PasswordHasher(memory_cost=65536, time_cost=3, parallelism=4)
# Se verifica contra este hash cuando el correo no existe, para tardar lo mismo
_REFERENCE_HASH = _hasher.hash("referencia-sin-usuario-1")

TOKEN_LIFETIME = timedelta(hours=24)
JWT_ALGORITHM = "HS256"


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str | None) -> bool:
    try:
        valid = _hasher.verify(password_hash or _REFERENCE_HASH, password)
    except (VerificationError, InvalidHashError):
        return False
    return valid and password_hash is not None


def is_strong_password(password: str) -> bool:
    """BR-009: al menos 8 caracteres, con una letra y un numero."""
    return (
        len(password) >= 8
        and re.search(r"[^\W\d_]", password) is not None
        and re.search(r"\d", password) is not None
    )


class InvalidTokenError(Exception):
    """Token invalido, expirado o sin los claims requeridos."""


def create_access_token(user_id: uuid.UUID, session_id: str, secret: str) -> str:
    now = datetime.now(UTC)
    claims = {
        "sub": str(user_id),
        "sid": session_id,
        "iat": now,
        "exp": now + TOKEN_LIFETIME,
        "jti": uuid.uuid4().hex,
    }
    return jwt.encode(claims, secret, algorithm=JWT_ALGORITHM)


def decode_access_token(token: str, secret: str) -> tuple[uuid.UUID, str]:
    """Devuelve (user_id, session_id)."""
    try:
        claims = jwt.decode(
            token,
            secret,
            algorithms=[JWT_ALGORITHM],
            options={"require": ["sub", "sid", "iat", "exp", "jti"]},
        )
        return uuid.UUID(claims["sub"]), str(claims["sid"])
    except (jwt.PyJWTError, ValueError) as error:
        raise InvalidTokenError from error
