-- =============================================
-- KhipuBot - Base de datos kpb_db (PostgreSQL)
-- =============================================

CREATE DATABASE kpb_db;


-- ENUMS

CREATE TYPE user_status_enum        AS ENUM ('ACTIVO', 'BLOQUEADO', 'INACTIVO');
CREATE TYPE wallet_type_enum        AS ENUM ('BANCO', 'EFECTIVO');
CREATE TYPE currency_enum           AS ENUM ('PEN', 'USD');
CREATE TYPE transaction_type_enum   AS ENUM ('INGRESO', 'GASTO');
CREATE TYPE transaction_status_enum AS ENUM ('CONFIRMADA', 'PENDIENTE');
CREATE TYPE source_type_enum        AS ENUM ('TEXTO', 'VOZ', 'OCR');
CREATE TYPE period_type_enum        AS ENUM ('SEMANAL', 'MENSUAL', 'PERSONALIZADO');
CREATE TYPE budget_status_enum      AS ENUM ('ACTIVO', 'INACTIVO');
CREATE TYPE alert_type_enum         AS ENUM ('UMBRAL', 'SOBREGIRO');
CREATE TYPE access_status_enum      AS ENUM ('EXITOSO', 'FALLIDO');


-- TABLAS

CREATE TABLE users (
    user_id     UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(100)     NOT NULL,
    surname     VARCHAR(100)     NOT NULL,
    email       VARCHAR(150)     NOT NULL UNIQUE,
    password    VARCHAR(255)     NOT NULL,
    status      user_status_enum NOT NULL DEFAULT 'ACTIVO',
    created_at  TIMESTAMPTZ      NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ      NOT NULL DEFAULT now()
);

CREATE TABLE categories (
    category_id  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID         REFERENCES users(user_id) ON DELETE CASCADE,
    name         VARCHAR(100) NOT NULL,
    description  VARCHAR(255),
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE wallets (
    wallet_id        UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID             NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    name             VARCHAR(100)     NOT NULL,
    type             wallet_type_enum NOT NULL,
    currency         currency_enum    NOT NULL,
    initial_balance  NUMERIC(12,2)    NOT NULL DEFAULT 0,
    current_balance  NUMERIC(12,2)    NOT NULL DEFAULT 0,
    created_at       TIMESTAMPTZ      NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ      NOT NULL DEFAULT now(),

    CONSTRAINT uq_wallets_user_name UNIQUE (user_id, name),
    CONSTRAINT uq_wallets_id_user   UNIQUE (wallet_id, user_id)
);

CREATE TABLE transactions (
    transaction_id  UUID                    PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID                    NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    wallet_id       UUID                    NOT NULL,
    category_id     UUID                    NOT NULL REFERENCES categories(category_id),
    amount          NUMERIC(12,2)           NOT NULL,
    type            transaction_type_enum   NOT NULL,
    currency        currency_enum           NOT NULL,
    concept         VARCHAR(255),
    transacted_at   TIMESTAMPTZ             NOT NULL,
    status          transaction_status_enum NOT NULL DEFAULT 'PENDIENTE',
    source_input    TEXT,
    source_type     source_type_enum        NOT NULL,
    created_at      TIMESTAMPTZ             NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ             NOT NULL DEFAULT now(),

    CONSTRAINT fk_transactions_wallet_user FOREIGN KEY (wallet_id, user_id) REFERENCES wallets(wallet_id, user_id),
    CONSTRAINT chk_transactions_amount     CHECK (amount > 0)
);

CREATE TABLE budgets (
    budget_id             UUID               PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id               UUID               NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    category_id           UUID               NOT NULL REFERENCES categories(category_id),
    amount                NUMERIC(12,2)      NOT NULL,
    currency              currency_enum      NOT NULL,
    threshold_percentage  NUMERIC(5,2)       NOT NULL DEFAULT 80,
    period_type           period_type_enum   NOT NULL,
    period_days           INTEGER            NOT NULL,
    start_date            DATE               NOT NULL,
    status                budget_status_enum NOT NULL DEFAULT 'ACTIVO',
    created_at            TIMESTAMPTZ        NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ        NOT NULL DEFAULT now(),

    CONSTRAINT chk_budgets_amount    CHECK (amount > 0),
    CONSTRAINT chk_budgets_threshold CHECK (threshold_percentage > 0 AND threshold_percentage <= 100),
    CONSTRAINT chk_budgets_period    CHECK (
        (period_type = 'SEMANAL'       AND period_days = 7)  OR
        (period_type = 'MENSUAL'       AND period_days = 30) OR
        (period_type = 'PERSONALIZADO' AND period_days > 0)
    )
);

CREATE TABLE alerts (
    alert_id             UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id              UUID            NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    budget_id            UUID            REFERENCES budgets(budget_id) ON DELETE SET NULL,
    alert_type           alert_type_enum NOT NULL,
    message              VARCHAR(255)    NOT NULL,
    detected_percentage  NUMERIC(6,2),
    remaining_balance    NUMERIC(12,2),
    is_read              BOOLEAN         NOT NULL DEFAULT FALSE,
    triggered_at         TIMESTAMPTZ     NOT NULL,
    created_at           TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ     NOT NULL DEFAULT now(),

    CONSTRAINT chk_alerts_detected CHECK (detected_percentage >= 0)
);

CREATE TABLE access_logs (
    log_id       UUID               PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID               NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    accessed_at  TIMESTAMPTZ        NOT NULL DEFAULT now(),
    device       VARCHAR(150),
    status       access_status_enum NOT NULL
);


-- TRIGGERS

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at        BEFORE UPDATE ON users        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_wallets_updated_at      BEFORE UPDATE ON wallets      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_transactions_updated_at BEFORE UPDATE ON transactions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_budgets_updated_at      BEFORE UPDATE ON budgets      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_alerts_updated_at       BEFORE UPDATE ON alerts       FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE FUNCTION check_category_owner()
RETURNS TRIGGER AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM categories
        WHERE category_id = NEW.category_id
          AND (user_id IS NULL OR user_id = NEW.user_id)
    ) THEN
        RAISE EXCEPTION 'La categoria % no pertenece al usuario %', NEW.category_id, NEW.user_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_transactions_category_owner BEFORE INSERT OR UPDATE OF category_id, user_id ON transactions FOR EACH ROW EXECUTE FUNCTION check_category_owner();
CREATE TRIGGER trg_budgets_category_owner      BEFORE INSERT OR UPDATE OF category_id, user_id ON budgets      FOR EACH ROW EXECUTE FUNCTION check_category_owner();


-- INDICES

CREATE UNIQUE INDEX uq_categories_user_name    ON categories(user_id, name) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX uq_categories_system_name  ON categories(name)          WHERE user_id IS NULL;
CREATE UNIQUE INDEX uq_budgets_active_category ON budgets(user_id, category_id) WHERE status = 'ACTIVO';

CREATE INDEX idx_wallets_user_id        ON wallets(user_id);
CREATE INDEX idx_transactions_user_date ON transactions(user_id, transacted_at DESC);
CREATE INDEX idx_transactions_wallet_id ON transactions(wallet_id);
CREATE INDEX idx_transactions_category  ON transactions(category_id, transacted_at);
CREATE INDEX idx_budgets_category_id    ON budgets(category_id);
CREATE INDEX idx_alerts_user_unread     ON alerts(user_id, is_read);
CREATE INDEX idx_alerts_budget_id       ON alerts(budget_id);
CREATE INDEX idx_access_logs_user_date  ON access_logs(user_id, accessed_at DESC);
