# Checklist — preparar el sistema para una jornada real con operadores

Este checklist es para cuando el día de operación con los 20 operadores **importa de
verdad** (hay evidencia real, decisiones que dependen de que el sistema no falle). Complementa
`DESPLIEGUE_PRUEBAS.md` — asume que ya tienes el entorno de pruebas (Render + Supabase +
Vercel + APK) funcionando y solo lo estás reforzando para ese día puntual.

---

## Días antes del evento

### Infraestructura

- [ ] **Subir el API de Render a plan Starter** ($7/mes, pero Render cobra **por segundo de
      uso real**, no por mes fijo — si lo usas 2 días y bajas a Free, pagas ~$0.47, no $7).
      Dashboard de Render → tu servicio `cne-imbabura-api` → **Settings** → **Instance Type** →
      elegir `Starter`. Esto elimina el "dormido" tras 15 min sin tráfico.

- [ ] **Después del evento, bajar de vuelta a Free manualmente** (no es automático — si
      dejas el plan en Starter "por si acaso", te sigue cobrando por segundo indefinidamente).

- [ ] **"Despertar" Supabase** — entra al dashboard del proyecto para resetear el contador de
      7 días de inactividad y confirmar que no está pausado.

- [ ] **Congelar cambios** a la rama desplegada (`probarweb` o la que uses en Render/Vercel)
      desde 2-3 días antes del evento. Cualquier push dispara un redeploy = reinicio del
      servicio en pleno uso.

### Base de datos

- [ ] **Respaldo de la base** antes del evento (línea base para poder comparar/recuperar si
      algo sale mal):
      ```powershell
      # Desde apps/api, con $env:DATABASE_URL apuntando a Supabase (ver Fase 4 de DESPLIEGUE_PRUEBAS.md)
      pg_dump $env:DATABASE_URL -F c -f "backup-pre-evento.dump"
      ```

### App móvil

- [ ] Confirmar que `apps/mobile/eas.json` → perfil `preview` → `EXPO_PUBLIC_API_URL` apunta a
      la URL real de Render (no a una IP local ni a `localhost`).
- [ ] Generar el APK final:
      ```bash
      cd apps/mobile
      npx eas build --platform android --profile preview --local
      ```
- [ ] Instalar ese mismo APK en **al menos 2-3 celulares reales** (no solo emulador) y probar
      el flujo completo de un operador (login, salida DPI, tránsito, llegada, kit, incidencia)
      contra el backend ya en plan Starter.
- [ ] Repartir el APK a los 20 operadores con margen (no el mismo día) y confirmar que cada
      uno lo instaló y pudo iniciar sesión al menos una vez.
- [ ] Guardar el keystore que generó EAS en un lugar seguro (lo vas a necesitar si algún día
      quieres firmar una actualización del mismo APK; si se pierde, todos tendrían que
      reinstalar desde cero).

---

## La mañana del evento

- [ ] **Calentar la API** 20-30 min antes de que arranquen los operadores: abre
      `https://TU-API.onrender.com/api/docs` o haz un login de prueba desde Swagger.
- [ ] Confirmar que la web (`https://TU-WEB.vercel.app`) carga y el login funciona — esta es
      la pantalla de monitoreo para supervisores.
- [ ] Avisar a los operadores: *"si al abrir la app se ve trabada o tarda en cargar la primera
      vez, esperen ~1 minuto antes de forzar cierre o reintentar"* (cubre cualquier cold-start
      residual).
- [ ] Designar a alguien (tú u otra persona) para **monitorear el dashboard web en vivo**
      durante toda la jornada y detectar fallos rápido.

---

## Durante el evento

- [ ] **No hacer push ni redeploy** a Render/Vercel bajo ninguna circunstancia hasta que
      termine la jornada.
- [ ] Tener un canal rápido (WhatsApp grupal, radio) para que los operadores reporten
      problemas al instante, no al final del día.
- [ ] Si algo falla, revisar primero **Render → Logs** antes de asumir que es la app móvil —
      la cola offline del celular (`offline-queue.ts`) ya reintenta solo ante caídas
      temporales del servidor, así que muchos problemas se resuelven solos en unos minutos.

---

## Después del evento

- [ ] Respaldo final de la base de datos (mismo comando `pg_dump` de arriba, con otro nombre
      de archivo).
- [ ] Revisar la bitácora de auditoría (`bitacora_auditoria`, inmutable) para confirmar que los
      eventos esperados quedaron registrados.
- [ ] Decidir si mantienes Render en Starter (si vas a seguir operando seguido) o si vuelves a
      Free hasta el próximo evento importante.
