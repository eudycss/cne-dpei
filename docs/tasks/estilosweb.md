# Estilos Web — CNE Imbabura · Trazabilidad Electoral

> **Rama de trabajo obligatoria:** todo lo descrito en este documento debe implementarse en la rama **`estilos-web`**. No se hacen commits directos a `main`; los cambios se integran mediante Pull Request una vez aprobadas las pruebas.

```bash
git checkout main && git pull
git checkout -b estilos-web
# ... trabajo ...
git push -u origin estilos-web
```

---

## 1. Alcance

- **Página analizada:** `https://cne-dpei-web.vercel.app/operadores` (vista *Monitoreo de operadores en ruta*), en tema oscuro.
- **Librería de referencia:** React Bits, sección **Micro** (`https://reactbits.dev/c/micro`), con 34 componentes animados, todos gratuitos.
- **Objetivo:** mejorar la estética, la consistencia visual y la accesibilidad (WCAG 2.1 AA), e integrar microinteracciones que aporten información útil, no decoración.

---

## 2. Diagnóstico del estado actual

### 2.1 Sistema de diseño detectado

| Elemento | Valor actual | Observación |
|---|---|---|
| Tipografía | `"DM Sans", system-ui, sans-serif` | Buena elección, moderna y legible |
| Fondo (oscuro) | `#0f172a` (slate-900) | Correcto |
| Tarjetas | `#1e293b` aprox. | Buen contraste con el fondo |
| Tokens | `--bg`, `--bg-card`, `--primary`, `--success-bg`, `--warn-bg`, `--error-bg`, etc. en `:root` | Bien organizados; hay que reutilizarlos en los componentes nuevos |
| Primario | `--primary: #2563eb` | Correcto |
| Animaciones existentes | `operador-pulse` (marcador del mapa), `sileo-*` (toasts con easing de resorte), `maplibregl-*` | Sileo ya cubre los toasts, así que no hace falta otra librería de toasts |
| Mapa | MapLibre GL + teselas OSM claras | Choca con el tema oscuro |

### 2.2 Problemas encontrados por componente

| # | Componente | Problema | Severidad | Solución |
|---|---|---|---|---|
| 1 | Filtro "Todos los cantones" | `<select>` nativo sin estilo (blanco sobre fondo oscuro) | Alta | Reemplazar por **Glide Select** o darle estilo con los tokens |
| 2 | Columna **Estado** de la tabla | El texto "En tránsito" está dividido en un `<span>` por letra, así que el lector de pantalla lo lee letra por letra | Alta (a11y) | `aria-label` en el contenedor y `aria-hidden="true"` en las letras |
| 3 | Pie de la barra lateral | El badge del rol se corta y "Cerrar sesión" queda oculto (hay que hacer scroll) | Alta | Hacer fijo el bloque del usuario (`position: sticky; bottom: 0`) |
| 4 | Badge del rol | Muestra el valor crudo `TECNICO_SUPERVISOR` | Media | Mapear a "Técnico supervisor" |
| 5 | Mapa base | Teselas claras en tema oscuro | Media | Usar un estilo oscuro (p. ej. CARTO *Dark Matter*) cuando `theme === 'dark'` |
| 6 | Contadores de estado | "En DPI: 0 · En tránsito: 1…" en texto plano, sin jerarquía | Media | Tarjetas KPI con número grande más **Slosh Gauge** para el % de llegada |
| 7 | Tabla de CDAs | Scroll horizontal; "Foto militar" se corta | Media | Primera columna fija (`position: sticky; left: 0`) y vista de tarjetas en móvil (< 768 px) |
| 8 | Botones desactivados ("Ver foto") | Contraste muy bajo (< 4.5:1) | Media (a11y) | Subir la opacidad y agregar un tooltip que explique el motivo |
| 9 | Menú lateral | Sin iconos y el elemento activo apenas se distingue | Baja | Iconos y una barra de acento a la izquierda del activo |
| 10 | "Se actualiza cada 10 segundos" | No hay feedback visual del refresco | Baja | **Status Mark** o **Call Chip** con la hora y la latencia de la última sincronización |

---

## 3. Componentes de React Bits Micro seleccionados

### 3.1 Recomendados

