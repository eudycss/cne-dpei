-- Motivo que escribe el operador al registrar la salida del recinto con
-- recintos NO CDA sin marcar su llegada. Solo se llena en SALIDA_RECINTO.
-- Nullable: las salidas anteriores y las de APK viejas no lo traen.
ALTER TABLE eventos_tracking ADD COLUMN IF NOT EXISTS justificacion_no_cda VARCHAR(500);
