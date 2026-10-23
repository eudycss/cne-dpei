import { cloneElement, useState, type FormEvent, type ReactElement } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { sileo } from 'sileo';
import type { ActaCdaFila, EstadoPrenda, GenerarActasCdaRequest } from '@cne/shared-types';
import { generarActasCdaSchema } from '@cne/shared-validation';
import { Modal } from '../../components/Modal';
import { generarActasCda, getPersonasEntregaCda } from '../../lib/queries/operadores-cda';
import { hoyEcuador } from './utils';

const ESTADOS: EstadoPrenda[] = ['NUEVO', 'BUENO', 'REGULAR', 'MALO'];
const PRENDAS = [
  { campo: 'estadoPeto', etiqueta: 'Peto' },
  { campo: 'estadoCredencial', etiqueta: 'Credencial' },
  { campo: 'estadoCordon', etiqueta: 'Cordón de la credencial' },
] as const;
const OTRA = 'otra';
/** Orden en pantalla: el foco va al primero con error. */
const ORDEN_CAMPOS = ['quien', 'entregaNombre', 'entregaCedula', 'entregaCargo', 'fecha', 'lugar'];

type Formulario = Omit<GenerarActasCdaRequest, 'operadorIds' | 'entregaUsuarioId'> & { quien: string };

