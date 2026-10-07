import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { Colors } from '../theme/colors';
import { fontFamily } from '../theme/typography';

export interface OpcionPersona {
  id: string;
  titulo: string; // "Apellidos Nombres"
  detalle: string; // "C.I. 1002003004 · Escuela X"
  aviso?: string; // p. ej. "De otro recinto"
}

const ESPERA_BUSQUEDA_MS = 350;

/**
 * Lista de opciones con un solo seleccionado (radio) más un buscador para
 * opciones que no están en la lista sugerida. La búsqueda la hace el servidor
 * (mínimo 2 caracteres, con espera para no consultar en cada tecla).
 */
export function SelectorPersona({
  titulo,
  sugeridas,
  seleccionado,
  onSeleccionar,
  buscar,
  etiquetaBuscador,
}: {
  titulo: string;
  sugeridas: OpcionPersona[];
  seleccionado: OpcionPersona | null;
  onSeleccionar: (opcion: OpcionPersona) => void;
  buscar: (texto: string) => Promise<OpcionPersona[]>;
  etiquetaBuscador: string;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [texto, setTexto] = useState('');
  const [resultados, setResultados] = useState<OpcionPersona[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const consulta = useRef(0);

  useEffect(() => {
    const q = texto.trim();
    if (q.length < 2) {
      setResultados([]);
      setBuscando(false);
      return;
    }
    const id = ++consulta.current;
    setBuscando(true);
    const t = setTimeout(() => {
      buscar(q)
        .then((r) => {
          if (id !== consulta.current) return; // llegó una búsqueda más nueva
          setResultados(r);
          setError(null);
        })
        .catch(() => {
          if (id !== consulta.current) return;
          setResultados([]); // no mostrar resultados viejos junto al error
          setError('No se pudo buscar. Revisa la conexión.');
        })
        .finally(() => id === consulta.current && setBuscando(false));
    }, ESPERA_BUSQUEDA_MS);
    return () => clearTimeout(t);
  }, [texto, buscar]);

  const idsSugeridas = new Set(sugeridas.map((s) => s.id));
  const extra = resultados.filter((r) => !idsSugeridas.has(r.id));
  // La opción elegida desde la búsqueda sigue a la vista aunque se borre el
  // texto: nunca se guarda a alguien que el usuario ya no ve.
  const seleccionOculta =
    seleccionado && !idsSugeridas.has(seleccionado.id) && !extra.some((r) => r.id === seleccionado.id)
      ? seleccionado
      : null;

  function fila(op: OpcionPersona) {
    const activo = op.id === seleccionado?.id;
    return (
      <Pressable
        key={op.id}
        style={[styles.opcion, activo && styles.opcionOn]}
        onPress={() => onSeleccionar(op)}
        accessibilityRole="radio"
        accessibilityState={{ checked: activo }}
        accessibilityLabel={`${op.titulo}, ${op.detalle}${op.aviso ? `, ${op.aviso}` : ''}`}
      >
        <View style={[styles.radio, activo && styles.radioOn]}>{activo ? <View style={styles.radioDot} /> : null}</View>
        <View style={{ flex: 1 }}>
          <Text style={styles.opcionTitulo}>{op.titulo}</Text>
          <Text style={styles.opcionDetalle}>{op.detalle}</Text>
          {op.aviso ? <Text style={styles.opcionAviso}>{op.aviso}</Text> : null}
        </View>
      </Pressable>
    );
  }

  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={titulo}>
      <Text style={styles.titulo}>{titulo}</Text>
      {sugeridas.length === 0 ? (
        <Text style={styles.vacio}>No hay sugeridos. Búscalo por cédula o nombre.</Text>
      ) : (
        sugeridas.map(fila)
      )}
      {seleccionOculta ? fila(seleccionOculta) : null}
      <TextInput
        style={styles.buscador}
        value={texto}
        onChangeText={setTexto}
        placeholder={etiquetaBuscador}
        placeholderTextColor={colors.textPlaceholder}
        autoCorrect={false}
        maxLength={60}
        accessibilityLabel={etiquetaBuscador}
      />
      {buscando ? (
        <ActivityIndicator
          color={colors.primary}
          style={{ marginVertical: 6 }}
          accessible
          accessibilityLabel="Buscando"
        />
      ) : null}
      {error ? (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
      {!buscando && texto.trim().length >= 2 && extra.length === 0 && !error ? (
        <Text style={styles.vacio} accessibilityLiveRegion="polite">
          Sin resultados.
        </Text>
      ) : null}
      {extra.map(fila)}
    </View>
  );
}

const makeStyles = (c: Colors) => StyleSheet.create({
  titulo: { fontSize: 13, fontFamily: fontFamily.semiBold, color: c.textSecondary, marginTop: 10, marginBottom: 6 },
  vacio: { fontSize: 13, fontFamily: fontFamily.regular, color: c.textMeta, marginVertical: 6 },
  opcion: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 48,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: c.border,
    marginBottom: 6,
  },
  opcionOn: { borderColor: c.primary, backgroundColor: c.bgPage },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: c.textPlaceholder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: { borderColor: c.primary },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: c.primary },
  opcionTitulo: { fontSize: 14, fontFamily: fontFamily.semiBold, color: c.textPrimary },
  opcionDetalle: { fontSize: 12, fontFamily: fontFamily.regular, color: c.textSecondary, marginTop: 2 },
  opcionAviso: { fontSize: 12, fontFamily: fontFamily.semiBold, color: c.warningText, marginTop: 2 },
  buscador: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: c.borderInput,
    backgroundColor: c.bgCard,
    color: c.textPrimary,
    paddingHorizontal: 12,
    borderRadius: 8,
    fontSize: 14,
    fontFamily: fontFamily.regular,
    marginTop: 4,
    marginBottom: 6,
  },
  error: { fontSize: 13, fontFamily: fontFamily.medium, color: c.error, marginVertical: 4 },
});