| Prioridad | Componente | URL | Uso en el sistema |
|---|---|---|---|
| Alta | Glide Select | `/c/micro/glide-select` | Filtro de cantones (y otros selects del sistema) |
| Alta | Rubber Segment | `/c/micro/rubber-segment` | Filtro por estado: Todos / En DPI / Tránsito / Recinto / Retorno / Llegó |
| Alta | Bell Toggle | `/c/micro/bell-toggle` | Campana de notificaciones que "suena" al llegar una incidencia o alerta nueva |
| Alta | Status Mark | `/c/micro/status-mark` | Indicador "Actualizando…" que pasa a ✓ en cada refresco de 10 s; estado de subida de actas o fotos |
| Alta | Warm Tooltip | `/c/micro/warm-tooltip` | Controles del mapa, botones desactivados y significado de cada estado |
| Media | Slosh Gauge | `/c/micro/slosh-gauge` | % de CDAs que llegaron al DPEI |
| Media | Lattice Loader | `/c/micro/lattice-loader` | Carga inicial del mapa y de la tabla |
| Media | Call Chip | `/c/micro/call-chip` | "GPS · sincronizado · 320 ms" |
| Media | Hold Button | `/c/micro/hold-button` | Confirmar acciones destructivas (eliminar asignación, cerrar incidencia) |
| Media | Slide Commit | `/c/micro/slide-commit` | Confirmar recepción de kits o actas |
| Media | Swipe Row | `/c/micro/swipe-row` | Lista "En ruta" en móvil (deslizar para ver ubicación). Reutilizable en la app de Expo |
| Baja | Spring Check | `/c/micro/spring-check` | Checklists de constatación de kits |
| Baja | Squish Switch | `/c/micro/squish-switch` | Activar o desactivar la actualización automática |
| Baja | Flip Card | `/c/micro/flip-card` | Tarjetas KPI con el detalle al reverso |

### 3.2 Descartados (no aptos para un sistema institucional)

| Componente | Motivo |
|---|---|
| Shredder, Paper Crumple, Tear Ticket | Metáforas lúdicas; transmiten poca seriedad |
| Dodge Field | El campo esquiva el cursor: es un antipatrón de UX y de accesibilidad |
| Pulse Heart, Peek Rating | Likes y calificaciones: no aplican al dominio |
| Voice Pill, Prompt Bar, Thought Line | Orientados a interfaces de IA o chat |
| Sling Button, Jelly Radio, Folder Float, Branched Menu, Refine Frame | Decorativos, sin valor funcional aquí |
| Comet Dial, Wake Slider, Scrub Field, Code Slots, Fuse Button | No hay un caso de uso claro por ahora (Code Slots podría servir si se agrega 2FA) |
| Swipe Toast | Duplica a Sileo, que ya está integrado |

---

## 4. Guía de integración

### 4.1 Dependencias

Los componentes Micro usan `motion` y los iconos Hugeicons:

```bash
npm install motion @hugeicons/react @hugeicons/core-free-icons
```

Después de instalar, **fija versiones exactas** en `package.json` (sin `^`) y confirma los cambios de `package-lock.json`:

```bash
npm pkg get dependencies.motion
npm audit --omit=dev
```

### 4.2 Estructura de carpetas propuesta

```
src/
├─ components/
│  └─ micro/                  # Código copiado de React Bits (sin modificar lógica)
│     ├─ GlideSelect/
│     │  ├─ GlideSelect.jsx
│     │  ├─ GlideSelect.css
│     │  └─ GlideSelect.test.jsx
│     ├─ RubberSegment/
│     ├─ BellToggle/
│     ├─ StatusMark/
│     └─ WarmTooltip/
├─ components/ui/             # Wrappers propios que adaptan micro/* a los tokens del CNE
│  ├─ CantonSelect.jsx
│  ├─ EstadoFilter.jsx
│  ├─ NotificationBell.jsx
│  └─ SyncIndicator.jsx
└─ styles/
   └─ tokens.css              # Variables existentes + nuevas
```

> **Regla:** la carpeta `micro/` contiene el código de terceros tal cual. Toda personalización (colores, textos, lógica de negocio) va en `ui/`. Así se pueden actualizar los componentes sin conflictos.

### 4.3 Cómo copiar cada componente

