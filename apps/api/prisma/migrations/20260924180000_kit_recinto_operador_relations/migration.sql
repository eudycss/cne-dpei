-- AddForeignKey
ALTER TABLE "kits_electorales" ADD CONSTRAINT "kits_electorales_recinto_id_fkey" FOREIGN KEY ("recinto_id") REFERENCES "recintos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kits_electorales" ADD CONSTRAINT "kits_electorales_operador_id_fkey" FOREIGN KEY ("operador_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
