# Requerimientos del Sistema de Gestión de Trazabilidad y Logística Electoral

**CNE — Delegación Provincial de Imbabura**  
**Versión 1.0 — Documento Final**

---

## 1. Roles y permisos

| Rol | Permisos |
|-----|----------|
| **Operador de CDA** | • Registrar salida y llegada al DPI desde la app móvil. <br> • Registrar salida y llegada al recinto electoral desde la app móvil. <br> • Reportar incidencias durante el proceso electoral. |
| **Técnico Supervisor** | • Registro de operadores de CDA. <br> • Visualizar dashboard con reportes estadísticos relevantes. <br> • Monitorear en tiempo real la ubicación de los operadores de CDA en su trayecto de retorno al DPI. <br> • Atender y dar seguimiento a incidencias reportadas. <br> • Recibir alertas automáticas por anomalías. |
| **Administrador** | • Administrar usuarios. <br> • Administrar técnicos supervisores. <br> • Administrar militares. <br> • Administrar operadores de CDA. <br> • Administrar kits electorales. <br> • Generar e imprimir códigos QR de kits electorales. <br> • Asignar kits a recintos electorales y a operadores de CDA. <br> • Gestionar eventos electorales (crear, activar, cerrar). <br> • Consultar la bitácora de auditoría del sistema. <br> • Configurar umbrales de alertas automáticas. |

---

## 2. Historias de Usuario

### HU1 — Inicio de sesión en la app móvil
**Prioridad:** Alta

**Descripción:** Como usuario del sistema, quiero ingresar en la aplicación móvil para iniciar sesión y acceder a las funcionalidades del sistema.

**Criterios de aceptación:**

- **CA1:** Los usuarios serán creados previamente por los administradores y técnicos del sistema.
- **CA2:** Al iniciar sesión por primera vez, se lo hará con una contraseña por defecto.
- **CA3:** Una vez iniciada la sesión por primera vez, se solicitará al usuario cambiar de contraseña. Se solicitará el ingreso de una contraseña fuerte.
- **CA4:** Según el rol y permisos del usuario, se redireccionará al usuario a la pantalla inicial correspondiente.

---

### HU2 — Registro de salida del DPI
**Prioridad:** Alta

**Descripción:** Como operador de CDA, quiero registrar la salida de la Delegación Provincial de Imbabura en el día de elecciones desde la app móvil.

**Criterios de aceptación:**

- **CA1:** Se presentará en pantalla el detalle del recinto electoral asignado y la lista de kits electorales que le serán entregados en el recinto por el militar (id, nombre y contenidos previstos).
- **CA2:** El operador de CDA debe seleccionar el botón "Registrar Salida de Delegación". Se mostrará un mensaje de confirmación antes de proceder con la acción.
- **CA3:** Se notificará a los técnicos supervisores y administradores de la salida del operador de CDA. Adicionalmente se enviará una ubicación GPS puntual al momento de la salida (no es rastreo continuo; el rastreo continuo arranca en HU4).

---

### HU3 — Registro de llegada al recinto electoral
**Prioridad:** Alta

**Descripción:** Como operador de CDA, quiero registrar mi llegada al recinto electoral para confirmar la recepción de mis kits electorales asignados desde la app móvil.

**Criterios de aceptación:**

- **CA1:** Se presentará en pantalla los datos del militar referencial asignado al recinto (nombres, apellidos, cédula). El militar no opera la app ni dispone de credenciales en el sistema; su información sirve únicamente como referencia para que el operador valide visualmente la entrega.
- **CA2:** Para dejar evidencia de la entrega, el operador debe tomar una fotografía al militar. La fotografía se almacena cifrada como respaldo de la cadena de custodia.
- **CA3:** Una vez registrada la evidencia, debo proceder con el escaneo de los kits electorales. Tras seleccionar la opción "Escanear Kit Electoral", se abrirá la cámara (asegurarse que el usuario haya concedido los permisos de cámara) y debo escanear el código QR de los kits electorales entregados por el militar.
- **CA4:** Alternativamente, puedo ingresar el kit electoral manualmente con su código en lugar de escanear con el QR. El código se ubica debajo del QR.
- **CA5:** Si el kit electoral no me pertenece, se mostrará un mensaje de error y se bloqueará la confirmación de recepción.
- **CA6:** Una vez escaneado el kit electoral, se mostrará en pantalla el detalle del mismo y luego confirmar la recepción del mismo mediante el botón "Confirmar Recepción de Kit Electoral".
- **CA7:** Se notificará a los técnicos supervisores y administradores de la llegada del operador de CDA y la recepción de sus kits electorales. Adicionalmente se enviará una ubicación GPS puntual al momento de la llegada.