1. Abrir la página del componente en React Bits y pasar a la pestaña **Code**.
2. En **Install**, elegir **Manual** y ejecutar el comando `npm install` que muestra, si agrega algo nuevo.
3. Copiar el código fuente en `src/components/micro/<Nombre>/`. Si ofrece una variante CSS y otra Tailwind, usar la **CSS**, porque el proyecto usa CSS con variables y no Tailwind.
4. **Revisar el código antes de confirmarlo**: que no tenga `dangerouslySetInnerHTML`, `eval`, fetch a dominios externos ni scripts de CDN.
5. Crear el wrapper en `ui/` y pasarle los colores desde los tokens.

### 4.4 Adaptación a los tokens

No dejes los colores hex por defecto de React Bits. Usa las variables existentes:

```jsx
// src/components/ui/NotificationBell.jsx
import BellToggle from '../micro/BellToggle/BellToggle';

const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

export default function NotificationBell({ unread, onOpen }) {
  return (
    <BellToggle
      offLabel="Notificaciones"
      onLabel={`${unread} sin leer`}
      color={css('--text')}
      aria-label={`Notificaciones, ${unread} sin leer`}
      onClick={onOpen}
    />
  );
}
```

> Las props exactas de cada componente deben verificarse en su pestaña **Code**. El ejemplo usa las que muestra Bell Toggle (`offLabel`, `onLabel`, `color`).

Tokens nuevos sugeridos en `tokens.css`:

```css
:root {
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;
  --accent-bar: var(--primary);
  --focus-ring: 0 0 0 3px color-mix(in srgb, var(--primary) 45%, transparent);
  --estado-dpi: #94a3b8;
  --estado-transito: #8b5cf6;
  --estado-recinto: #f59e0b;
  --estado-retorno: #3b82f6;
  --estado-llego: #22c55e;
  --dur-fast: 150ms;
  --dur-base: 250ms;
}
```

### 4.5 Accesibilidad y movimiento reducido (obligatorio)

Envolver la app una sola vez:

```jsx
// src/main.jsx
import { MotionConfig } from 'motion/react';

root.render(
  <MotionConfig reducedMotion="user">
    <App />
  </MotionConfig>
);
```

Y en CSS global:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}

:focus-visible { outline: none; box-shadow: var(--focus-ring); }
```

Checklist WCAG por componente:

| Requisito | Criterio |
|---|---|
| Navegable por teclado (Tab, Enter, Espacio, flechas en selects y segmentos) | 2.1.1 |
| Foco visible | 2.4.7 |
| Contraste del texto ≥ 4.5:1 y de los elementos de UI ≥ 3:1 | 1.4.3 / 1.4.11 |
| `aria-label`, `role` y `aria-live="polite"` en indicadores que cambian (Status Mark, contadores) | 4.1.2 / 4.1.3 |
| Respeta `prefers-reduced-motion` | 2.3.3 |
| Tamaño mínimo de objetivo táctil de 24×24 px (ideal 44×44) | 2.5.8 |

### 4.6 Correcciones CSS sin librerías

```css
/* Pie de la barra lateral fijo */
.sidebar { display: flex; flex-direction: column; }
.sidebar .user-block { position: sticky; bottom: 0; background: var(--bg-sidebar); padding-block: 12px; }

/* Elemento activo del menú */
.sidebar a.active { position: relative; background: var(--bg-sidebar-hover); }
.sidebar a.active::before {
  content: ''; position: absolute; left: 0; top: 20%; bottom: 20%;
  width: 3px; border-radius: 3px; background: var(--accent-bar);
}

/* Primera columna fija en la tabla */
.table-wrap { overflow-x: auto; }
.table-wrap th:first-child, .table-wrap td:first-child {
  position: sticky; left: 0; background: var(--bg-card); z-index: 1;
}

/* Botones desactivados legibles */
.btn:disabled { opacity: .6; cursor: not-allowed; }
```

Columna Estado accesible:

```jsx
<span className="estado" aria-label={estado}>
  {estado.split('').map((l, i) => <span key={i} aria-hidden="true">{l}</span>)}
