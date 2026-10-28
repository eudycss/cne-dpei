import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { sileo } from 'sileo';
import { Modal } from '../../components/Modal';
import { Cargando } from '../../components/Cargando';
import {
  desactivarCuentasSinVinculo,
  getResumenCuentasCda,
  sincronizarCuentasCda,
} from '../../lib/queries/operadores-cda';
import { Kpi } from './Kpi';
import { mensajeError } from './utils';

type Confirmando = 'crear' | 'desactivar' | null;

const cuentas = (n: number) => `${n} cuenta${n === 1 ? '' : 's'}`;
const plural = (n: number, palabra: string) => `${n} ${palabra}${n === 1 ? '' : 's'}`;

/**
 * Cuentas de la app de los Operadores y Asistentes CDA (solo administrador).
 * Crear y vincular es idempotente: se puede pulsar de nuevo tras importar.
 */
export function CuentasAppModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [confirmando, setConfirmando] = useState<Confirmando>(null);
  const [resultado, setResultado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const resumen = useQuery({ queryKey: ['cuentas-cda', 'resumen'], queryFn: getResumenCuentasCda });

  const alTerminar = (mensaje: string) => {
    setConfirmando(null);
    setError(null);
    setResultado(mensaje);
    sileo.success({ title: mensaje });
    qc.invalidateQueries({ queryKey: ['cuentas-cda'] });
    qc.invalidateQueries({ queryKey: ['operadores-cda'] });
  };
  const alFallar = (e: unknown, porDefecto: string) => {
    setConfirmando(null);
    setResultado(null);
    setError(mensajeError(e, porDefecto));
  };

  const crear = useMutation({
    mutationFn: sincronizarCuentasCda,
    onSuccess: ({ creadas, vinculadas }) =>
      alTerminar(`${cuentas(creadas)} ${creadas === 1 ? 'creada' : 'creadas'} y ${plural(vinculadas, 'vinculada')}`),
    onError: (e) => alFallar(e, 'No se pudieron crear las cuentas'),
  });
  const desactivar = useMutation({
    mutationFn: desactivarCuentasSinVinculo,
    onSuccess: ({ desactivadas }) =>
      alTerminar(`${cuentas(desactivadas)} ${desactivadas === 1 ? 'desactivada' : 'desactivadas'}`),
    onError: (e) => alFallar(e, 'No se pudieron desactivar las cuentas'),
  });
  const ocupado = crear.isPending || desactivar.isPending;
  const r = resumen.data;
  const total = r ? r.conCuenta + r.sinCuenta : 0;

  return (
    <Modal labelledBy="cuentas-app-titulo" onClose={onClose} maxWidth={640}>
      <div className="ocda-modal" aria-busy={ocupado || resumen.isLoading}>
        <div className="ocda-modal-cabecera">
          <div>
            <h2 id="cuentas-app-titulo">Cuentas de la app</h2>
            <p className="muted">Operadores y asistentes CDA activos. Entran a la app con su cédula.</p>
          </div>
          <button type="button" className="ocda-modal-cerrar" onClick={onClose} aria-label="Cerrar">
            ×
          </button>
        </div>

        {resumen.isLoading && <Cargando />}
        {resumen.isError && (
          <p className="banner error" role="alert">
            No se pudo cargar el resumen de cuentas.
          </p>
        )}

        {r && (
          <>
            <div className="ocda-kpis">
              <Kpi
                etiqueta="Con cuenta"
                valor={`${r.conCuenta} de ${total}`}
                parte={r.conCuenta}
                total={total}
                detalle={`${r.sinCuenta} sin cuenta`}
              />
              <Kpi
                etiqueta="Deben cambiar contraseña"
                valor={String(r.pendientesCambioPwd)}
                parte={r.pendientesCambioPwd}
                total={r.conCuenta}
                detalle="Aún no entran por primera vez"
              />
              <Kpi
                etiqueta="Bloqueadas"
                valor={String(r.bloqueadas)}
                parte={r.bloqueadas}
                total={r.conCuenta}
                detalle="Por contraseñas erróneas (15 min)"
              />
            </div>

            {confirmando === 'crear' && (
              <div className="banner">
                <p style={{ marginTop: 0 }}>
                  Se creará la cuenta de {plural(r.sinCuenta, 'persona')} que aún no la tiene
                  {r.sinCuenta === 1 ? '' : 'n'}. Entrarán con su cédula y la misma contraseña inicial que “Restablecer
                  clave” en Usuarios, y deberán cambiarla en su primer ingreso.
                </p>
                <p style={{ marginBottom: 0 }}>
                  Quienes ya tenían una cuenta con su cédula se vinculan a ella y conservan su contraseña.
                </p>
              </div>
            )}
            {confirmando === 'desactivar' && (
              <div className="banner">
                <p style={{ margin: 0 }}>
                  Se desactivarán {cuentas(r.cuentasSinVinculo)} de Operador CDA que no corresponden a nadie de
                  Operadores CDA. Solo se tocan cuentas cuyo único rol es Operador CDA; cada una se puede reactivar en
                  Usuarios.
                </p>
              </div>
            )}

            {resultado && (
              <p className="banner" role="status">
                {resultado}
              </p>
            )}
            {error && (
              <p className="banner error" role="alert">
                {error}
              </p>
            )}

            <div className="ocda-modal-acciones">
              {confirmando ? (
                <>
                  <button
                    type="button"
                    className="btn secondary"
                    onClick={() => setConfirmando(null)}
                    disabled={ocupado}
                    autoFocus
                  >
                    No, volver
                  </button>
                  {confirmando === 'crear' ? (
                    <button type="button" className="btn" onClick={() => crear.mutate()} disabled={ocupado}>
                      {crear.isPending ? 'Creando cuentas…' : 'Sí, crear y vincular'}
                    </button>
                  ) : (
                    <button type="button" className="btn danger" onClick={() => desactivar.mutate()} disabled={ocupado}>
                      {desactivar.isPending ? 'Desactivando…' : 'Sí, desactivar'}
                    </button>
                  )}
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="btn secondary"
                    onClick={() => setConfirmando('desactivar')}
                    disabled={r.cuentasSinVinculo === 0}
                  >
                    Desactivar {cuentas(r.cuentasSinVinculo)} sin vínculo
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setConfirmando('crear')}
                    disabled={r.sinCuenta === 0}
                  >
                    Crear y vincular {cuentas(r.sinCuenta)}
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
