-- Una sola prueba de conexión por operador y evento. La cola offline del móvil
-- puede reenviarla a la vez que el POST directo: sin esta restricción las dos
-- peticiones podrían insertar dos filas. Va en una migración aparte porque el
-- valor 'PRUEBA_CONEXION' del enum debe estar confirmado antes de usarlo aquí.

CREATE UNIQUE INDEX IF NOT EXISTS "uq_tracking_prueba_conexion"
  ON "eventos_tracking" ("evento_id", "operador_id")
  WHERE "tipo" = 'PRUEBA_CONEXION';
