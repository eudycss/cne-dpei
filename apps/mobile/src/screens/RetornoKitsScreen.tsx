import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { EstadoRetornoKit, KitRetornoEstado, RetornoKitsResponse } from '@cne/shared-types';
import { coincideBusqueda } from '@cne/shared-validation';
import { useTheme } from '../theme/ThemeContext';
import { Colors } from '../theme/colors';
import { AppBar } from '../components/AppBar';
import { getRetornoKits } from '../lib/queries/retorno';
import { fontFamily } from '../theme/typography';

type Filtro = 'FALTAN' | 'REGISTRADOS' | 'TODOS';

const FILTROS: { id: Filtro; label: (r: RetornoKitsResponse) => string }[] = [
  { id: 'FALTAN', label: (r) => `Faltan (${r.faltan})` },
  { id: 'REGISTRADOS', label: (r) => `Registrados (${r.registrados})` },
  { id: 'TODOS', label: (r) => `Todos (${r.items.length})` },
];

/** El retorno cambia mientras llegan los operadores: se refresca solo. */
const REFRESCO_MS = 30_000;

function formatearHora(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' });
}

function pasaFiltro(estado: EstadoRetornoKit, filtro: Filtro): boolean {
  if (filtro === 'TODOS') return true;
  return filtro === 'REGISTRADOS' ? estado === 'REGISTRADO' : estado !== 'REGISTRADO';
}

function textoEstado(k: KitRetornoEstado): string {
  if (k.estado === 'REGISTRADO') return `Registrado${k.confirmadoEn ? ` · ${formatearHora(k.confirmadoEn)}` : ''}`;
  return k.estado === 'LLEGO_SIN_VERIFICAR' ? 'Llegó · falta verificar' : 'Falta llegar';
}

/**
 * Retorno a la Delegación (Asistente Transversal): quién ya fue registrado y
 * a quién le falta llegar, con un buscador por recinto (nombre o código) o
 * persona, sin distinguir tildes ni el orden de las palabras.
 */
