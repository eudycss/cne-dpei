import { useState, type FormEvent, type ReactElement } from 'react';
import { useMutation } from '@tanstack/react-query';
import { sileo } from 'sileo';
import type { EditarOperadorCdaRequest, OperadorCda } from '@cne/shared-types';
import { crearOperadorCdaSchema, editarOperadorCdaSchema } from '@cne/shared-validation';
import { Modal } from '../../components/Modal';
import { crearOperadorCda, editarOperadorCda } from '../../lib/queries/operadores-cda';
import { Campo } from './Campo';
import { useGrupoCda } from './grupo';
import { mensajeError } from './utils';

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

/**
 * Agregar a mano (sin `operador`) o corregir los datos de uno. La cédula solo
 * se escribe al agregar: es la llave con la que el Excel reimporta.
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
  const [f, setF] = useState<Formulario>(() => inicial(cargoPorDefecto, operador));
  const [errores, setErrores] = useState<Partial<Record<CampoForm, string>>>({});
  const cambiar = (c: Partial<Formulario>) => setF((prev) => ({ ...prev, ...c }));

  const guardar = useMutation({
    mutationFn: ({ cedula, ...resto }: EditarOperadorCdaRequest & { cedula?: string }) =>
      operador
        ? editarOperadorCda(operador.id, resto)
        : crearOperadorCda({ ...resto, cedula: cedula ?? '', grupo }),
    onSuccess: (o) => {
      sileo.success({ title: editando ? 'Datos actualizados' : `${Singular} agregado`, description: o.apellidosNombres });
      onHecho();
      onClose();
    },
    onError: (e) => sileo.error({ title: mensajeError(e, `No se pudo guardar el ${singular}`) }),
  });

  function enviar(e: FormEvent) {
    e.preventDefault();
    // Los opcionales vacíos no se mandan: la API los guarda vacíos.
    const body: Record<string, string> = {};
    for (const c of ORDEN_CAMPOS) if (f[c].trim() !== '' && !(editando && c === 'cedula')) body[c] = f[c];
    const r = (editando ? editarOperadorCdaSchema : crearOperadorCdaSchema).safeParse(body);
    const errs: Partial<Record<CampoForm, string>> = {};
    if (!r.success) for (const i of r.error.issues) errs[i.path[0] as CampoForm] ??= i.message;
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
          {campo('cargo', 'Cargo', <input value={f.cargo} onChange={(e) => cambiar({ cargo: e.target.value })} />, { ancho: true })}
          {campo('unidad', 'Unidad', <input value={f.unidad} onChange={(e) => cambiar({ unidad: e.target.value })} />, {
            ancho: true,
            opcional: true,
          })}
          {campo(
            'fechaInicio',
            'Fecha de inicio',
            <input type="date" value={f.fechaInicio} onChange={(e) => cambiar({ fechaInicio: e.target.value })} />,
            { opcional: true },
          )}
        </div>

        <div className="ocda-modal-acciones">
          <button type="button" className="btn secondary" onClick={onClose} disabled={guardar.isPending}>
            Cancelar
          </button>
          <button type="submit" className="btn" disabled={guardar.isPending}>
            {guardar.isPending ? 'Guardando…' : editando ? 'Guardar cambios' : `Agregar ${singular}`}
          </button>
        </div>
      </form>
    </Modal>
  );
}