---

### HU4 — Registro de salida del recinto electoral
**Prioridad:** Alta

**Descripción:** Como operador de CDA, quiero registrar mi salida del recinto electoral para confirmar la salida de mis kits electorales asignados desde la app móvil.

**Criterios de aceptación:**

- **CA1:** Se presentará en pantalla el detalle de mis kits electorales asignados, con datos como: id, nombre y contenidos.
- **CA2:** Debo marcar todos los kits y luego presionar el botón "Registrar Salida de Recinto Electoral". Se mostrará un mensaje de confirmación antes de proceder con la acción. No se permitirá la acción si no están activados los servicios de Ubicación en el dispositivo móvil.
- **CA3:** Una vez confirmada la salida del recinto, se iniciará el rastreamiento en tiempo real de la persona mediante los servicios geográficos del dispositivo móvil.
- **CA4:** Los técnicos supervisores y administradores podrán monitorear en tiempo real la ubicación del operador de CDA a través de la app web y app móvil.

---

### HU5 — Registro de llegada al DPI
**Prioridad:** Alta

**Descripción:** Como operador de CDA, quiero registrar mi llegada a la Delegación Provincial de Imbabura para confirmar la llegada de mis kits electorales asignados desde la app móvil.

**Criterios de aceptación:**

- **CA1:** Se presentará en pantalla el detalle de mis kits electorales asignados, con datos como: id, nombre y contenidos.
- **CA2:** Debo marcar todos los kits y luego presionar el botón "Registrar Llegada a Delegación". Se mostrará un mensaje de confirmación antes de proceder con la acción.
- **CA3:** Una vez confirmada la llegada al DPI, se terminará el monitoreo en tiempo real del operador de CDA y se notificará a los técnicos supervisores y administradores.

---

### HU6 — Monitoreo de operadores de CDA
**Prioridad:** Alta

**Descripción:** Como técnico supervisor, quiero monitorear en tiempo real la ubicación de mis operadores de CDA asignados para conocer su estado desde la app web y app móvil.

**Criterios de aceptación:**

- **CA1:** Solo se podrá monitorear en tiempo real a aquellos operadores de CDA que han marcado su salida del recinto electoral (en su tramo de retorno al DPI).
- **CA2:** Tanto en la app móvil como en la app web, se podrá visualizar un mapa con la ubicación en tiempo real del operador de CDA.
- **CA3:** Adicionalmente se visualizará los kits electorales que tiene asignado el operador de CDA.
- **CA4:** Una vez el operador de CDA ha marcado su llegada al DPI, su ubicación ya no podrá ser monitoreada.

---

### HU7 — Carga masiva de usuarios
**Prioridad:** Alta

**Descripción:** Como administrador, quiero realizar la carga masiva de usuarios a partir de un archivo Excel o CSV para así llenar el sistema desde la app web.

**Criterios de aceptación:**

- **CA1:** El Excel/CSV debe contener el listado de usuarios, cada uno tiene los siguientes campos: nombres, apellidos, email, cédula, número de teléfono.
- **CA2:** Alternativamente, se puede ingresar usuarios en el sistema manualmente uno por uno.

---

### HU8 — Carga masiva de militares
**Prioridad:** Alta

**Descripción:** Como administrador, quiero realizar la carga masiva de militares a partir de un archivo Excel o CSV para así llenar el sistema desde la app web.

**Criterios de aceptación:**

- **CA1:** El Excel/CSV debe contener el listado de militares, cada uno tiene los siguientes campos: nombres, apellidos, cédula, recinto electoral.
- **CA2:** Alternativamente, se puede ingresar militares en el sistema manualmente uno por uno.

---

### HU9 — Asignación de roles
**Prioridad:** Alta

**Descripción:** Como administrador, quiero realizar la asignación de roles a múltiples usuarios para así llenar el sistema desde la app web.

**Criterios de aceptación:**

- **CA1:** Al seleccionar uno o múltiples usuarios, puedo asignarles uno o múltiples roles.

---

### HU10 — Asignación de operadores de CDA a técnicos supervisores
**Prioridad:** Alta

**Descripción:** Como administrador, quiero asignar operadores de CDA a sus respectivos técnicos supervisores desde la app web.

**Criterios de aceptación:**

- **CA1:** Al seleccionar uno o múltiples operadores de CDA, puedo asignarles un técnico supervisor.
- **CA2:** Un operador de CDA no puede tener asignado dos técnicos supervisores, solo uno.

