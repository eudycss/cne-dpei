-- Integridad de la cadena de custodia: la entrega y su historial no se borran
-- con el kit (RESTRICT), y el historial de correcciones es de solo inserción,
-- igual que la bitácora de auditoría.

ALTER TABLE "entregas_custodio_kit" DROP CONSTRAINT "entregas_custodio_kit_kit_id_fkey";
ALTER TABLE "entregas_custodio_kit" ADD CONSTRAINT "entregas_custodio_kit_kit_id_fkey"
  FOREIGN KEY ("kit_id") REFERENCES "kits_electorales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "correcciones_custodia_kit" ADD CONSTRAINT "correcciones_custodia_kit_kit_id_fkey"
  FOREIGN KEY ("kit_id") REFERENCES "kits_electorales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION fn_correcciones_custodia_inmutable() RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'El historial de correcciones de custodia es inmutable: no se permite %', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_correcciones_custodia_inmutable ON correcciones_custodia_kit;
CREATE TRIGGER trg_correcciones_custodia_inmutable
    BEFORE UPDATE OR DELETE ON correcciones_custodia_kit
    FOR EACH ROW EXECUTE FUNCTION fn_correcciones_custodia_inmutable();
