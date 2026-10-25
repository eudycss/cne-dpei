import { useState, type FormEvent, type ReactElement } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { sileo } from 'sileo';
import type {
  CambiarCargoOperadorCdaResult,
  CrearOperadorCdaRequest,
  EditarOperadorCdaRequest,
  GrupoCda,
  OperadorCda,
} from '@cne/shared-types';
import { crearOperadorCdaSchema, editarOperadorCdaSchema } from '@cne/shared-validation';
import { Modal } from '../../components/Modal';
import { cambiarCargoOperadorCda, crearOperadorCda, editarOperadorCda } from '../../lib/queries/operadores-cda';
import { Campo } from './Campo';
import { GRUPOS, TEXTOS_GRUPO, useGrupoCda } from './grupo';
import { hoyEcuador, mensajeError } from './utils';

/** Orden en pantalla: el foco va al primero con error. */
const ORDEN_CAMPOS = ['apellidosNombres', 'cedula', 'cargo', 'telefono', 'unidad', 'fechaInicio'] as const;
type CampoForm = (typeof ORDEN_CAMPOS)[number];
type Formulario = Record<CampoForm, string>;

function inicial(cargoPorDefecto: string, o?: OperadorCda): Formulario {
  return {
    apellidosNombres: o?.apellidosNombres ?? '',
    cedula: o?.cedula ?? '',
    cargo: o?.cargo ?? cargoPorDefecto,
    telefono: o?.telefono ?? '',
    unidad: o?.unidad ?? '',
    fechaInicio: o?.fechaInicio ?? '',
  };
}

/** Lo que conviene hacer después de cambiar de cargo: el carnet y el acta dicen el cargo anterior. */
function avisarCambioCargo(r: CambiarCargoOperadorCdaResult) {
  const antes = TEXTOS_GRUPO[r.grupoAnterior].titulo;
  const ahora = TEXTOS_GRUPO[r.operador.grupo].titulo;
  const pendientes = [
    r.carnetVigente && `reemita su carnet QR (el impreso dice el cargo de ${antes})`,
    r.actaVigente && `genere una nueva acta de entrega en ${ahora}`,
  ].filter(Boolean);
  if (pendientes.length === 0) return;
  sileo.warning({ title: `Pasó a ${ahora}: falta un paso`, description: `Ahora ${pendientes.join(' y ')}.` });
}

/**
 * Agregar a mano (sin `operador`) o corregir los datos de uno. La cédula solo
 * se escribe al agregar: es la llave con la que el Excel reimporta. Al editar,
 * el administrador puede pasarlo a otro cargo CDA (rige desde hoy).
 */
