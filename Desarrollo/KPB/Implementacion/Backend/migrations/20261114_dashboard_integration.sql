-- Migración de integración del dashboard para una base Neon ya existente.
-- Es segura de ejecutar una vez sobre el esquema KPB-SCHEMA.sql ya aplicado.

DO $$
BEGIN
    CREATE TYPE notification_type AS ENUM ('BUDGET_ALERT', 'SYSTEM');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    CREATE TYPE notification_status AS ENUM ('UNREAD', 'READ');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS main_currency currency_enum NOT NULL DEFAULT 'PEN',
    ADD COLUMN IF NOT EXISTS email_notifications BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE IF NOT EXISTS notifications (
    notification_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    alert_id UUID REFERENCES alerts(alert_id) ON DELETE SET NULL,
    type notification_type NOT NULL DEFAULT 'BUDGET_ALERT',
    title VARCHAR(120) NOT NULL,
    body VARCHAR(500) NOT NULL,
    status notification_status NOT NULL DEFAULT 'UNREAD',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    read_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_status_created
    ON notifications (user_id, status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_alert
    ON notifications (alert_id)
    WHERE alert_id IS NOT NULL;
