from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.integrations.redis.sessions import (
    SESSION_TTL_SECONDS,
    LockoutStore,
    SessionStore,
    get_lockout_store,
    get_session_store,
)
from app.modules.auth import service
from app.modules.auth.deps import CurrentSession, get_client, get_current_session, get_jwt_secret
from app.modules.auth.schemas import (
    LoginRequest,
    LoginResponse,
    MeResponse,
    RegisteredUserOut,
    RegisterRequest,
    RegisterResponse,
    SessionOut,
    UserOut,
)


def _no_store(response: Response) -> None:
    response.headers["Cache-Control"] = "no-store"


router = APIRouter(prefix="/auth", tags=["auth"], dependencies=[Depends(_no_store)])

DbSession = Annotated[Session, Depends(get_db)]
Store = Annotated[SessionStore, Depends(get_session_store)]
Lockout = Annotated[LockoutStore, Depends(get_lockout_store)]
Secret = Annotated[str, Depends(get_jwt_secret)]
RequestClient = Annotated[service.Client, Depends(get_client)]
Current = Annotated[CurrentSession, Depends(get_current_session)]


@router.post("/register", status_code=status.HTTP_201_CREATED)
def register(
    data: RegisterRequest, db: DbSession, store: Store, secret: Secret, client: RequestClient
) -> RegisterResponse:
    """CU01: crea la cuenta con su monedero inicial e inicia sesion."""
    result = service.register(db, store, secret, data, client)
    return RegisterResponse(
        user=RegisteredUserOut.model_validate(result.user),
        access_token=result.access_token,
        expires_in=result.expires_in,
    )


@router.post("/login")
def login(
    data: LoginRequest,
    db: DbSession,
    store: Store,
    lockout: Lockout,
    secret: Secret,
    client: RequestClient,
) -> LoginResponse:
    """CU01: inicia sesion; bloquea la cuenta 30 min tras 3 fallos."""
    result = service.login(db, store, lockout, secret, data, client)
    return LoginResponse(
        user=UserOut.model_validate(result.user),
        access_token=result.access_token,
        expires_in=result.expires_in,
    )


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(current: Current, store: Store) -> None:
    service.logout(store, current.user.user_id, current.session_id)


@router.get("/me")
def me(current: Current) -> MeResponse:
    return MeResponse(
        user=UserOut.model_validate(current.user),
        session=SessionOut(
            id=current.session_id,
            last_activity_at=current.last_activity_at,
            expires_in=SESSION_TTL_SECONDS,
        ),
    )
