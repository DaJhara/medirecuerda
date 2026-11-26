-- Migración 004 · Presentación del medicamento y stock disponible.
--   presentation   : tabletas, cápsulas, gotas, jarabe... (opcional)
--   stock_units    : unidades que quedan en la caja (opcional; se descuenta con cada toma)
--   units_per_dose : unidades que se gastan en cada toma (1 por defecto)
-- Es segura de repetir (IF NOT EXISTS) y no modifica los datos existentes.
ALTER TABLE medications ADD COLUMN IF NOT EXISTS presentation text;
ALTER TABLE medications ADD COLUMN IF NOT EXISTS stock_units integer;
ALTER TABLE medications ADD COLUMN IF NOT EXISTS units_per_dose smallint NOT NULL DEFAULT 1;
ALTER TABLE medications DROP CONSTRAINT IF EXISTS medications_stock_units_check;
ALTER TABLE medications ADD CONSTRAINT medications_stock_units_check CHECK (stock_units IS NULL OR stock_units >= 0);
ALTER TABLE medications DROP CONSTRAINT IF EXISTS medications_units_per_dose_check;
ALTER TABLE medications ADD CONSTRAINT medications_units_per_dose_check CHECK (units_per_dose BETWEEN 1 AND 100);