export function OperadorFormModal({
  operador,
  onClose,
  onHecho,
}: {
  operador?: OperadorCda;
  onClose: () => void;
  onHecho: () => void;
}) {
  const editando = !!operador;
  const { grupo, singular, Singular, cargoPorDefecto } = useGrupoCda();
  const qc = useQueryClient();
  const [f, setF] = useState<Formulario>(() => inicial(cargoPorDefecto, operador));
  const grupoOriginal = operador?.grupo ?? grupo;
  const [grupoNuevo, setGrupoNuevo] = useState<GrupoCda>(grupoOriginal);
  const cambiaCargo = editando && grupoNuevo !== grupoOriginal;

  function elegirCargo(g: GrupoCda) {
    // El texto de "Cargo" sigue al cargo CDA si era el de por defecto; si lo escribieron a mano, se respeta.
    const porDefecto = (x: GrupoCda) => TEXTOS_GRUPO[x].cargoPorDefecto;
    if (f.cargo === porDefecto(grupoNuevo)) cambiar({ cargo: porDefecto(g) });
    setGrupoNuevo(g);
  }
  const [errores, setErrores] = useState<Partial<Record<CampoForm, string>>>({});
  const cambiar = (c: Partial<Formulario>) => setF((prev) => ({ ...prev, ...c }));
  // Obligatoria al agregar y al editar a quien ya la tiene; solo los registros antiguos sin fecha pueden seguir así.
  const fechaObligatoria = !operador || !!operador.fechaInicio;

  const guardar = useMutation({
    // Llega ya validado con el esquema que toca: el de edición (sin cédula) o el de alta.
    mutationFn: async (datos: EditarOperadorCdaRequest | CrearOperadorCdaRequest) => {
      if (!operador) return { o: await crearOperadorCda({ ...(datos as CrearOperadorCdaRequest), grupo }), cambio: null };
      const o = await editarOperadorCda(operador.id, datos);
      if (!cambiaCargo) return { o, cambio: null };
      const cambio = await cambiarCargoOperadorCda(operador.id, grupoNuevo);
      return { o: cambio.operador, cambio };
    },
    onSuccess: ({ o, cambio }) => {
      sileo.success({
        title: cambio ? `Pasó a ${TEXTOS_GRUPO[o.grupo].titulo}` : editando ? 'Datos actualizados' : `${Singular} agregado`,
        description:
          cambio && cambio.desde !== hoyEcuador()
            ? `${o.apellidosNombres} · desde mañana (hoy ya marcó entrada)`
            : o.apellidosNombres,
      });
      if (cambio) {
        avisarCambioCargo(cambio);
        // Sale de esta lista y entra en la del otro cargo.
        qc.invalidateQueries({ queryKey: ['operadores-cda'] });
      }
      onHecho();
      onClose();
    },
    onError: (e) => {
      sileo.error({ title: mensajeError(e, `No se pudo guardar el ${singular}`) });
      // Si falló el cambio de cargo, los demás datos pueden haberse guardado: se refresca la lista.
      if (cambiaCargo) qc.invalidateQueries({ queryKey: ['operadores-cda'] });
    },
  });

  function enviar(e: FormEvent) {
    e.preventDefault();
    // Los opcionales vacíos no se mandan: la API los guarda vacíos.
    const body: Record<string, string> = {};
    for (const c of ORDEN_CAMPOS) if (f[c].trim() !== '' && !(editando && c === 'cedula')) body[c] = f[c];
    const r = (editando ? editarOperadorCdaSchema : crearOperadorCdaSchema).safeParse(body);
    const errs: Partial<Record<CampoForm, string>> = {};
    if (!r.success) for (const i of r.error.issues) errs[i.path[0] as CampoForm] ??= i.message;
    if (fechaObligatoria && !body.fechaInicio) errs.fechaInicio ??= 'Fecha de ingreso requerida';
    setErrores(errs);
    const conError = ORDEN_CAMPOS.find((c) => errs[c]);
    if (conError) {
      // El foco va al primer campo con error: su mensaje se lee junto con la etiqueta (WCAG 3.3.1).
      document.getElementById(`operador-${conError}`)?.focus();
      return;
    }
    if (r.success) guardar.mutate(r.data);
  }

  const campo = (id: CampoForm, etiqueta: string, control: ReactElement, opts: { ancho?: boolean; ayuda?: string; opcional?: boolean } = {}) => (
    <Campo
      id={`operador-${id}`}
      etiqueta={opts.opcional ? `${etiqueta} (opcional)` : etiqueta}
      error={errores[id]}
      ayuda={opts.ayuda}
      ancho={opts.ancho ?? false}
      requerido={!opts.opcional}
    >
      {control}
    </Campo>
  );
  const cantidadErrores = Object.keys(errores).length;
  const titulo = editando ? `Editar ${singular}` : `Agregar ${singular}`;

  return (
    <Modal labelledBy="operador-form-titulo" onClose={onClose} maxWidth={620}>
      <form className="ocda-modal" onSubmit={enviar} noValidate aria-busy={guardar.isPending}>
        <div className="ocda-modal-cabecera">
          <span className="ocda-modal-icono" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M19 8v6M22 11h-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <div>
            <h2 id="operador-form-titulo">{titulo}</h2>
            <p className="muted">{operador ? operador.apellidosNombres : 'Para quien no vino en el Excel de talento humano.'}</p>
          </div>
          <button type="button" className="ocda-modal-cerrar" onClick={onClose} aria-label="Cerrar">
            ×
          </button>
        </div>

        {cantidadErrores > 0 && (
          <div className="banner error" role="alert">
            {`Revise ${cantidadErrores === 1 ? 'el campo marcado' : `los ${cantidadErrores} campos marcados`}.`}
          </div>
        )}

        <div className="ocda-form">
          {campo(
            'apellidosNombres',
            'Apellidos y nombres',
            <input value={f.apellidosNombres} onChange={(e) => cambiar({ apellidosNombres: e.target.value })} autoComplete="off" autoFocus />,
            { ancho: true },
          )}
          {campo(
            'cedula',
            'Cédula',
            <input
              className="mono"
              inputMode="numeric"
              maxLength={10}
              value={f.cedula}
              readOnly={editando}
              onChange={(e) => cambiar({ cedula: e.target.value.replace(/\D/g, '').slice(0, 10) })}
              autoComplete="off"
            />,
            { ayuda: editando ? 'La cédula no se cambia.' : undefined },
          )}
          {campo(
            'telefono',
            'Teléfono',
            <input
              className="mono"
              type="tel"
              inputMode="tel"
              value={f.telefono}
              onChange={(e) => cambiar({ telefono: e.target.value })}
              placeholder="0991234567"
              autoComplete="off"
            />,
            { opcional: true, ayuda: 'Celular: 0991234567 o +593991234567.' },
          )}
          {editando && (
            <Campo
              id="operador-grupo"
              etiqueta="Cargo CDA"
              ancho
              requerido={false}
              ayuda={
                cambiaCargo
                  ? `Pasará a ${TEXTOS_GRUPO[grupoNuevo].titulo} desde hoy (desde mañana si ya marcó entrada hoy). Su asistencia anterior queda en ${TEXTOS_GRUPO[grupoOriginal].titulo}.`
                  : 'Para pasarlo a otro cargo (rige desde hoy).'
              }
            >
              <select value={grupoNuevo} onChange={(e) => elegirCargo(e.target.value as GrupoCda)}>
                {GRUPOS.map((g) => (
                  <option key={g} value={g}>
                    {TEXTOS_GRUPO[g].titulo}
                  </option>
                ))}
              </select>
            </Campo>
          )}
          {campo('cargo', 'Cargo', <input value={f.cargo} onChange={(e) => cambiar({ cargo: e.target.value })} />, { ancho: true })}
          {campo('unidad', 'Unidad', <input value={f.unidad} onChange={(e) => cambiar({ unidad: e.target.value })} />, {
            ancho: true,
            opcional: true,
          })}
          {campo(
            'fechaInicio',
            'Fecha de ingreso',
            <input type="date" value={f.fechaInicio} onChange={(e) => cambiar({ fechaInicio: e.target.value })} />,
            { opcional: !fechaObligatoria, ayuda: 'Día en que empieza a trabajar en el CDA.' },
          )}
        </div>

        <div className="ocda-modal-acciones">
          <button type="button" className="btn secondary" onClick={onClose} disabled={guardar.isPending}>
            Cancelar
          </button>
          <button type="submit" className="btn" disabled={guardar.isPending}>
            {guardar.isPending
              ? 'Guardando…'
              : cambiaCargo
                ? `Guardar y pasar a ${TEXTOS_GRUPO[grupoNuevo].titulo}`
                : editando
                  ? 'Guardar cambios'
                  : `Agregar ${singular}`}
          </button>
        </div>
      </form>
    </Modal>
  );
}
