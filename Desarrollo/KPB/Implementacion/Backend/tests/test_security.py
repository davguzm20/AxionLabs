import uuid

import jwt
import pytest

from app.core.security import (
    InvalidTokenError,
    create_access_token,
    decode_access_token,
    hash_password,
    is_strong_password,
    verify_password,
)

SECRET = "s" * 32


@pytest.mark.parametrize(
    ("password", "strong"),
    [("abc", False), ("abcdefgh", False), ("12345678", False), ("Secreta123", True), ("ñandú2026", True)],
)
def test_password_strength(password: str, strong: bool) -> None:
    assert is_strong_password(password) is strong


def test_hash_is_argon2id_and_verifies() -> None:
    password_hash = hash_password("Secreta123")

    assert password_hash.startswith("$argon2id$")
    assert verify_password("Secreta123", password_hash)
    assert not verify_password("Otra12345", password_hash)
    assert not verify_password("Secreta123", None)


def test_token_has_required_claims() -> None:
    user_id = uuid.uuid4()
    token = create_access_token(user_id, "sid-1", SECRET)

    claims = jwt.decode(token, SECRET, algorithms=["HS256"])
    assert set(claims) == {"sub", "sid", "iat", "exp", "jti"}
    assert claims["exp"] - claims["iat"] == 24 * 3600
    assert decode_access_token(token, SECRET) == (user_id, "sid-1")


def test_token_without_sid_is_rejected() -> None:
    token = jwt.encode({"sub": str(uuid.uuid4()), "iat": 0, "exp": 9999999999, "jti": "x"}, SECRET)

    with pytest.raises(InvalidTokenError):
        decode_access_token(token, SECRET)
