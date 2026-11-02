import uuid
from datetime import datetime

from pydantic import AliasChoices, BaseModel, ConfigDict, Field


class RegisterRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    surname: str = Field(min_length=1, max_length=100)
    # El formato del correo y la fuerza de la contrasena se validan en el
    # servicio para responder INVALID_EMAIL, WEAK_PASSWORD, etc.
    email: str
    password: str
    confirm_password: str
    accept_terms: bool


class LoginRequest(BaseModel):
    email: str
    password: str


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    # En la entidad User la llave es user_id; la API la expone como id
    id: uuid.UUID = Field(validation_alias=AliasChoices("id", "user_id"))
    name: str
    surname: str
    email: str


class RegisteredUserOut(UserOut):
    created_at: datetime


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int


class RegisterResponse(TokenResponse):
    user: RegisteredUserOut


class LoginResponse(TokenResponse):
    user: UserOut


class SessionOut(BaseModel):
    id: str
    last_activity_at: datetime
    expires_in: int


class MeResponse(BaseModel):
    user: UserOut
    session: SessionOut
