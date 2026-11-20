-- Desde ahora solo vale el Certificado de Aprobación de Evatics (no capturas
-- del Área personal ni de calificaciones). Todos los APROBADOS y RECHAZADOS
-- vuelven a «Sin subir» para que suban el certificado; los PENDIENTES se
-- vuelven a analizar con la regla nueva. Las capturas se conservan (no se
-- borra nada): con estado SIN_SUBIR el panel las trata como si no hubiera
-- registro, y al subir el certificado la captura pasa a ser la «foto anterior».
-- Corre una sola vez (prisma migrate deploy): no ejecutar a mano de nuevo,
-- revertiría las aprobaciones nuevas. Quién aprobó antes queda en la bitácora.

UPDATE certificados_evatics
SET estado = 'SIN_SUBIR',
    motivo_rechazo = NULL,
    revisado_por_id = NULL,
    revisado_en = NULL,
    -- Puede subir hoy mismo aunque haya gastado sus subidas del día.
    subidas_hoy = 0,
    -- La lectura vieja era de una captura: que nadie la vuelva a analizar.
    analisis_estado = 'NO_DISPONIBLE',
    analisis_siguiente = NULL,
    nombre_leido = NULL,
    nombre_coincide = NULL,
    es_certificado = NULL,
    legible = NULL,
    notas_aprobadas = NULL,
    actualizado_en = now()
WHERE estado IN ('APROBADO', 'RECHAZADO');

UPDATE certificados_evatics
SET analisis_estado = 'EN_COLA',
    analisis_intentos = 0,
    analisis_siguiente = NULL,
    nombre_leido = NULL,
    nombre_coincide = NULL,
    es_certificado = NULL,
    legible = NULL,
    notas_aprobadas = NULL,
    analizado_en = NULL,
    analisis_proveedor = NULL,
    actualizado_en = now()
WHERE estado = 'PENDIENTE';
