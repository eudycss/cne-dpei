# Pruebas de estrés — día de elecciones

Ver `election-day.js`. Requiere Docker y el API corriendo localmente.

```bash
docker run --rm -i \
  -e BASE_URL=http://host.docker.internal:3000 \
  -e TEST_EMAIL=k6-loadtest@cne-imbabura.gob.ec \
  -e TEST_PASSWORD='LoadTest*2026Temp' \
  -v "$(pwd)/loadtest:/scripts" \
  grafana/k6 run /scripts/election-day.js
```

El usuario `k6-loadtest@cne-imbabura.gob.ec` es una cuenta dedicada solo para
pruebas de carga (rol ADMINISTRADOR), creada con `create-loadtest-user.ts`.
No es el admin real. Bórrala en producción/antes de desplegar si no la quieres
en la base de datos:

```sql
DELETE FROM usuarios WHERE email = 'k6-loadtest@cne-imbabura.gob.ec';
```
