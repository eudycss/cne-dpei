import { useCallback, useMemo, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { KitCustodiaResponse, MilitarResumen, OperadorResumen } from '@cne/shared-types';
import { useTheme } from '../theme/ThemeContext';
import { Colors } from '../theme/colors';
import { fontFamily } from '../theme/typography';
import { AppBar } from '../components/AppBar';
import { IngresoCodigoKit } from '../components/IngresoCodigoKit';
import { OpcionPersona, SelectorPersona } from '../components/SelectorPersona';
import {
  buscarMilitares,
  buscarOperadores,
  cambiarOperador,
  corregirMilitar,
  registrarEntrega,
  validarKitCustodia,
} from '../lib/queries/custodia';

type Modo = 'NINGUNO' | 'ENTREGAR' | 'CORREGIR_MILITAR' | 'CAMBIAR_OPERADOR';

const MOTIVO_MIN = 5;

function opcionMilitar(m: MilitarResumen, recintoKitId: string | null): OpcionPersona {
  return {
    id: m.id,
    titulo: `${m.apellidos} ${m.nombres}`,
    detalle: `C.I. ${m.cedula} · ${m.recintoNombre}`,
    aviso: recintoKitId && m.recintoId !== recintoKitId ? 'De otro recinto' : undefined,
  };
}

function opcionOperador(o: OperadorResumen): OpcionPersona {
  return { id: o.id, titulo: `${o.apellidos} ${o.nombres}`, detalle: `C.I. ${o.cedula}` };
}

function hora(iso: string): string {
  return new Date(iso).toLocaleString('es-EC', { dateStyle: 'short', timeStyle: 'short' });
}

/**
 * Asistente Electoral Transversal: entrega cada kit a un militar en el DPEI.
 * La app propone los militares del recinto del kit; si llega otro, se busca
 * entre todos. Hasta que el CDA recibe el kit se puede corregir el militar o
 * cambiar el operador CDA, siempre con motivo (queda en el historial).
 */
export function EntregaMilitarScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [kit, setKit] = useState<KitCustodiaResponse | null>(null);
  const [modo, setModo] = useState<Modo>('NINGUNO');
  const [seleccion, setSeleccion] = useState<OpcionPersona | null>(null);
  const [motivo, setMotivo] = useState('');
  const [validando, setValidando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [entregados, setEntregados] = useState(0);

  const buscarMilitar = useCallback(
    async (q: string) => (await buscarMilitares(q)).map((m) => opcionMilitar(m, kit?.recinto?.id ?? null)),
    [kit?.recinto?.id],
  );
  const buscarOperador = useCallback(async (q: string) => (await buscarOperadores(q)).map(opcionOperador), []);

  function abrir(k: KitCustodiaResponse) {
    setKit(k);
    setMotivo('');
    if (!k.entrega && k.editable) {
      setModo('ENTREGAR');
      // Con un solo militar en el recinto, queda propuesto.
      const unico = k.militaresRecinto.length === 1 ? k.militaresRecinto[0] : null;
      setSeleccion(unico ? opcionMilitar(unico, k.recinto?.id ?? null) : null);
    } else {
      setModo('NINGUNO');
      setSeleccion(null);
    }
  }

  async function onCodigo(codigo: string) {
    setValidando(true);
    try {
      abrir(await validarKitCustodia(codigo));
    } catch (e: any) {
      Alert.alert('Kit inválido', e?.response?.data?.message ?? 'No se pudo validar el código.');
    } finally {
      setValidando(false);
    }
  }

  async function recargar() {
    if (kit) abrir(await validarKitCustodia(kit.codigoUnico));
  }

  const requiereMotivo = modo === 'CORREGIR_MILITAR' || modo === 'CAMBIAR_OPERADOR';
  const motivoValido = !requiereMotivo || motivo.trim().length >= MOTIVO_MIN;
  const puedeGuardar = !!kit && !!seleccion && motivoValido && !guardando;

  async function guardar() {
    if (!kit || !seleccion || !puedeGuardar) return;
    setGuardando(true);
    try {
      let aviso = '';
      if (modo === 'ENTREGAR') {
        await registrarEntrega({ kitId: kit.kitId, militarId: seleccion.id });
        setEntregados((n) => n + 1);
        aviso = `Entrega registrada: kit ${kit.codigoUnico} a ${seleccion.titulo}`;
      } else if (modo === 'CORREGIR_MILITAR') {
        await corregirMilitar(kit.kitId, { militarId: seleccion.id, motivo: motivo.trim() });
        aviso = `Militar cambiado a ${seleccion.titulo}`;
      } else if (modo === 'CAMBIAR_OPERADOR') {
        await cambiarOperador(kit.kitId, { operadorId: seleccion.id, motivo: motivo.trim() });
        aviso = `Operador cambiado a ${seleccion.titulo}`;
      }
      AccessibilityInfo.announceForAccessibility(aviso);
      await recargar();
    } catch (e: any) {
      Alert.alert('No se pudo guardar', e?.response?.data?.message ?? 'Intenta de nuevo.');
    } finally {
      setGuardando(false);
    }
  }

  function empezar(m: Modo) {
    setModo(m);
    setSeleccion(null);
    setMotivo('');
  }

  const textoBoton =
    modo === 'ENTREGAR' ? 'Registrar entrega' : modo === 'CORREGIR_MILITAR' ? 'Guardar cambio de militar' : 'Guardar cambio de operador';

  return (
    <View style={styles.container}>
      <AppBar subtitle="Entrega a militar" />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={styles.title} accessibilityRole="header">Entregar kit a militar</Text>
        <Text style={styles.subtitle}>
          Escanea el kit y confirma el militar que lo lleva al recinto. {entregados > 0 ? `Entregados en esta sesión: ${entregados}.` : ''}
        </Text>

        <IngresoCodigoKit onCodigo={onCodigo} ocupado={validando} />

        {kit ? (
          <View style={styles.card}>
            <Text style={styles.kitCode}>{kit.codigoUnico}</Text>
            <Text style={styles.kitNombre}>{kit.nombre}</Text>

            <View style={styles.dato}>
              <Text style={styles.datoLabel}>Operador CDA</Text>
              <Text style={styles.datoValor}>
                {kit.operador ? `${kit.operador.apellidos} ${kit.operador.nombres}` : 'Sin asignar'}
              </Text>
              {kit.editable && modo !== 'CAMBIAR_OPERADOR' ? (
                <Pressable style={styles.link} onPress={() => empezar('CAMBIAR_OPERADOR')} accessibilityRole="button">
                  <Text style={styles.linkText}>Cambiar operador</Text>
                </Pressable>
              ) : null}
            </View>

            <View style={styles.dato}>
              <Text style={styles.datoLabel}>Entrega al militar</Text>
              {kit.entrega ? (
                <>
                  <Text style={styles.datoValor}>
                    {kit.entrega.militar.apellidos} {kit.entrega.militar.nombres} · C.I. {kit.entrega.militar.cedula}
                  </Text>
                  <Text style={styles.datoMeta}>
                    {hora(kit.entrega.entregadoEn)} · registró {kit.entrega.entregadoPorNombre}
                  </Text>
                  {kit.entrega.militarDeOtroRecinto ? (
                    <Text style={styles.aviso}>Militar de otro recinto ({kit.entrega.militar.recintoNombre})</Text>
                  ) : null}
                  {kit.editable && modo !== 'CORREGIR_MILITAR' ? (
                    <Pressable style={styles.link} onPress={() => empezar('CORREGIR_MILITAR')} accessibilityRole="button">
                      <Text style={styles.linkText}>Cambiar militar</Text>
                    </Pressable>
                  ) : null}
                </>
              ) : (
                <Text style={styles.datoValor}>Pendiente</Text>
              )}
            </View>

            {!kit.editable ? (
              <Text style={styles.bloqueado}>
                El operador CDA ya recibió este kit. Las correcciones las hace un administrador.
              </Text>
            ) : null}

            {modo !== 'NINGUNO' ? (
              <View style={styles.formulario}>
                {modo === 'CAMBIAR_OPERADOR' ? (
                  <SelectorPersona
                    titulo="Nuevo operador CDA"
                    sugeridas={[]}
                    seleccionado={seleccion}
                    onSeleccionar={setSeleccion}
                    buscar={buscarOperador}
                    etiquetaBuscador="Buscar operador por cédula o nombre"
                  />
                ) : (
                  <SelectorPersona
                    titulo={kit.recinto ? `Militares del recinto ${kit.recinto.codigo}` : 'Militares'}
                    sugeridas={kit.militaresRecinto.map((m) => opcionMilitar(m, kit.recinto?.id ?? null))}
                    seleccionado={seleccion}
                    onSeleccionar={setSeleccion}
                    buscar={buscarMilitar}
                    etiquetaBuscador="¿Otro militar? Busca por cédula o nombre"
                  />
                )}

                {requiereMotivo ? (
                  <>
                    <Text style={styles.datoLabel}>Motivo del cambio (obligatorio)</Text>
                    <TextInput
                      style={styles.textArea}
                      value={motivo}
                      onChangeText={setMotivo}
                      placeholder="Ej. el militar asignado fue reemplazado"
                      placeholderTextColor={colors.textPlaceholder}
                      multiline
                      maxLength={500}
                      accessibilityLabel="Motivo del cambio"
                      accessibilityHint={`Mínimo ${MOTIVO_MIN} caracteres`}
                    />
                  </>
                ) : null}

                <View style={styles.acciones}>
                  {requiereMotivo ? (
                    <Pressable style={styles.btnSecondary} onPress={() => empezar('NINGUNO')} accessibilityRole="button">
                      <Text style={styles.btnSecondaryText}>Cancelar</Text>
                    </Pressable>
                  ) : null}
                  <Pressable
                    style={[styles.btnPrimary, !puedeGuardar && styles.btnDisabled]}
                    onPress={guardar}
                    disabled={!puedeGuardar}
                    accessibilityRole="button"
                    accessibilityLabel={textoBoton}
                    accessibilityState={{ disabled: !puedeGuardar, busy: guardando }}
                  >
                    {guardando ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnPrimaryText}>{textoBoton}</Text>}
                  </Pressable>
                </View>
              </View>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const makeStyles = (c: Colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bgPage },
  body: { padding: 20, paddingBottom: 40 },
  title: { fontSize: 22, fontFamily: fontFamily.bold, color: c.textPrimary },
  subtitle: { fontSize: 14, fontFamily: fontFamily.regular, color: c.textMeta, marginTop: 8, marginBottom: 20, lineHeight: 20 },
  card: { backgroundColor: c.bgCard, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: c.border },
  kitCode: { fontSize: 18, fontFamily: fontFamily.bold, color: c.primary, letterSpacing: 1 },
  kitNombre: { fontSize: 15, fontFamily: fontFamily.semiBold, color: c.textPrimary, marginTop: 2 },
  dato: { marginTop: 14 },
  datoLabel: { fontSize: 12, fontFamily: fontFamily.semiBold, color: c.textSecondary, textTransform: 'uppercase', marginBottom: 4 },
  datoValor: { fontSize: 14, fontFamily: fontFamily.medium, color: c.textPrimary },
  datoMeta: { fontSize: 12, fontFamily: fontFamily.regular, color: c.textSecondary, marginTop: 2 },
  aviso: { fontSize: 12, fontFamily: fontFamily.semiBold, color: c.warningText, marginTop: 4 },
  bloqueado: {
    marginTop: 14,
    padding: 10,
    borderRadius: 8,
    backgroundColor: c.warningBg,
    color: c.warningText,
    fontSize: 13,
    fontFamily: fontFamily.medium,
  },
  link: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  linkText: { fontSize: 14, fontFamily: fontFamily.semiBold, color: c.primary, textDecorationLine: 'underline' },
  formulario: { marginTop: 10, borderTopWidth: 1, borderTopColor: c.border, paddingTop: 6 },
  textArea: {
    borderWidth: 1,
    borderColor: c.borderInput,
    backgroundColor: c.bgPage,
    color: c.textPrimary,
    padding: 12,
    borderRadius: 6,
    fontSize: 14,
    fontFamily: fontFamily.regular,
    textAlignVertical: 'top',
    minHeight: 70,
    marginBottom: 10,
  },
  acciones: { flexDirection: 'row', gap: 8, marginTop: 6 },
  btnPrimary: { flex: 1, backgroundColor: c.primaryBg, paddingVertical: 14, borderRadius: 8, minHeight: 48, justifyContent: 'center' },
  btnPrimaryText: { color: '#fff', textAlign: 'center', fontSize: 14, fontFamily: fontFamily.semiBold },
  btnDisabled: { backgroundColor: c.primaryDisabled },
  btnSecondary: {
    flex: 1,
    backgroundColor: c.btnSecondaryBg,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: c.btnSecondaryBorder,
    minHeight: 48,
    justifyContent: 'center',
  },
  btnSecondaryText: { color: c.btnSecondaryText, textAlign: 'center', fontSize: 14, fontFamily: fontFamily.semiBold },
});
