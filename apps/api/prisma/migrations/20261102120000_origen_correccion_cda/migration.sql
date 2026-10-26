-- Corrección de días pasados (acción cda.asistencia.corregir): nuevo origen CORRECCION.
-- Solo amplía los valores permitidos; las filas existentes ya cumplen.
ALTER TABLE "asistencias_cda"
    DROP CONSTRAINT "ck_asistencias_cda_entrada_origen",
    DROP CONSTRAINT "ck_asistencias_cda_salida_origen",
    ADD CONSTRAINT "ck_asistencias_cda_entrada_origen" CHECK ("entrada_origen" IN ('MANUAL', 'MASIVA', 'QR', 'CORRECCION')),
    ADD CONSTRAINT "ck_asistencias_cda_salida_origen" CHECK ("salida_origen" IN ('MANUAL', 'MASIVA', 'QR', 'CORRECCION'));
