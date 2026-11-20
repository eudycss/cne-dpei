-- Desde ahora solo vale el Certificado de Aprobación de Evatics (no capturas
-- del Área personal ni de calificaciones). Todos los APROBADOS vuelven a
-- RECHAZADO para que suban el certificado; los PENDIENTES se vuelven a
-- analizar con la regla nueva. Las fotos se conservan (no se borra nada).
-- Corre una sola vez (prisma migrate deploy): no ejecutar a mano de nuevo,
-- revertiría las aprobaciones nuevas. Quién aprobó antes queda en la bitácora.

UPDATE certificados_evatics
SET estado = 'RECHAZADO',
    motivo_rechazo = 'Ahora se pide el Certificado de Aprobación de Evatics. Súbalo en foto o PDF.',
    revisado_por_id = NULL,
    revisado_en = now(),
    -- La lectura vieja era de una captura: que el panel no diga "El nombre coincide".
    analisis_estado = 'NO_DISPONIBLE',
    analisis_siguiente = NULL,
    nombre_leido = NULL,
    nombre_coincide = NULL,
    es_certificado = NULL,
    legible = NULL,
    notas_aprobadas = NULL,
    actualizado_en = now()
WHERE estado = 'APROBADO';

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
