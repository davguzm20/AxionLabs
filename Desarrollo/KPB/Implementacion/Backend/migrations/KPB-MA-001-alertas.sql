-- KPB-MA-001: esquema del CU08 (alertas de umbral y notificaciones).
--
-- Extiende KPB-SCHEMA.sql sin renombrar ni borrar nada, de modo que CU01 y CU02
-- siguen funcionando. Se puede ejecutar mas de una vez sin efectos adicionales.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/KPB-MA-001-alertas.sql

BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'alert_priority') THEN
        CREATE TYPE alert_priority AS ENUM ('NORMAL', 'HIGH');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_type') THEN
        CREATE TYPE notification_type AS ENUM ('BUDGET_ALERT', 'SYSTEM');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_status') THEN
        CREATE TYPE notification_status AS ENUM ('UNREAD', 'READ');
    END IF;
END $$;

-- Umbrales: varios por presupuesto (BR-069). is_active permite el borrado logico.
CREATE TABLE IF NOT EXISTS budget_thresholds (
    threshold_id UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    budget_id    UUID        NOT NULL REFERENCES budgets(budget_id) ON DELETE CASCADE,
    percentage   SMALLINT    NOT NULL,
    is_active    BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_budget_thresholds_percentage CHECK (percentage BETWEEN 1 AND 100)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_budget_thresholds_active
    ON budget_thresholds(budget_id, percentage)
    WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_budget_thresholds_budget
    ON budget_thresholds(budget_id, is_active);

-- Cada presupuesto existente conserva su umbral unico como primer umbral activo.
INSERT INTO budget_thresholds (budget_id, percentage)
SELECT b.budget_id, GREATEST(1, LEAST(100, ROUND(b.threshold_percentage)))::SMALLINT
FROM budgets b
WHERE NOT EXISTS (
    SELECT 1 FROM budget_thresholds t WHERE t.budget_id = b.budget_id
);

-- Alertas: campos nuevos, nulos solo en las filas anteriores a esta migracion.
-- threshold_id usa SET NULL (schema.sql usa RESTRICT) porque aqui budget_id
-- tambien es SET NULL: asi una alerta historica nunca bloquea un borrado en cascada.
ALTER TABLE alerts
    ADD COLUMN IF NOT EXISTS threshold_id         UUID REFERENCES budget_thresholds(threshold_id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS period_start         DATE,
    ADD COLUMN IF NOT EXISTS threshold_percentage SMALLINT,
    ADD COLUMN IF NOT EXISTS consumed             NUMERIC(12,2),
    ADD COLUMN IF NOT EXISTS limit_amount         NUMERIC(12,2),
    ADD COLUMN IF NOT EXISTS priority             alert_priority NOT NULL DEFAULT 'NORMAL';

UPDATE alerts
SET priority = 'HIGH'
WHERE alert_type = 'SOBREGIRO' AND threshold_id IS NULL AND priority <> 'HIGH';

-- Deduplicacion por presupuesto, umbral y periodo (BR-072).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_alerts_budget_threshold_period'
    ) THEN
        ALTER TABLE alerts
            ADD CONSTRAINT uq_alerts_budget_threshold_period
            UNIQUE (budget_id, threshold_id, period_start);
    END IF;
END $$;

-- Buzon de notificaciones in-app.
CREATE TABLE IF NOT EXISTS notifications (
    notification_id UUID                PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID                NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    alert_id        UUID                REFERENCES alerts(alert_id) ON DELETE SET NULL,
    type            notification_type   NOT NULL DEFAULT 'BUDGET_ALERT',
    title           VARCHAR(120)        NOT NULL,
    body            VARCHAR(500)        NOT NULL,
    status          notification_status NOT NULL DEFAULT 'UNREAD',
    created_at      TIMESTAMPTZ         NOT NULL DEFAULT now(),
    read_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_status_created
    ON notifications(user_id, status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_alert
    ON notifications(alert_id)
    WHERE alert_id IS NOT NULL;

-- Preferencias del usuario. El correo de alertas aun no las usa; la tabla queda
-- lista para ese trabajo y para PATCH /users/me/preferences.
CREATE TABLE IF NOT EXISTS user_preferences (
    user_id             UUID        PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
    main_currency       currency_enum NOT NULL DEFAULT 'PEN',
    email_notifications BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_user_preferences_updated_at') THEN
        CREATE TRIGGER trg_user_preferences_updated_at
            BEFORE UPDATE ON user_preferences
            FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    END IF;
END $$;

-- La app se conecta con el rol kpb_app: sin esto, un dueno distinto lo dejaria sin acceso.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kpb_app') THEN
        GRANT SELECT, INSERT, UPDATE ON budget_thresholds, notifications, user_preferences TO kpb_app;
    END IF;
END $$;

COMMIT;
