import * as maplibregl from 'maplibre-gl';
// MapLibre v6 calcula la ruta de su worker en tiempo de ejecución
// (new URL(`./${nombre}`, import.meta.url)), algo que Vite no puede seguir: en
// dev da "Worker failed to load" y en el build el worker ni se incluye. Con
// ?worker&url Vite empaqueta el worker (y maplibre-gl-shared.mjs, que importa)
// y devuelve su URL, que se registra con la API oficial setWorkerUrl.
import urlWorker from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

maplibregl.setWorkerUrl(urlWorker);

export { urlWorker };
