import os

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

# Base PostgreSQL de pruebas con KPB-SCHEMA.sql cargado. Las pruebas que la
# usan se omiten si no se define. No uses la base del equipo: se vacia la
# tabla users (y sus dependientes) antes de cada prueba.
TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")

requires_db = pytest.mark.skipif(not TEST_DATABASE_URL, reason="TEST_DATABASE_URL no definida")


@pytest.fixture
def db_session():
    engine = create_engine(TEST_DATABASE_URL)
    with engine.begin() as connection:
        connection.execute(text("TRUNCATE users CASCADE"))
    with Session(engine) as session:
        yield session
    engine.dispose()
