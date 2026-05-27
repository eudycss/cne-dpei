-- HU2-CA3: marcar lectura de notificaciones in-app (web)
ALTER TABLE "notificaciones"
  ADD COLUMN "leida_en" TIMESTAMPTZ(6);