---

### HU11 — Generación e impresión de QR de kits electorales
**Prioridad:** Alta

**Descripción:** Como administrador, quiero generar y exportar los códigos QR de los kits electorales para que puedan ser impresos, adheridos al kit físico y posteriormente escaneados por los operadores de CDA al recibirlos.

**Criterios de aceptación:**

- **CA1:** Al crear un kit electoral, el sistema generará automáticamente un código único alfanumérico y su código QR correspondiente.
- **CA2:** El QR debe codificar el identificador único del kit y ser verificable contra la base de datos del sistema.
- **CA3:** Debo poder exportar los QR de uno o varios kits seleccionados en un único archivo PDF listo para imprimir.
- **CA4:** Cada etiqueta impresa debe contener el QR y, debajo de éste, el código alfanumérico legible, para soportar el ingreso manual definido en HU3-CA3.
- **CA5:** El sistema debe prevenir la generación de códigos duplicados.

---

### HU12 — Asignación de kits electorales a recintos y operadores
**Prioridad:** Alta

**Descripción:** Como administrador, quiero asignar kits electorales a sus respectivos recintos electorales y operadores de CDA, para garantizar la correcta distribución y trazabilidad el día de las elecciones.

**Criterios de aceptación:**

- **CA1:** Puedo asignar uno o varios kits electorales a un recinto electoral específico.
- **CA2:** Puedo asignar uno o varios kits electorales a un operador de CDA.
- **CA3:** Un kit electoral solo puede estar asignado a un único operador y a un único recinto electoral.
- **CA4:** El sistema valida automáticamente que el operador asignado al kit corresponda al operador asignado al recinto del kit; en caso de inconsistencia, alerta al administrador.
- **CA5:** La asignación puede realizarse de forma masiva (cargando un archivo Excel/CSV) o de forma manual desde la app web.
- **CA6:** Una vez iniciado el día de las elecciones, las asignaciones quedan bloqueadas y solo pueden modificarse mediante una autorización explícita registrada en bitácora.

---

### HU13 — Funcionamiento offline y sincronización
**Prioridad:** Alta

**Descripción:** Como operador de CDA, quiero que la app móvil funcione sin conexión a internet para poder registrar acciones críticas en recintos electorales con cobertura limitada o nula, especialmente en zonas rurales de Imbabura.

**Criterios de aceptación:**

- **CA1:** Las siguientes acciones deben poder realizarse offline: escaneo o ingreso manual de kits (HU3), captura de foto del militar (HU3), registro de llegada al recinto (HU3), registro de salida del recinto (HU4) y registro de llegada al DPI (HU5).
- **CA2:** Las acciones realizadas offline se almacenan localmente en el dispositivo, cada una con su sello de tiempo y ubicación GPS (si está disponible al momento de la acción).
- **CA3:** Al recuperar conexión, la app sincroniza automáticamente, en segundo plano y en orden cronológico, todas las acciones pendientes con el servidor.
- **CA4:** Mientras existan acciones sin sincronizar, se muestra un indicador visual permanente al usuario con el conteo de pendientes.
- **CA5:** Si una acción falla al sincronizar (por ejemplo, por validación del servidor), se notifica al operador y al técnico supervisor correspondiente.
- **CA6:** Durante el tramo de retorno al DPI (HU4), los puntos de rastreo GPS también se almacenan localmente cuando no hay conexión y se envían en lotes al recuperar señal, preservando la secuencia.

---

### HU14 — Reporte de incidencias
**Prioridad:** Alta

**Descripción:** Como operador de CDA, quiero reportar incidencias o novedades desde la app móvil para informar a los técnicos supervisores y administradores sobre cualquier eventualidad durante el proceso electoral.

**Criterios de aceptación:**

- **CA1:** Puedo crear un reporte de incidencia desde la app móvil con los siguientes campos: tipo de incidencia (kit dañado, kit faltante, problema en el recinto, retraso, problema de seguridad, otro), descripción libre y fotografía opcional.
- **CA2:** Cada incidencia se registra automáticamente con marca de tiempo, ubicación GPS y, si aplica, el kit o recinto electoral asociado.
- **CA3:** Los técnicos supervisores y administradores reciben una notificación inmediata por cada incidencia reportada.
- **CA4:** Las incidencias pueden ser revisadas, comentadas y marcadas como "atendidas" o "cerradas" desde la app web por los supervisores y administradores; cada cambio de estado queda registrado.
- **CA5:** Si la incidencia se reporta sin conexión, se almacena localmente y se sincroniza al recuperar señal, según HU13.

