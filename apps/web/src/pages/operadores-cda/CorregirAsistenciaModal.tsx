import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { sileo } from 'sileo';
import type { AsistenciaCdaFila } from '@cne/shared-types';
import { corregirAsistenciaCdaSchema } from '@cne/shared-validation';
import { Modal } from '../../components/Modal';
import { corregirAsistenciaCda } from '../../lib/queries/operadores-cda';
import { Campo } from './Campo';
import { fechaCorta, horaEcuador, mensajeError } from './utils';

type CampoCorreccion = 'entrada' | 'salida' | 'motivo';
const ORDEN_CAMPOS: CampoCorreccion[] = ['entrada', 'salida', 'motivo'];

/**
 * Corrige la entrada y la salida de un día pasado (acción aparte, de fábrica
 * solo el administrador). El motivo queda en la bitácora junto con lo que
 * había antes; la marca que cambia queda a nombre de quien corrige.
 */
export function CorregirAsistenciaModal({
  fila,
  fecha,
  onClose,
  onHecho,
}: {
  fila: AsistenciaCdaFila;
  fecha: string;
  onClose: () => void;
  onHecho: () => void;
}) {
  const [entrada, setEntrada] = useState(fila.entradaEn ? horaEcuador(fila.entradaEn) : '');
  const [salida, setSalida] = useState(fila.salidaEn ? horaEcuador(fila.salidaEn) : '');
  const [motivo, setMotivo] = useState('');
  const [errores, setErrores] = useState<Partial<Record<CampoCorreccion, string>>>({});

  const guardar = useMutation({
    mutationFn: (body: Parameters<typeof corregirAsistenciaCda>[2]) =>
      corregirAsistenciaCda(fila.operador.id, fecha, body),
    onSuccess: () => {
      sileo.success({
        title: 'Asistencia corregida',
        description: `${fila.operador.apellidosNombres} · ${fechaCorta(fecha)}`,
      });
      onHecho();
      onClose();
    },
    onError: (e) =>
      sileo.error({
        title: mensajeError(e, 'No se pudo corregir la asistencia'),
      }),
  });

  function enviar(e: FormEvent) {
    e.preventDefault();
    const r = corregirAsistenciaCdaSchema.safeParse({
      entrada: entrada || null,
      salida: salida || null,
      motivo,
    });
    const errs: Partial<Record<CampoCorreccion, string>> = {};
    if (!r.success) for (const i of r.error.issues) errs[i.path[0] as CampoCorreccion] ??= i.message;
    setErrores(errs);
    const conError = ORDEN_CAMPOS.find((c) => errs[c]);
    if (conError) {
      // El foco va al primer campo con error: su mensaje se lee junto con la etiqueta (WCAG 3.3.1).
      document.getElementById(`corregir-${conError}`)?.focus();
      return;
    }
    if (r.success) guardar.mutate(r.data);
  }

  return (
    <Modal labelledBy="corregir-asistencia-titulo" onClose={onClose} maxWidth={520}>
      <form className="ocda-modal" onSubmit={enviar} noValidate aria-busy={guardar.isPending}>
        <div className="ocda-modal-cabecera">
          <div>
            <h2 id="corregir-asistencia-titulo">Corregir asistencia del {fechaCorta(fecha)}</h2>
            <p className="muted">{fila.operador.apellidosNombres}</p>
          </div>
          <button type="button" className="ocda-modal-cerrar" onClick={onClose} aria-label="Cerrar">
            ×
          </button>
        </div>

        <p className="muted" style={{ margin: 0 }}>
          Horas de Ecuador. Deje una hora vacía si no hubo marca. Quedará registrado quién corrigió, qué había antes y
          el motivo.
        </p>
        {Object.keys(errores).length > 0 && (
          <div className="banner error" role="alert">
            Revise los campos marcados.
          </div>
        )}

        <div className="ocda-form">
          <div className="ocda-hora">
            <Campo
              id="corregir-entrada"
              etiqueta="Entrada"
              error={errores.entrada}
              ayuda={fila.entradaEn ? `Antes: ${horaEcuador(fila.entradaEn)}` : 'Antes: sin entrada'}
              ancho={false}
              requerido={false}
            >
              <input type="time" step={60} value={entrada} onChange={(e) => setEntrada(e.target.value)} />
            </Campo>
            <SinMarca etiqueta="Sin entrada" vacia={!entrada} onVaciar={() => setEntrada('')} />
          </div>
          <div className="ocda-hora">
            <Campo
              id="corregir-salida"
              etiqueta="Salida"
              error={errores.salida}
              ayuda={fila.salidaEn ? `Antes: ${horaEcuador(fila.salidaEn)}` : 'Antes: sin salida'}
              ancho={false}
              requerido={false}
            >
              <input type="time" step={60} value={salida} onChange={(e) => setSalida(e.target.value)} />
            </Campo>
            <SinMarca etiqueta="Sin salida" vacia={!salida} onVaciar={() => setSalida('')} />
          </div>
          <Campo
            id="corregir-motivo"
            etiqueta="Motivo de la corrección"
            error={errores.motivo}
            ayuda="Queda en la bitácora y no se puede borrar: no incluya cédulas ni datos personales."
            ancho
          >
            <textarea
              rows={3}
              maxLength={300}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ej.: no se marcó la salida; lo confirmó el supervisor del CDA"
            />
          </Campo>
        </div>

        <div className="ocda-modal-acciones">
          <button type="button" className="btn secondary" onClick={onClose} disabled={guardar.isPending}>
            Cancelar
          </button>
          <button type="submit" className="btn" disabled={guardar.isPending}>
            {guardar.isPending ? 'Guardando…' : 'Guardar corrección'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Vaciar una hora sin pelear con el control de hora del navegador (teclado y lector de pantalla). */
function SinMarca({ etiqueta, vacia, onVaciar }: { etiqueta: string; vacia: boolean; onVaciar: () => void }) {
  return (
    <button type="button" className="btn secondary ocda-sin-marca" aria-pressed={vacia} onClick={onVaciar}>
      {etiqueta}
    </button>
  );
}