</span>
```

Mapa oscuro:

```js
const MAP_STYLE = {
  light: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
  dark:  'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
};
map.setStyle(MAP_STYLE[theme]);
```

> Al cambiar el estilo, vuelve a agregar las capas y los marcadores en el evento `style.load`. Si hay una CSP, agrega `basemaps.cartocdn.com` a `connect-src` e `img-src`.

---

## 5. Seguridad

- Revisar manualmente todo el código copiado; es código de terceros.
- Versiones exactas en `package.json` y `npm audit` sin vulnerabilidades altas ni críticas antes del merge.
- No cargar scripts ni estilos desde CDN; todo se empaqueta con el build.
- Los textos que vengan de la API (nombres de recintos, operadores) se renderizan como texto, nunca con `dangerouslySetInnerHTML`.
- Mantener o actualizar la **Content-Security-Policy** en `vercel.json` si se agregan dominios de teselas.

---

## 6. Pruebas unitarias (Jest + React Testing Library)

Cada wrapper de `ui/` debe tener su archivo `*.test.jsx`. Casos mínimos:

| Componente | Casos |
|---|---|
| CantonSelect | Renderiza las opciones; cambia de valor con teclado (flechas y Enter); llama a `onChange` con el cantón correcto |
| EstadoFilter | Marca el segmento activo con `aria-pressed` o `aria-selected`; filtra las filas de la tabla |
| NotificationBell | Muestra el número de no leídas en su `aria-label`; llama a `onOpen` al hacer clic |
| SyncIndicator | Muestra "Actualizando" y luego "Actualizado"; tiene `aria-live="polite"` |
| Columna Estado | `getByLabelText('En tránsito')` existe; las letras tienen `aria-hidden` |
| Movimiento reducido | Con `matchMedia('(prefers-reduced-motion: reduce)')` simulado, el componente renderiza sin errores |

Ejemplo:

```jsx
// src/components/ui/NotificationBell.test.jsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import NotificationBell from './NotificationBell';

test('anuncia las notificaciones sin leer y abre el panel', async () => {
  const onOpen = jest.fn();
  render(<NotificationBell unread={28} onOpen={onOpen} />);
  const btn = screen.getByRole('button', { name: /28 sin leer/i });
  await userEvent.click(btn);
  expect(onOpen).toHaveBeenCalledTimes(1);
});
```

Mock necesario para `motion` en jsdom (`jest.setup.js`):

```js
window.matchMedia ??= (q) => ({
  matches: false, media: q, addEventListener() {}, removeEventListener() {},
  addListener() {}, removeListener() {}, onchange: null, dispatchEvent() { return false; },
});
```

Ejecución reproducible con Docker (opcional):

```bash
docker run --rm -v "$PWD":/app -w /app node:22-alpine sh -c "npm ci && npm test -- --coverage"
```

---

## 7. Plan de trabajo en la rama `estilos-web`

| Fase | Tareas | Commit sugerido |
|---|---|---|
| 1 | Crear la rama; agregar `tokens.css`, reglas de `prefers-reduced-motion` y foco visible | `style: tokens de diseño y reglas base de accesibilidad` |
| 2 | Correcciones CSS: barra lateral, menú activo, tabla con columna fija, botones desactivados, columna Estado accesible | `fix(a11y): sidebar, tabla y estados accesibles` |
| 3 | Mapa oscuro según el tema | `feat(mapa): estilo oscuro según tema` |
| 4 | Instalar dependencias; integrar Glide Select y Rubber Segment | `feat(ui): filtros de cantón y estado animados` |
| 5 | Bell Toggle, Status Mark y Warm Tooltip | `feat(ui): notificaciones, indicador de sincronización y tooltips` |
| 6 | Tarjetas KPI + Slosh Gauge; Lattice Loader | `feat(ui): KPIs de llegada y loaders` |
| 7 | Pruebas unitarias; `npm audit`; revisión con Lighthouse y axe | `test: cobertura de componentes de estilos web` |
| 8 | Push y Pull Request `estilos-web → main` con capturas antes y después | — |

---

## 8. Criterios de aceptación del PR

- [ ] Todo el trabajo está en la rama `estilos-web`.
- [ ] No quedan `<select>` nativos sin estilo en la vista de Monitoreo.
- [ ] El mapa se ve oscuro en tema oscuro y claro en tema claro.
- [ ] "Cerrar sesión" es visible sin hacer scroll en la barra lateral.
- [ ] Lighthouse Accessibility ≥ 95 y axe DevTools sin errores críticos.
- [ ] Con `prefers-reduced-motion: reduce` no hay animaciones.
- [ ] `npm test` pasa con cobertura ≥ 80 % en `src/components/ui/`.
- [ ] `npm audit` sin vulnerabilidades altas ni críticas.
- [ ] Capturas antes y después en tema claro y oscuro adjuntas al PR.
