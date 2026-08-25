import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import type { EstadoOperadorCda, OperadorEnRetorno } from '@cne/shared-types';
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
    var colorPorEstado = { EN_TRANSITO: '#7c3aed', EN_RETORNO: '#2563eb' };
    var labelPorEstado = { EN_TRANSITO: 'En tránsito', EN_RETORNO: 'En retorno' };
    function iconoPara(color) {
      return L.divIcon({
        className: 'op',
        html: '<div style="background:' + color + ';width:18px;height:18px;border-radius:50%;border:3px solid #fff;box-shadow:0 0 0 1px ' + color + '"></div>',
        iconSize: [18, 18], iconAnchor: [9, 9]
      });
    }
    window.setOperadores = function (ops) {
      capa.clearLayers();
      var pts = [];
      for (var i = 0; i < ops.length; i++) {
        var o = ops[i];
        var color = colorPorEstado[o.estado] || colorPorEstado.EN_RETORNO;
        var kitsHtml = '';
        for (var j = 0; j < o.kits.length; j++) {
          kitsHtml += '<li>' + o.kits[j].codigoUnico + ' — ' + o.kits[j].nombre + '</li>';
        }
        var popup = '<strong>' + o.operadorNombre + '</strong><br/>' +
          '<span>' + (labelPorEstado[o.estado] || '') + '</span><br/>' +
          '<span>Kits (' + o.kits.length + '):</span><ul style="margin:4px 0 0;padding-left:16px">' + kitsHtml + '</ul>';
        L.marker([o.latitud, o.longitud], { icon: iconoPara(color) }).bindPopup(popup).addTo(capa);
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

// Mapa de un solo marcador para el modal "Ver ubicación" de un operador puntual.
function ubicacionHtml(lat: number, lng: number, color: string): string {
  return `<!DOCTYPE html>
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
    var map = L.map('map').setView([${lat}, ${lng}], 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap'
    }).addTo(map);
    var icono = L.divIcon({
      className: 'op',
      html: '<div style="background:${color};width:18px;height:18px;border-radius:50%;border:3px solid #fff;box-shadow:0 0 0 1px ${color}"></div>',
      iconSize: [18, 18], iconAnchor: [9, 9]
    });
    L.marker([${lat}, ${lng}], { icon: icono }).addTo(map);
  </script>
</body>
</html>`;
}

const COLOR_POR_ESTADO: Partial<Record<EstadoOperadorCda, string>> = {
  EN_TRANSITO: '#7c3aed',
  EN_RETORNO: '#2563eb',
};
const LABEL_POR_ESTADO: Partial<Record<EstadoOperadorCda, string>> = {
  EN_TRANSITO: 'En tránsito',
  EN_RETORNO: 'En retorno',
};

export function MonitoreoScreen() {
  const { logout } = useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const webviewRef = useRef<WebView>(null);
  const listoRef = useRef(false);
  const [operadores, setOperadores] = useState<OperadorEnRetorno[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ubicacionDe, setUbicacionDe] = useState<OperadorEnRetorno | null>(null);

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
      <AppBar subtitle="Monitoreo de operadores" onRefresh={cargar} refreshing={loading} />
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

      <ScrollView
        style={styles.list}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={cargar} tintColor={colors.primary} colors={[colors.primary]} />
        }
      >
        <Text style={styles.listTitle}>
          En ruta ({operadores.length})
        </Text>
        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 12 }} />
        ) : error ? (
          <Text style={styles.error}>{error}</Text>
        ) : operadores.length === 0 ? (
          <Text style={styles.empty}>
            No hay operadores en tránsito ni en retorno en este momento.
          </Text>
        ) : (
          operadores.map((o) => (
            <Pressable key={o.operadorId} style={styles.row} onPress={() => setUbicacionDe(o)}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowName}>{o.operadorNombre}</Text>
                <View style={styles.rowMetaRow}>
                  <View style={[styles.estadoDot, { backgroundColor: COLOR_POR_ESTADO[o.estado] ?? colors.primary }]} />
                  <Text style={styles.rowMeta}>
                    {LABEL_POR_ESTADO[o.estado] ?? o.estado} · {o.kits.length} kit{o.kits.length === 1 ? '' : 's'} ·{' '}
                    {formatearHora(o.capturadoEn)}
                  </Text>
                </View>
              </View>
              <Text style={styles.verUbicacion}>Ver ubicación</Text>
            </Pressable>
          ))
        )}
        <Text style={styles.logout} onPress={() => logout()}>
          Cerrar sesión
        </Text>
      </ScrollView>

      <Modal visible={ubicacionDe != null} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            {ubicacionDe ? (
              <>
                <Text style={styles.modalTitle}>{ubicacionDe.operadorNombre}</Text>
                <Text style={styles.modalMeta}>Última posición · {formatearHora(ubicacionDe.capturadoEn)}</Text>
                <View style={styles.modalMapWrap}>
                  <WebView
                    originWhitelist={['*']}
                    source={{
                      html: ubicacionHtml(
                        ubicacionDe.latitud,
                        ubicacionDe.longitud,
                        COLOR_POR_ESTADO[ubicacionDe.estado] ?? colors.primary,
                      ),
                    }}
                    style={styles.modalMap}
                  />
                </View>
              </>
            ) : null}
            <Pressable style={styles.btnCerrar} onPress={() => setUbicacionDe(null)}>
              <Text style={styles.btnCerrarText}>Cerrar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.border,
  },
  rowName: { fontSize: 15, fontFamily: fontFamily.semiBold, color: c.textPrimary },
  rowMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  estadoDot: { width: 7, height: 7, borderRadius: 4 },
  rowMeta: { fontSize: 13, fontFamily: fontFamily.regular, color: c.textSecondary },
  verUbicacion: { fontSize: 13, fontFamily: fontFamily.semiBold, color: c.primary },
  empty: { fontSize: 14, fontFamily: fontFamily.regular, color: c.textSecondary, marginTop: 8 },
  error: { fontSize: 14, fontFamily: fontFamily.medium, color: c.error, marginTop: 8 },
  logout: { color: c.textSecondary, fontFamily: fontFamily.medium, textAlign: 'center', marginTop: 24 },
  modalBackdrop: { flex: 1, backgroundColor: c.modalOverlay, alignItems: 'center', justifyContent: 'center', padding: 24 },
  modalCard: { backgroundColor: c.bgCard, borderRadius: 12, padding: 16, width: '100%', maxWidth: 420 },
  modalTitle: { fontSize: 17, fontFamily: fontFamily.bold, color: c.textPrimary },
  modalMeta: { fontSize: 13, fontFamily: fontFamily.regular, color: c.textSecondary, marginTop: 2, marginBottom: 12 },
  modalMapWrap: { height: 280, borderRadius: 8, overflow: 'hidden' },
  modalMap: { flex: 1 },
  btnCerrar: { paddingVertical: 12, marginTop: 14 },
  btnCerrarText: { color: c.primary, textAlign: 'center', fontFamily: fontFamily.semiBold, fontSize: 14 },
});