export function RetornoKitsScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [datos, setDatos] = useState<RetornoKitsResponse>({ registrados: 0, faltan: 0, items: [] });
  const [filtro, setFiltro] = useState<Filtro>('FALTAN');
  const [busqueda, setBusqueda] = useState('');
  const [loading, setLoading] = useState(true);
  const [refrescando, setRefrescando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Con red lenta, el refresco automático no lanza otra consulta mientras la anterior sigue.
  const enCurso = useRef(false);

  const cargar = useCallback(async () => {
    if (enCurso.current) return;
    enCurso.current = true;
    try {
      setDatos(await getRetornoKits());
      setError(null);
    } catch (e: any) {
      // La lista anterior se conserva: el error se muestra encima.
      setError(e?.response?.data?.message ?? 'No se pudo cargar el retorno de los kits');
    } finally {
      enCurso.current = false;
      setLoading(false);
    }
  }, []);

  const refrescarAMano = useCallback(async () => {
    setRefrescando(true);
    await cargar();
    setRefrescando(false);
  }, [cargar]);

  // Refresco automático solo con la app en primer plano; al volver, se actualiza enseguida.
  useEffect(() => {
    let id: ReturnType<typeof setInterval> | null = null;
    const iniciar = () => {
      if (!id) id = setInterval(cargar, REFRESCO_MS);
    };
    const detener = () => {
      if (id) clearInterval(id);
      id = null;
    };
    cargar();
    iniciar();
    const sub = AppState.addEventListener('change', (estado) => {
      if (estado === 'active') {
        cargar();
        iniciar();
      } else {
        detener();
      }
    });
    return () => {
      detener();
      sub.remove();
    };
  }, [cargar]);

  // Con texto en el buscador se busca en todos: así se sabe si la persona está o falta.
  const visibles = useMemo(() => {
    const q = busqueda.trim();
    return datos.items.filter((k) =>
      q
        ? coincideBusqueda([k.recinto?.codigo, k.recinto?.nombre, k.operadorNombre, k.asistenteNombre, k.codigoUnico], q)
        : pasaFiltro(k.estado, filtro),
    );
  }, [datos.items, busqueda, filtro]);

  const estiloEstado = (e: EstadoRetornoKit) =>
    e === 'REGISTRADO' ? styles.estadoRegistrado : e === 'LLEGO_SIN_VERIFICAR' ? styles.estadoLlego : styles.estadoFalta;

  return (
    <View style={styles.container}>
      <AppBar subtitle="Retorno a la Delegación" onRefresh={refrescarAMano} refreshing={refrescando} />
      <View style={styles.resumen} accessible accessibilityLabel={`${datos.registrados} registrados, ${datos.faltan} faltan`}>
        <Text style={styles.resumenNumero}>{datos.registrados}</Text>
        <Text style={styles.resumenLabel}>registrado{datos.registrados === 1 ? '' : 's'}</Text>
        <Text style={[styles.resumenNumero, styles.resumenFaltan]}>{datos.faltan}</Text>
        <Text style={styles.resumenLabel}>falta{datos.faltan === 1 ? '' : 'n'}</Text>
      </View>

      <View style={styles.controles}>
        <TextInput
          style={styles.buscador}
          value={busqueda}
          onChangeText={setBusqueda}
          placeholder="Buscar recinto, código o persona"
          placeholderTextColor={colors.textPlaceholder}
          accessibilityLabel="Buscar por recinto, código o nombre de la persona"
          autoCorrect={false}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
        {busqueda.trim() ? null : (
          <View style={styles.filtros} accessibilityRole="radiogroup">
            {FILTROS.map((f) => {
              const activo = filtro === f.id;
              return (
                <Pressable
                  key={f.id}
                  onPress={() => setFiltro(f.id)}
                  style={[styles.filtroBtn, activo && styles.filtroBtnActivo]}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: activo }}
                >
                  <Text style={[styles.filtroTexto, activo && styles.filtroTextoActivo]}>{f.label(datos)}</Text>
                </Pressable>
              );
            })}
          </View>
        )}
      </View>

      <ScrollView
        style={styles.list}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={refrescando} onRefresh={refrescarAMano} tintColor={colors.primary} colors={[colors.primary]} />
        }
      >
        {error ? (
          <Text style={styles.error} accessibilityRole="alert">
            {datos.items.length > 0 ? `${error}. Se muestra la última lista recibida.` : error}
          </Text>
        ) : null}
        {loading && datos.items.length === 0 ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 12 }} />
        ) : error && datos.items.length === 0 ? null : visibles.length === 0 ? (
          <Text style={styles.empty}>
            {busqueda.trim()
              ? 'Ningún recinto o persona coincide con la búsqueda.'
              : filtro === 'FALTAN' && datos.items.length > 0
                ? 'Ya llegaron y se registraron todos los kits.'
                : 'No hay kits en esta lista.'}
          </Text>
        ) : (
          visibles.map((k) => (
            <View
              key={k.kitId}
              style={styles.row}
              accessible
              accessibilityLabel={[
                k.recinto ? `${k.recinto.codigo} ${k.recinto.nombre}` : k.codigoUnico,
                k.operadorNombre,
                k.asistenteNombre,
                textoEstado(k),
              ]
                .filter(Boolean)
                .join(', ')}
            >
              <View style={styles.rowHead}>
                <Text style={styles.rowRecinto} numberOfLines={2}>
                  {k.recinto ? `${k.recinto.codigo} · ${k.recinto.nombre}` : 'Sin recinto'}
                </Text>
                <Text style={[styles.estado, estiloEstado(k.estado)]}>{textoEstado(k)}</Text>
              </View>
              <Text style={styles.rowPersona}>{k.operadorNombre}</Text>
              {k.asistenteNombre ? <Text style={styles.rowMeta}>Asistente: {k.asistenteNombre}</Text> : null}
              <Text style={styles.rowMeta}>Kit {k.codigoUnico}</Text>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const makeStyles = (c: Colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bgPage },
  resumen: { flexDirection: 'row', alignItems: 'baseline', gap: 6, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  resumenNumero: { fontSize: 28, fontFamily: fontFamily.bold, color: c.successText },
  resumenFaltan: { color: c.warningText, marginLeft: 12 },
  resumenLabel: { fontSize: 14, fontFamily: fontFamily.medium, color: c.textSecondary },
  controles: { paddingHorizontal: 16, gap: 8 },
  buscador: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: c.borderInput,
    borderRadius: 8,
    paddingHorizontal: 12,
    backgroundColor: c.bgCard,
    color: c.textPrimary,
    fontSize: 15,
    fontFamily: fontFamily.regular,
  },
  filtros: { flexDirection: 'row', gap: 8 },
  filtroBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: c.btnSecondaryBorder,
    backgroundColor: c.btnSecondaryBg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  filtroBtnActivo: { backgroundColor: c.primaryBg, borderColor: c.primaryBg },
  filtroTexto: { fontSize: 13, fontFamily: fontFamily.semiBold, color: c.btnSecondaryText, textAlign: 'center' },
  filtroTextoActivo: { color: '#fff' },
  list: { flex: 1 },
  listContent: { padding: 16, paddingTop: 8 },
  row: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border },
  rowHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  rowRecinto: { flex: 1, fontSize: 15, fontFamily: fontFamily.semiBold, color: c.textPrimary },
  rowPersona: { fontSize: 14, fontFamily: fontFamily.medium, color: c.textMeta, marginTop: 2 },
  rowMeta: { fontSize: 13, fontFamily: fontFamily.regular, color: c.textSecondary, marginTop: 2 },
  estado: { fontSize: 12, fontFamily: fontFamily.semiBold, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, overflow: 'hidden' },
  estadoRegistrado: { backgroundColor: c.successBg, color: c.successText },
  estadoLlego: { backgroundColor: c.bgCard, color: c.primary, borderWidth: 1, borderColor: c.primary },
  estadoFalta: { backgroundColor: c.warningBg, color: c.warningText },
  empty: { fontSize: 14, fontFamily: fontFamily.regular, color: c.textSecondary, marginTop: 8 },
  error: { fontSize: 14, fontFamily: fontFamily.medium, color: c.error, marginBottom: 8 },
});
