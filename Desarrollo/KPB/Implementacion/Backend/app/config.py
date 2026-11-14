from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Configuracion leida del archivo .env o de variables de entorno.

    Ningun valor tiene default: si falta alguno, la conexion no se crea.
    """

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Parametros de conexion de Neon (Connect > "Parameters only")
    pghost: str
    pgdatabase: str
    pguser: str
    pgpassword: str
    pgsslmode: str
    pgchannelbinding: str


@lru_cache
def get_settings() -> Settings:
    return Settings()


class AuthSettings(BaseSettings):
    """Variables de autenticacion. Tampoco tienen default."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Clave para firmar los JWT: minimo 32 caracteres aleatorios
    jwt_secret: str = Field(min_length=32)
    # Redis de Upstash (TLS), p. ej. rediss://default:clave@host:6379
    redis_url: str


@lru_cache
def get_auth_settings() -> AuthSettings:
    return AuthSettings()


class AISettings(BaseSettings):
    """Configuración para servicios de Inteligencia Artificial (OpenAI o Mock).

    Si openai_api_key no está presente o es vacía, el sistema usa el extractor
    simulado (Mock) para desarrollo local y pruebas sin costo.
    """

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    openai_api_key: str | None = None
    openai_text_model: str = "gpt-4o-mini"


@lru_cache
def get_ai_settings() -> AISettings:
    return AISettings()
