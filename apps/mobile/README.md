# @cne/mobile

App móvil de campo (React Native + Expo SDK 51) del sistema logístico CNE Imbabura. Ver el `CLAUDE.md` de la raíz del repo para la arquitectura general del monorepo.

## Generar el APK localmente (sin EAS)

Esta sección documenta cómo compilar el APK debug con Gradle directamente, sin depender de `eas build`.

### Prerequisitos

- **Android Studio** con el SDK de Android instalado (necesitas `ANDROID_HOME` apuntando a esa instalación, típicamente `%LOCALAPPDATA%\Android\Sdk`).
- **JDK 17** — Gradle 8.8 (el que usa Expo SDK 51) no es compatible con JDK 25, que es lo que trae el JBR embebido de Android Studio. Si no tienes un JDK 17 standalone:
  - Preferido: instalar vía `winget install EclipseAdoptium.Temurin.17.JDK` (requiere permisos; puede estar bloqueado por política de equipo).
  - Alternativo sin admin: descargar el ZIP portable de [Adoptium Temurin 17](https://adoptium.net/temurin/releases/?version=17) y descomprimirlo en una carpeta de usuario (p. ej. `%USERPROFILE%\tools\jdk-17.x.x+y`).

### Variables de entorno

```bash
setx ANDROID_HOME "%LOCALAPPDATA%\Android\Sdk"
setx JAVA_HOME "<ruta a tu JDK 17>"
```

`setx` persiste el valor para sesiones de terminal **nuevas** — una terminal ya abierta antes del `setx` no lo hereda; ábrela de nuevo o exporta la variable manualmente en la sesión actual.

### Comandos

```bash
cd apps/mobile
npx expo prebuild --platform android --clean
cd android
./gradlew assembleDebug --console=plain
```

El APK queda en `apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`. Para instalarlo en un dispositivo/emulador conectado:

```bash
adb install app/build/outputs/apk/debug/app-debug.apk
```

> ⚠️ **Este build (`assembleDebug`) no sirve para instalar de forma standalone.** Por defecto, React Native no embebe el bundle de JS en la variante `debug` (solo en `release`) — el APK depende de que el servidor Metro (`pnpm --filter @cne/mobile start`) esté corriendo y accesible desde el dispositivo. Es útil para desarrollo/debug en la misma red, pero **no** para instalar en el celular de un operador de campo — para eso usa la siguiente sección.

### Build para distribuir en campo (APK standalone, sin Metro)

Para un APK que funcione solo, sin depender de Metro ni de esta máquina, hay que compilar la variante **`release`** (sí embebe el bundle de JS y las variables de entorno). Ya está firmada con el keystore de debug (`signingConfig signingConfigs.debug` en `android/app/build.gradle`), así que no hace falta generar un keystore de producción — alcanza para pruebas internas/de campo, no para Play Store.

Además, si existe `apps/mobile/.env.development.local` en tu máquina, Expo lo prioriza sobre `.env` y el APK queda embebido con la URL que tenga ese archivo (típicamente una IP LAN local, no el backend de producción) — hay que sacarlo del camino antes de compilar. Antes de compilar un APK para repartir en una jornada real:

1. Renombra temporalmente el archivo para que Expo no lo cargue:
   ```bash
   mv apps/mobile/.env.development.local apps/mobile/.env.development.local.bak
   ```
2. Compila la variante release:
   ```bash
   npx expo prebuild --platform android --clean
   cd android
   ./gradlew assembleRelease --console=plain
   ```
   Con el `.local` fuera del camino, Expo cae a `EXPO_PUBLIC_API_URL` de `apps/mobile/.env` (Render, producción).
3. Verifica antes de instalar (el bundle de JS está comprimido dentro del APK, así que `strings` sobre el `.apk` directamente no encuentra nada — hay que extraerlo primero):
   ```bash
   unzip -o -q android/app/build/outputs/apk/release/app-release.apk assets/index.android.bundle -d /tmp/apk-check
   grep -a -o 'https\?://[a-zA-Z0-9.-]*' /tmp/apk-check/assets/index.android.bundle | sort -u
   ```
   Debería aparecer `https://cne-imbabura-api.onrender.com`; si en cambio aparece una IP `192.168.*`/`10.*`, el build tomó la URL equivocada.
4. El APK queda en `apps/mobile/android/app/build/outputs/apk/release/app-release.apk`:
   ```bash
   adb install android/app/build/outputs/apk/release/app-release.apk
   ```
5. Restaura el archivo para seguir desarrollando localmente:
   ```bash
   mv apps/mobile/.env.development.local.bak apps/mobile/.env.development.local
   ```

`apps/mobile/android/` es output regenerado por `expo prebuild` y está en `.gitignore` — nunca edites archivos ahí a mano de forma permanente, se pierden en el siguiente `--clean`.

### Sobre `plugins/withPnpmGradlePluginFix.js`

Este monorepo usa pnpm con `shamefullyHoist: true` (ver `pnpm-workspace.yaml` y `.npmrc`). En algunos estados de `node_modules` (por ejemplo si el hoisting real en disco no coincide con lo esperado tras un reinstall), `require.resolve('@react-native/gradle-plugin/package.json')` sin un hint de `paths` puede no resolver el paquete y romper el build de Gradle.

El config plugin `plugins/withPnpmGradlePluginFix.js` (registrado en `app.json` → `expo.plugins`) parchea `android/settings.gradle` en cada `expo prebuild` para que esa llamada siempre incluya `{ paths: [require.resolve('react-native/package.json')] }`. Es idempotente: si el `settings.gradle` generado ya trae el hint (porque el template de Expo lo agregó por defecto), no hace nada. Así el build no vuelve a depender de un estado exacto de `node_modules` en esta o en otra máquina.

### Troubleshooting

Problemas reales encontrados armando este build local (Windows + pnpm), documentados para no perder tiempo re-diagnosticándolos:

**`EPERM: operation not permitted, rename 'node_modules\typescript' -> 'node_modules\.ignored_typescript'`** al correr `pnpm install` o `npx expo install <paquete>`.
Causa: algún proceso tiene un handle abierto sobre `node_modules/typescript` — típicamente **instancias de `nest start --watch` (`pnpm dev:api`) o de Vite (`pnpm dev:web`) que quedaron corriendo en segundo plano** de una sesión anterior sin cerrar, no necesariamente el TS Server de tu editor. Diagnóstico y fix (PowerShell):
```powershell
Get-CimInstance Win32_Process -Filter "name = 'node.exe'" | Where-Object { $_.CommandLine -match 'nest|vite' } | Select-Object ProcessId, CommandLine
Stop-Process -Id <PID> -Force
```
Cierra solo las instancias que sean duplicadas/huérfanas; si tienes una terminal activa corriendo `pnpm dev:api`/`dev:web` que sí necesitas, no la mates. Si usas VS Code y el proceso resulta ser el TS Server del editor, se libera desde `Ctrl+Shift+P` → "Developer: Open Process Explorer" → matar el proceso `tsserver` puntual (sin cerrar el editor).

**`node-linker`/`shamefully-hoist` en `.npmrc` no tienen efecto (Metro no resuelve dependencias de Expo).**
Causa: en pnpm 11 esas opciones se movieron de `.npmrc` a `pnpm-workspace.yaml` (`nodeLinker`/`shamefullyHoist`); si siguen solo en `.npmrc`, pnpm las ignora en silencio sin avisar. La config correcta de este repo es `shamefullyHoist: true` en `pnpm-workspace.yaml` (sin `nodeLinker: hoisted` — eso rompe el CLI de Expo). Ver también `.gitattributes` (`eol=lf`): en Windows, un `.npmrc`/`.yaml` guardado con CRLF puede hacer que un valor como `shamefullyHoist: true\r` no matchee y se ignore igual de silencioso.

**Gradle falla o se cuelga en la fase de configuración con un JDK moderno (17.0.20+8 build info, "Unsupported class file major version", etc.).**
Causa: Gradle 8.8 (el que trae Expo SDK 51) no corre bien con JDK 25 — que es lo que suele traer por defecto `JAVA_HOME` si apunta al JBR embebido de Android Studio (`C:\Program Files\Android\Android Studio\jbr`). Solución: instalar/usar un JDK 17 y apuntar `JAVA_HOME` ahí (ver "Variables de entorno" arriba). Si acabas de correr `setx JAVA_HOME`, recuerda que una terminal ya abierta no lo hereda — ábrela de nuevo.
