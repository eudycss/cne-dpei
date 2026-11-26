import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ItemKitCatalog, Recinto } from '@cne/shared-types';
import { createKitSchema } from '@cne/shared-validation';
import { api } from '../../lib/api';
import { SearchableSelect } from '../../components/SearchableSelect';
import { ContenidosKitField, aDetalleItems, contenidosDesdeCatalogo, type ContenidosKit } from './ContenidosKitField';
import { crearKitConParejaCda, getDisponiblesKitCda } from '../../lib/queries/operadores-cda';

// ─── Modal crear kit ──────────────────────────────────────────────────────────

const SIN_OPERADOR = '— Sin operador (asignar después) —';
const SIN_ASISTENTE = '— Sin asistente —';

export function CreateKitModal({
  eventoId,
  recintos,
  recintosOcupados,
  itemsCatalog,
  onCatalogChanged,
  onClose,
  onDone,
}: {
  eventoId: string;
  recintos: Recinto[];
  recintosOcupados: string[];
  itemsCatalog: ItemKitCatalog[];
  onCatalogChanged: () => void;
  onClose: () => void;
  onDone: () => void;
}) {
  const [recintoId, setRecintoId] = useState('');
  const [operadorCdaId, setOperadorCdaId] = useState('');
  const [asistenteCdaId, setAsistenteCdaId] = useState('');
  const [justificacion, setJustificacion] = useState('');
  const [frozen, setFrozen] = useState(false);
  const [esPrueba, setEsPrueba] = useState(false);
  // El recinto lleva otro dispositivo: se puede elegir uno que ya tiene kit.
  const [otroDispositivo, setOtroDispositivo] = useState(false);
  const [avisoRecinto, setAvisoRecinto] = useState('');
  const [contenidos, setContenidos] = useState<ContenidosKit>(() => contenidosDesdeCatalogo(itemsCatalog));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Personas sin kit ni pareja en este evento (Operadores y Asistentes CDA).
  const { data: disponibles } = useQuery({
    queryKey: ['kits-disponibles-cda', eventoId],
    queryFn: () => getDisponiblesKitCda(eventoId),
  });
  // La primera opción ('' con el mismo texto del placeholder) deja quitar lo elegido.
  const opcionesPersona = (ninguno: string, lista?: { id: string; apellidosNombres: string; cedula: string }[]) => [
    { value: '', label: ninguno },
    ...(Array.isArray(lista) ? lista : []).map((p) => ({ value: p.id, label: p.apellidosNombres, sublabel: p.cedula })),
  ];
  const operadorOptions = useMemo(() => opcionesPersona(SIN_OPERADOR, disponibles?.operadores), [disponibles]);
  const asistenteOptions = useMemo(() => opcionesPersona(SIN_ASISTENTE, disponibles?.asistentes), [disponibles]);

  const recintoOptions = useMemo(() => {
    const ocupados = new Set(recintosOcupados);
    return recintos
      .filter((r) => otroDispositivo || !ocupados.has(r.id))
      .map((r) => ({
        value: r.id,
        label: `${r.codigoRecinto} — ${r.nombre}${ocupados.has(r.id) ? ' (ya tiene kit)' : ''}`,
      }));
  }, [recintos, recintosOcupados, otroDispositivo]);

  // Cuando el catálogo crece (ej. por "+ Agregar otro"), el ítem nuevo entra marcado.
  useEffect(() => {
    setContenidos((prev) => {
      const next = new Map(prev);
      for (const it of itemsCatalog) if (!prev.has(it.id)) next.set(it.id, { serie: '', estado: 'BUENO' });
      return next;
    });
  }, [itemsCatalog]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!recintoId) {
      setError('Selecciona un recinto');
      return;
    }
    const recinto = recintos.find((r) => r.id === recintoId);
    if (!recinto) {
      setError('Recinto inválido');
      return;
    }
    if (!esPrueba && operadorCdaId) {
      if (frozen && !justificacion.trim()) {
        setError('Escribe la justificación');
        return;
      }
      setSaving(true);
      try {
        await crearKitConParejaCda({
          eventoId,
          recintoId,
          operadorCdaId,
          ...(asistenteCdaId && { asistenteCdaId }),
          detalleItems: aDetalleItems(contenidos),
          ...(otroDispositivo && { otroDispositivo: true }),
          ...(frozen && { justificacion: justificacion.trim() }),
        });
        onDone();
      } catch (err: any) {
        const data = err?.response?.data;
        if (data?.frozen) setFrozen(true);
        setError(data?.message ?? 'No se pudo crear el kit');
      } finally {
        setSaving(false);
      }
      return;
    }
    const parsed = createKitSchema.safeParse({
      eventoId,
      nombre: `${recinto.codigoRecinto} — ${recinto.nombre}`,
      contenidos: null,
      esPrueba,
      detalleItems: aDetalleItems(contenidos),
      recintoId,
      ...(otroDispositivo && !esPrueba && { otroDispositivo: true }),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Datos inválidos');
      return;
    }
    setSaving(true);
    try {
      await api.post('/kits', parsed.data);
      onDone();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'No se pudo crear el kit');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="center modal-desplazable" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 10 }}>
      <form className="login-card" style={{ maxWidth: 480, width: '100%' }} onSubmit={onSubmit}>
        <h1>Nuevo kit electoral</h1>
        <p className="muted" style={{ marginTop: 0 }}>
          El sistema generará automáticamente el código único y el QR.
        </p>

        <div className="field">
          <label id="kits-recinto-cda">Recinto (CDA)</label>
          <SearchableSelect labelId="kits-recinto-cda"
            options={recintoOptions}
            value={recintoId}
            onChange={setRecintoId}
            placeholder="— Selecciona un recinto —"
            searchPlaceholder="Busca por nombre o código…"
            required
          />
          <p id="kit-nuevo-recinto-ayuda" className="muted" style={{ fontSize: '0.8rem', marginTop: '0.25rem' }}>
            {otroDispositivo
              ? 'Se muestran todos los recintos; los que ya tienen kit recibirán uno más.'
              : 'Solo se muestran recintos sin kit asignado todavía.'}
          </p>
          {!esPrueba && (
            <label className="row" style={{ margin: '0.35rem 0 0', gap: '0.35rem', alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={otroDispositivo}
                aria-describedby="kit-nuevo-recinto-ayuda"
                onChange={(e) => {
                  setOtroDispositivo(e.target.checked);
                  setAvisoRecinto('');
                  // Sin la casilla, un recinto que ya tiene kit deja de ser válido.
                  if (!e.target.checked && recintosOcupados.includes(recintoId)) {
                    setRecintoId('');
                    setAvisoRecinto('Se quitó el recinto elegido porque ya tiene kit. Elija otro.');
                  }
                }}
              />
              Este recinto lleva otro dispositivo (dos o más kits)
            </label>
          )}
          <p role="status" className="muted" style={{ fontSize: '0.8rem', margin: avisoRecinto ? '0.25rem 0 0' : 0 }}>
            {avisoRecinto}
          </p>
        </div>

        {!esPrueba && (
          <>
            <div className="field">
              <label id="kit-nuevo-operador">Operador CDA (recibe el kit en la app)</label>
              <SearchableSelect
                labelId="kit-nuevo-operador"
                options={operadorOptions}
                value={operadorCdaId}
                onChange={(v) => {
                  setOperadorCdaId(v);
                  if (!v) setAsistenteCdaId('');
                }}
                placeholder={SIN_OPERADOR}
                searchPlaceholder="Busca por nombre o cédula…"
              />
            </div>
            <div className="field">
              <label id="kit-nuevo-asistente">Asistente CDA (su pareja)</label>
              <SearchableSelect
                labelId="kit-nuevo-asistente"
                describedBy="kit-nuevo-personas-ayuda"
                options={asistenteOptions}
                value={asistenteCdaId}
                onChange={setAsistenteCdaId}
                placeholder={SIN_ASISTENTE}
                searchPlaceholder="Busca por nombre o cédula…"
                disabled={!operadorCdaId}
              />
              <p id="kit-nuevo-personas-ayuda" className="muted" style={{ fontSize: '0.8rem', marginTop: '0.25rem' }}>
                {operadorCdaId ? '' : 'Elija primero un operador. '}
                Solo aparecen quienes aún no tienen kit ni pareja en este evento.
              </p>
            </div>
          </>
        )}

        {frozen && !esPrueba && operadorCdaId && (
          <div className="field">
            <label htmlFor="kit-nuevo-justificacion">Justificación (requerida)</label>
            <textarea
              id="kit-nuevo-justificacion"
              value={justificacion}
              onChange={(e) => setJustificacion(e.target.value)}
              rows={3}
              maxLength={500}
              required
              autoFocus
              placeholder="La jornada electoral ya inició: explica por qué se necesita este kit…"
              style={{
                width: '100%',
                padding: '0.5rem 0.65rem',
                border: '1px solid var(--border-input)',
                borderRadius: 6,
                fontSize: '0.9rem',
                resize: 'vertical',
              }}
            />
          </div>
        )}

        <ContenidosKitField
          idTitulo="kit-contenidos-nuevo"
          itemsCatalog={itemsCatalog}
          value={contenidos}
          onChange={setContenidos}
          onCatalogChanged={onCatalogChanged}
          onError={setError}
        />

        <label className="row" style={{ margin: '0.5rem 0 0', gap: '0.35rem', alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={esPrueba}
            onChange={(e) => {
              setEsPrueba(e.target.checked);
              setOperadorCdaId('');
              setAsistenteCdaId('');
              setOtroDispositivo(false);
            }}
          />
          Es un kit de prueba (no aparecerá en el listado por defecto)
        </label>

        {error && <div className="banner error" role="alert">{error}</div>}

        <div className="modal-acciones">
          <button type="button" className="btn secondary" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn" disabled={saving}>
            {saving ? 'Creando…' : 'Crear kit'}
          </button>
        </div>
      </form>
    </div>
  );
}
