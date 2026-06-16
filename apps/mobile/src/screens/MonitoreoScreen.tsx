import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import type { OperadorEnRetorno } from '@cne/shared-types';
import { useAuth } from '../auth/AuthContext';
import { useTheme } from '../theme/ThemeContext';
import { Colors } from '../theme/colors';
import { AppBar } from '../components/AppBar';
import { getOperadoresEnRetorno } from '../lib/queries/monitoreo';
import { fontFamily } from '../theme/typography';

const POLL_MS = 10_000;

// HTML del mapa: Leaflet desde CDN + función global setOperadores(arr) que la app
// invoca por injectJavaScript cada vez que llegan posiciones nuevas.
const MAPA_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <style>html,body,#map{height:100%;margin:0;padding:0}</style>
</head>
<body>
  <div id="map"></div>
  <script>
    var map = L.map('map').setView([0.35, -78.12], 11);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap'
    }).addTo(map);
    var capa = L.layerGroup().addTo(map);
    var icono = L.divIcon({
      className: 'op',
      html: '<div style="background:#2563eb;width:18px;height:18px;border-radius:50%;border:3px solid #fff;box-shadow:0 0 0 1px #2563eb"></div>',
      iconSize: [18, 18], iconAnchor: [9, 9]
    });
    window.setOperadores = function (ops) {
      capa.clearLayers();
      var pts = [];
      for (var i = 0; i < ops.length; i++) {
        var o = ops[i];
        var kitsHtml = '';
        for (var j = 0; j < o.kits.length; j++) {
          kitsHtml += '<li>' + o.kits[j].codigoUnico + ' — ' + o.kits[j].nombre + '</li>';
        }
        var popup = '<strong>' + o.operadorNombre + '</strong><br/>' +
          '<span>Kits (' + o.kits.length + '):</span><ul style="margin:4px 0 0;padding-left:16px">' + kitsHtml + '</ul>';
        L.marker([o.latitud, o.longitud], { icon: icono }).bindPopup(popup).addTo(capa);
        pts.push([o.latitud, o.longitud]);
      }
      if (pts.length > 0) {
        map.fitBounds(pts, { padding: [40, 40], maxZoom: 15 });
      }
    };
    document.addEventListener('message', function (e) {
      try { window.setOperadores(JSON.parse(e.data)); } catch (err) {}
    });
    window.addEventListener('message', function (e) {
      try { window.setOperadores(JSON.parse(e.data)); } catch (err) {}
    });
  </script>
</body>
</html>`;

function formatearHora(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' });
}

export function MonitoreoScreen() {
  const { logout } = useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const webviewRef = useRef<WebView>(null);
  const listoRef = useRef(false);
  const [operadores, setOperadores] = useState<OperadorEnRetorno[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      const data = await getOperadoresEnRetorno();
      setOperadores(data);
      setError(null);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'No se pudo cargar el monitoreo');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    cargar();
    const id = setInterval(cargar, POLL_MS);
    return () => clearInterval(id);
  }, [cargar]);

  // Inyecta las posiciones al WebView cuando cambian (y ya cargó el mapa).
  useEffect(() => {
    if (!listoRef.current || !webviewRef.current) return;
    const payload = JSON.stringify(operadores);
    webviewRef.current.injectJavaScript(`window.setOperadores(${payload});true;`);
  }, [operadores]);

  return (
    <View style={styles.container}>
      <AppBar subtitle="Monitoreo de operadores" />
      <View style={styles.mapWrap}>
        <WebView
          ref={webviewRef}
          originWhitelist={['*']}
          source={{ html: MAPA_HTML }}
          onLoadEnd={() => {
            listoRef.current = true;
            webviewRef.current?.injectJavaScript(
              `window.setOperadores(${JSON.stringify(operadores)});true;`,
            );
          }}
          style={styles.map}
        />
      </View>

      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        <Text style={styles.listTitle}>
          En retorno ({operadores.length})
        </Text>
        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 12 }} />
        ) : error ? (
          <Text style={styles.error}>{error}</Text>
        ) : operadores.length === 0 ? (
          <Text style={styles.empty}>
            No hay operadores en retorno en este momento.
          </Text>
        ) : (
          operadores.map((o) => (
            <View key={o.operadorId} style={styles.row}>
              <Text style={styles.rowName}>{o.operadorNombre}</Text>
              <Text style={styles.rowMeta}>
                {o.kits.length} kit{o.kits.length === 1 ? '' : 's'} · {formatearHora(o.capturadoEn)}
              </Text>
            </View>
          ))
        )}
        <Text style={styles.logout} onPress={() => logout()}>
          Cerrar sesión
        </Text>
      </ScrollView>
    </View>
  );
}

const makeStyles = (c: Colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bgPage },
  mapWrap: { height: '50%', width: '100%' },
  map: { flex: 1 },
  list: { flex: 1, backgroundColor: c.bgPage },
  listContent: { padding: 16 },
  listTitle: { fontSize: 16, fontFamily: fontFamily.bold, color: c.textPrimary, marginBottom: 8 },
  row: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border },
  rowName: { fontSize: 15, fontFamily: fontFamily.semiBold, color: c.textPrimary },
  rowMeta: { fontSize: 13, fontFamily: fontFamily.regular, color: c.textSecondary, marginTop: 2 },
  empty: { fontSize: 14, fontFamily: fontFamily.regular, color: c.textSecondary, marginTop: 8 },
  error: { fontSize: 14, fontFamily: fontFamily.medium, color: c.error, marginTop: 8 },
  logout: { color: c.textSecondary, fontFamily: fontFamily.medium, textAlign: 'center', marginTop: 24 },
});
