"""KPB-CBD: componente de conexion con la base de datos (PostgreSQL en Neon)."""

from collections.abc import Iterator
from functools import lru_cache

from pydantic import ValidationError
from sqlalchemy import URL, Engine, create_engine, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import Settings, get_settings


class DatabaseNotConfiguredError(RuntimeError):
    """Faltan variables de conexion en el .env."""


class Base(DeclarativeBase):
    """Clase base de las entidades del sistema (KPB-ENT)."""


def load_settings() -> Settings:
    """Lee el .env; si falta alguna variable, indica cuales."""
    try:
        return get_settings()
    except ValidationError as error:
        missing = [str(e["loc"][0]).upper() for e in error.errors()]
        raise DatabaseNotConfiguredError(
            f"Faltan variables en el .env: {', '.join(missing)}"
        ) from None


def build_database_url(settings: Settings) -> URL:
    """Arma la URL de SQLAlchemy (driver psycopg 3) con los valores del .env."""
    return URL.create(
        "postgresql+psycopg",
        username=settings.pguser,
        password=settings.pgpassword,
        host=settings.pghost,
        database=settings.pgdatabase,
        query={
            "sslmode": settings.pgsslmode,
            "channel_binding": settings.pgchannelbinding,
        },
    )


@lru_cache
def get_engine() -> Engine:
    return create_engine(
        build_database_url(load_settings()),
        # Neon suspende el compute cuando no hay uso y corta las conexiones
        # inactivas: se valida cada conexion antes de usarla y se renuevan
        # cada 5 minutos.
        pool_pre_ping=True,
        pool_recycle=300,
        pool_size=5,
        max_overflow=5,
        # Con el pooler de Neon (PgBouncer) cada consulta puede ir a una
        # conexion distinta, asi que no se usan sentencias preparadas.
        connect_args={"prepare_threshold": None},
    )


@lru_cache
def get_sessionmaker() -> sessionmaker[Session]:
    return sessionmaker(bind=get_engine(), autoflush=False, expire_on_commit=False)


def get_db() -> Iterator[Session]:
    """Dependencia de FastAPI: abre una sesion por peticion y la cierra al terminar."""
    with get_sessionmaker()() as session:
        yield session


def check_connection() -> None:
    """Ejecuta SELECT 1; lanza una excepcion si la base de datos no responde."""
    with get_engine().connect() as connection:
        connection.execute(text("SELECT 1"))