function mensajeError(e: unknown, porDefecto: string): string {
  return (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? porDefecto;
}

/**
 * Datos comunes de las actas de los operadores elegidos: quién entrega (un
 * usuario o "otra persona"), fecha, lugar y estado de cada prenda. Quien
 * entrega siempre es ingeniero ("Ing." va fijo en el acta); se elige el cargo.
 */
export function GenerarActasModal({
  filas,
  onClose,
  onHecho,
}: {
  filas: ActaCdaFila[];
  onClose: () => void;
  onHecho: () => void;
}) {
  const personas = useQuery({ queryKey: ['actas-cda-entregan'], queryFn: getPersonasEntregaCda });
  const [f, setF] = useState<Formulario>({
    quien: '',
    entregaNombre: '',
    entregaCedula: '',
    entregaCargo: '',
    fecha: hoyEcuador(),
    lugar: 'Ibarra',
    estadoPeto: 'BUENO',
    estadoCredencial: 'NUEVO',
    estadoCordon: 'BUENO',
  });
  const [errores, setErrores] = useState<Record<string, string>>({});
  const firmadas = filas.filter((x) => x.acta?.estado === 'FIRMADA').length;
  const cambiar = (c: Partial<Formulario>) => setF((prev) => ({ ...prev, ...c }));

  function elegirQuien(quien: string) {
    const p = personas.data?.find((x) => x.usuarioId === quien);
    cambiar(
      p
        ? { quien, entregaNombre: p.nombre, entregaCedula: p.cedula, entregaCargo: p.cargoSugerido }
        : { quien, entregaNombre: '', entregaCedula: '', entregaCargo: '' },
    );
  }

  const generar = useMutation({
    mutationFn: generarActasCda,
    onSuccess: (r) => {
      const hechas = r.generadas + r.actualizadas;
      sileo.success({
        title: hechas === 1 ? '1 acta lista' : `${hechas} actas listas`,
        description: r.omitidasFirmadas > 0 ? `${r.omitidasFirmadas} ya estaban firmadas y no se cambiaron.` : undefined,
      });
      onHecho();
      onClose();
    },
    onError: (e) => sileo.error({ title: mensajeError(e, 'No se pudieron generar las actas') }),
  });

  function enviar(e: FormEvent) {
    e.preventDefault();
    const { quien, ...resto } = f;
    const body = {
      ...resto,
      operadorIds: filas.map((x) => x.operador.id),
      ...(quien && quien !== OTRA ? { entregaUsuarioId: quien } : {}),
    };
    const r = generarActasCdaSchema.safeParse(body);
    const errs: Record<string, string> = {};
    // Sin elegir quién entrega, sus campos aún no se muestran: solo se marca la lista.
    if (!quien) errs.quien = 'Elija quién entrega';
    else if (!r.success) for (const i of r.error.issues) errs[String(i.path[0])] ??= i.message;
    setErrores(errs);
    const conError = ORDEN_CAMPOS.find((c) => errs[c]);
    if (conError) {
      // El foco va al primer campo con error: su mensaje se lee junto con la etiqueta (WCAG 3.3.1).
      document.getElementById(`acta-${conError}`)?.focus();
      return;
    }
    if (Object.keys(errs).length === 0 && r.success) generar.mutate(r.data);
  }

  const campo = (id: string, etiqueta: string, control: ReactElement, ancho = false, ayuda?: string) => (
    <Campo key={id} id={id} etiqueta={etiqueta} error={errores[id]} ayuda={ayuda} ancho={ancho}>
      {control}
    </Campo>
  );
  const cantidadErrores = Object.keys(errores).length;

  return (
    <Modal labelledBy="generar-actas-titulo" onClose={onClose} maxWidth={620}>
      <form className="ocda-modal" onSubmit={enviar} noValidate aria-busy={generar.isPending}>
        <div className="ocda-modal-cabecera">
          <span className="ocda-modal-icono" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <div>
            <h2 id="generar-actas-titulo">Generar actas de entrega</h2>
            <p className="muted">
              {filas.length === 1 ? filas[0].operador.apellidosNombres : `${filas.length} operadores elegidos`}
            </p>
          </div>
          <button type="button" className="ocda-modal-cerrar" onClick={onClose} aria-label="Cerrar">
            ×
          </button>
        </div>

        <p className="muted" style={{ margin: 0 }}>
          Todos los campos son obligatorios.
        </p>
        {cantidadErrores > 0 && (
          <div className="banner error" role="alert">
            {errores.operadorIds ?? `Revise ${cantidadErrores === 1 ? 'el campo marcado' : `los ${cantidadErrores} campos marcados`}.`}
          </div>
        )}
        {firmadas > 0 && (
          <div className="banner" role="status">
            {firmadas} de los elegidos ya tienen el acta firmada: esas no se cambian.
          </div>
        )}

        <div className="ocda-form">
          {campo(
            'quien',
            'Entrega (Ing.)',
            <select value={f.quien} onChange={(e) => elegirQuien(e.target.value)}>
              <option value="">{personas.isLoading ? 'Cargando…' : 'Elija quién entrega…'}</option>
              {personas.data?.map((p) => (
                <option key={p.usuarioId} value={p.usuarioId}>
                  {p.nombre}
                </option>
              ))}
              <option value={OTRA}>Otra persona (escribir los datos)</option>
            </select>,
            true,
          )}
          {f.quien && (
            <>
              {campo(
                'entregaNombre',
                'Nombre completo',
                <input value={f.entregaNombre} onChange={(e) => cambiar({ entregaNombre: e.target.value })} autoComplete="off" />,
              )}
              {campo(
                'entregaCedula',
                'Cédula',
                <input
                  className="mono"
                  inputMode="numeric"
                  maxLength={10}
                  value={f.entregaCedula}
                  // La cédula de un usuario del sistema no se cambia: la API la comprueba.
                  readOnly={f.quien !== OTRA}
                  onChange={(e) => cambiar({ entregaCedula: e.target.value.replace(/\D/g, '').slice(0, 10) })}
                  autoComplete="off"
                />,
                false,
                f.quien !== OTRA ? 'Tomada del usuario elegido.' : undefined,
              )}
              {campo(
                'entregaCargo',
                'Cargo',
                <input value={f.entregaCargo} onChange={(e) => cambiar({ entregaCargo: e.target.value })} list="cargos-entrega" />,
                true,
              )}
              <datalist id="cargos-entrega">
                <option value="Asistente Electoral Transversal" />
                <option value="Analista Provincial de Seguridad Informática y Proyectos Tecnológicos Electorales 1" />
              </datalist>
            </>
          )}
          {campo('fecha', 'Fecha', <input type="date" value={f.fecha} onChange={(e) => cambiar({ fecha: e.target.value })} />)}
          {campo('lugar', 'Lugar', <input value={f.lugar} onChange={(e) => cambiar({ lugar: e.target.value })} />)}
          <fieldset className="ocda-form-prendas ancho">
            <legend>Estado de la indumentaria</legend>
            {PRENDAS.map((p) =>
              campo(
                p.campo,
                p.etiqueta,
                <select value={f[p.campo]} onChange={(e) => cambiar({ [p.campo]: e.target.value as EstadoPrenda })}>
                  {ESTADOS.map((s) => (
                    <option key={s} value={s}>
                      {s.charAt(0) + s.slice(1).toLowerCase()}
                    </option>
                  ))}
                </select>,
              ),
            )}
          </fieldset>
        </div>

        <div className="ocda-modal-acciones">
          <button type="button" className="btn secondary" onClick={onClose} disabled={generar.isPending}>
            Cancelar
          </button>
          <button type="submit" className="btn" disabled={generar.isPending}>
            {generar.isPending ? 'Generando…' : `Generar ${filas.length} acta(s)`}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Etiqueta + control + ayuda + error. El error va fuera de la etiqueta y,
 * como la ayuda, se enlaza con aria-describedby. Todos son obligatorios.
 */
function Campo({
  id,
  etiqueta,
  error,
  ayuda,
  ancho,
  children,
}: {
  id: string;
  etiqueta: string;
  error?: string;
  ayuda?: string;
  ancho: boolean;
  children: ReactElement;
}) {
  const idControl = `acta-${id}`;
  const describe = [ayuda && `${idControl}-ayuda`, error && `${idControl}-error`].filter(Boolean).join(' ');
  return (
    <div className={`ocda-form-campo${ancho ? ' ancho' : ''}`}>
      <label htmlFor={idControl}>{etiqueta}</label>
      {cloneElement(children, {
        id: idControl,
        'aria-required': true,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': describe || undefined,
      })}
      {ayuda && (
        <span id={`${idControl}-ayuda`} className="ocda-form-ayuda">
          {ayuda}
        </span>
      )}
      {error && (
        <span id={`${idControl}-error`} className="ocda-form-error">
          {error}
        </span>
      )}
    </div>
  );
}