---

### HU15 — Dashboard y KPIs en tiempo real
**Prioridad:** Baja

**Descripción:** Como técnico supervisor o administrador, quiero visualizar un dashboard con métricas e indicadores clave del proceso electoral en tiempo real para tomar decisiones informadas durante la jornada.

**Criterios de aceptación:**

- **CA1:** El dashboard muestra contadores en tiempo real para cada estado del operador: en DPI (sin salir), en tránsito hacia el recinto, en recinto, en retorno y retornados al DPI.
- **CA2:** Mapa con la ubicación de todos los operadores actualmente bajo monitoreo (los que están en su tramo de retorno).
- **CA3:** Listado de incidencias abiertas y atendidas, ordenadas por severidad y por tiempo de reporte.
- **CA4:** Indicadores de tiempo: tiempo promedio de retorno y operadores con retraso (más allá del umbral configurado).
- **CA5:** Filtros por recinto electoral, cantón y técnico supervisor asignado.
- **CA6:** Para el rol de técnico supervisor, los datos del dashboard se limitan únicamente a los operadores de CDA bajo su responsabilidad.
- **CA7:** El dashboard se actualiza automáticamente sin necesidad de recargar la página.

---

### HU16 — Recuperación de contraseña
**Prioridad:** Media

**Descripción:** Como usuario del sistema, quiero recuperar mi contraseña si la he olvidado para poder volver a acceder al sistema sin depender de la intervención de un administrador.

**Criterios de aceptación:**

- **CA1:** En la pantalla de inicio de sesión (web y móvil) existe un enlace "¿Olvidaste tu contraseña?".
- **CA2:** Al hacer clic, se solicita al usuario su email registrado.
- **CA3:** Si el dato existe en el sistema, se envía un enlace de recuperación al email registrado, con vigencia limitada (1 hora).
- **CA4:** Al ingresar al enlace, se solicita establecer una nueva contraseña fuerte.
- **CA5:** Por seguridad, no se debe revelar si el email existe o no en el sistema; se muestra un mensaje genérico: "Si los datos son correctos, recibirás un enlace de recuperación".
- **CA6:** Cada intento de recuperación se registra en la bitácora de auditoría (HU17).

---

### HU17 — Auditoría y bitácora de eventos
**Prioridad:** Media

**Descripción:** Como administrador, quiero acceder a un registro inmutable de todas las acciones realizadas en el sistema para garantizar trazabilidad completa y cumplir con los estándares de transparencia exigidos en un proceso electoral.

**Criterios de aceptación:**

- **CA1:** Cada acción crítica se registra automáticamente con: marca de tiempo, usuario que realizó la acción, tipo de acción, datos modificados (valor anterior y nuevo cuando aplique), dispositivo, dirección IP y ubicación GPS si aplica.
- **CA2:** Las acciones críticas incluyen: inicio y cierre de sesión, registros de salida y llegada (HU2–HU5), escaneo de kits (HU3), reportes de incidencias (HU14), creación y modificación de usuarios, asignaciones, generación de QR y cambios de contraseña.
- **CA3:** Los registros de bitácora son de solo lectura y no pueden ser modificados ni eliminados desde ninguna interfaz del sistema.
- **CA4:** El administrador puede consultar la bitácora con filtros por: rango de fechas, usuario, tipo de acción y kit o recinto involucrado.
- **CA5:** El administrador puede exportar la bitácora completa o filtrada en formato CSV y PDF.
- **CA6:** La bitácora debe retenerse por un mínimo de cinco (5) años desde la fecha del evento electoral.

---

### HU18 — Alertas automáticas por anomalías
**Prioridad:** Media

**Descripción:** Como técnico supervisor o administrador, quiero recibir alertas automáticas ante anomalías o desvíos en el proceso para poder reaccionar a tiempo y mitigar riesgos.

**Criterios de aceptación:**

- **CA1:** El sistema genera una alerta cuando un operador no ha llegado al recinto después de X minutos (configurable) desde su salida del DPI.
- **CA2:** El sistema genera una alerta cuando un operador no ha llegado al DPI después de X minutos (configurable) desde su salida del recinto electoral.
- **CA3:** El sistema genera una alerta cuando un operador sin conexión no ha sincronizado datos durante más de X minutos (configurable).
- **CA4:** El sistema genera una alerta cuando un kit es escaneado por un operador al que no le corresponde, conforme a HU3-CA4.
- **CA5:** Las alertas se visualizan en el dashboard (HU15) y se envían como notificación push a la app móvil del técnico supervisor responsable.
- **CA6:** Los umbrales (X minutos) son configurables por el administrador desde una pantalla de configuración del sistema.
- **CA7:** Cada alerta queda registrada en la bitácora (HU17) con su estado (generada, vista, atendida).

