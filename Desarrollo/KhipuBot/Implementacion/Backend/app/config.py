from functools import lru_cache

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