---

### HU19 — Sistema de notificaciones (push y email)
**Prioridad:** Media

**Descripción:** Como técnico supervisor o administrador, quiero recibir notificaciones por push y por correo electrónico sobre los eventos relevantes del proceso electoral, para mantenerme informado en tiempo real sin necesidad de revisar constantemente el sistema.

**Criterios de aceptación:**

- **CA1:** El sistema envía notificaciones por dos canales: notificación push a la app móvil y correo electrónico al email registrado del usuario.
- **CA2:** Los eventos que generan notificación son: salida del operador del DPI (HU2), llegada al recinto (HU3), salida del recinto (HU4), llegada al DPI (HU5), reporte de incidencias (HU14) y alertas automáticas por anomalías (HU18).
- **CA3:** Las notificaciones push se envían a la app móvil del técnico supervisor responsable del operador involucrado. Los correos electrónicos se envían tanto al técnico supervisor responsable como a los administradores del sistema.
- **CA4:** Cada usuario puede configurar en su perfil qué tipos de notificación desea recibir y por qué canal (push, email, ambos, ninguno).
- **CA5:** Los correos electrónicos deben incluir un asunto descriptivo, el detalle del evento (operador, recinto, marca de tiempo) y un enlace directo a la app web para tomar acción.
- **CA6:** El sistema registra el envío de cada notificación en la bitácora (HU17), incluyendo el estado: enviada, entregada o fallida.
- **CA7:** Si falla el envío de una notificación por algún canal (por ejemplo, email rebotado o dispositivo sin conexión), el sistema reintentará automáticamente hasta tres (3) veces con espaciado progresivo.

---

### HU20 — Gestión de eventos electorales
**Prioridad:** Media

**Descripción:** Como administrador, quiero gestionar múltiples eventos electorales (elecciones generales, segundas vueltas, consultas populares, referendos) para poder reutilizar el sistema en futuros procesos sin perder la trazabilidad histórica de eventos previos.

**Criterios de aceptación:**

- **CA1:** El sistema permite crear un evento electoral con los siguientes datos: nombre, tipo (elección general, segunda vuelta, consulta popular, referéndum, otro), fecha de la jornada y descripción.
- **CA2:** Solo puede existir un evento electoral activo a la vez. Los eventos pasados quedan archivados pero permanecen consultables.
- **CA3:** Las asignaciones de kits, operadores y recintos están vinculadas al evento electoral activo. Al activar un nuevo evento, se requiere realizar nuevamente las asignaciones correspondientes.
- **CA4:** Los datos históricos de eventos cerrados (asignaciones, bitácora, incidencias, registros GPS) se mantienen disponibles solo para consulta y no son editables.
- **CA5:** El administrador puede generar reportes consolidados por evento electoral, incluyendo: número de operadores movilizados, recintos cubiertos, incidencias reportadas y tiempos promedio de retorno.
- **CA6:** El cierre de un evento electoral requiere confirmación explícita por parte del administrador y queda registrado en la bitácora (HU17).
- **CA7:** Antes de poder cerrar un evento, el sistema valida que todos los operadores hayan registrado su llegada al DPI (HU5); en caso contrario, lista los pendientes y requiere justificación.

---

## 3. Notas y consideraciones técnicas

- El día de las elecciones puede haber un máximo de 100 usuarios concurrentes.
- Los datos de cantones, provincias y recintos electorales ya estarán precargados en la base de datos.
- El sistema está dimensionado específicamente para la provincia de Imbabura, pero está preparado para reutilizarse en futuros procesos electorales mediante la entidad "Evento Electoral" (HU20).
- La comunicación entre app móvil y servidor debe realizarse sobre HTTPS.
- Toda fotografía capturada (militar, evidencia de incidencia) debe almacenarse cifrada en reposo.
- Los registros de bitácora (HU17) deben tener retención mínima de 5 años.
- El militar es un registro únicamente referencial dentro del sistema: no opera la app móvil, no dispone de credenciales y no confirma la entrega por sistema. La cadena de custodia se documenta de forma unidireccional desde el operador de CDA mediante el escaneo de QR (HU3) y la fotografía como evidencia.
- Las notificaciones a supervisores y administradores se envían por dos canales: notificación push y correo electrónico, según se define en HU19.
