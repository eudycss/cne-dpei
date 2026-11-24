import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { sileo } from 'sileo';
import type { DistribucionDiasDetalle } from '@cne/shared-types';
import { MAX_DIAS_DISTRIBUCION, crearDistribucionDiasSchema } from '@cne/shared-validation';
import { Modal } from '../../components/Modal';
import { crearDistribucion } from '../../lib/queries/distribucion-dias';
import { useCargosCda } from './grupo';
import { EXCLUIDOS_POR_DEFECTO, proximoFinDeSemana } from './distribucionDias';
import { hoyEcuador, mensajeError } from './utils';

/** Valores de la distribución anterior (cantón y encargado del CPE, excluidos) para no escribirlos otra vez. */
export interface BaseNuevaDistribucion {
  excluirCargos: string[];
  cantonCpe: string | null;
  encargadoCpe: string | null;
}

/**
 * Nueva distribución: nombre, días (1 a 7) y qué cargos quedan fuera del
 * reparto automático. Al crearla, la API reparte al personal activo.
 */
export function NuevaDistribucionModal({
  anterior,
  onClose,
  onCreada,
}: {
  anterior: BaseNuevaDistribucion | null;
  onClose: () => void;
  onCreada: (d: DistribucionDiasDetalle) => void;
}) {
  const { cargos } = useCargosCda();
  const qc = useQueryClient();
  const [nombre, setNombre] = useState('');
  const [fechas, setFechas] = useState<string[]>(() => proximoFinDeSemana(hoyEcuador()));
  const [excluir, setExcluir] = useState<Set<string>>(() => new Set(anterior?.excluirCargos ?? EXCLUIDOS_POR_DEFECTO));
  const [cantonCpe, setCantonCpe] = useState(anterior?.cantonCpe ?? 'IBARRA');
  const [encargadoCpe, setEncargadoCpe] = useState(anterior?.encargadoCpe ?? '');
  const [error, setError] = useState<string | null>(null);

  const crear = useMutation({
    mutationFn: crearDistribucion,
    onSuccess: (d) => {
      void qc.invalidateQueries({ queryKey: ['distribuciones-dias'] });
      sileo.success({ title: 'Distribución creada', description: `${d.total} personas repartidas en ${d.fechas.length} día(s)` });
      onCreada(d);
    },
    onError: (e) => setError(mensajeError(e, 'No se pudo crear la distribución')),
  });

  function enviar(e: FormEvent) {
    e.preventDefault();
    const vacio = fechas.findIndex((f) => !f);
    if (vacio !== -1) {
      setError(`Complete o quite el día ${vacio + 1}`);
      return;
    }
    const r = crearDistribucionDiasSchema.safeParse({ nombre, fechas, excluirCargos: [...excluir], cantonCpe, encargadoCpe });
    if (!r.success) {
      setError(r.error.issues[0]?.message ?? 'Revise los datos');
      return;
    }
    setError(null);
    crear.mutate(r.data);
  }

  const alternar = (clave: string) =>
    setExcluir((prev) => {
      const s = new Set(prev);
      if (s.has(clave)) s.delete(clave);
      else s.add(clave);
      return s;
    });

  const activos = cargos.filter((c) => c.activo);

  return (
    <Modal labelledBy="nueva-distribucion-titulo" onClose={onClose} maxWidth={620}>
      <form className="login-card" style={{ width: '100%', maxWidth: 'none' }} onSubmit={enviar} noValidate>
        <h1 id="nueva-distribucion-titulo">Nueva distribución por días</h1>
        <p className="muted">
          Cada persona activa va un solo día, con la misma cantidad de hombres y de mujeres por día. Luego puede mover, agregar o quitar
          personas.
        </p>

        <label className="ocda-campo">
          <span>Nombre</span>
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={120} required placeholder="Ej.: Fin de semana 20 al 22 de noviembre" />
        </label>

        <fieldset style={{ border: 0, padding: 0, margin: '1rem 0' }}>
          <legend>Días</legend>
          {fechas.map((f, i) => (
            <div key={i} className="row" style={{ gap: '0.5rem', alignItems: 'center', marginBottom: '0.4rem' }}>
              <label className="ocda-fecha">
                <span className="sr-only">Día {i + 1}</span>
                <input type="date" value={f} required onChange={(e) => setFechas((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))} />
              </label>
              {fechas.length > 1 && (
                <button type="button" className="btn secondary" onClick={() => setFechas((prev) => prev.filter((_, j) => j !== i))} aria-label={`Quitar el día ${i + 1}`}>
                  Quitar
                </button>
              )}
            </div>
          ))}
          {fechas.length < MAX_DIAS_DISTRIBUCION && (
            <button type="button" className="btn secondary" onClick={() => setFechas((prev) => [...prev, ''])}>
              Agregar día
            </button>
          )}
        </fieldset>

        <fieldset style={{ border: 0, padding: 0, margin: '0 0 1rem' }}>
          <legend>Cargos que no entran en el reparto</legend>
          <p className="muted" style={{ marginTop: 0 }}>
            Se pueden agregar después, persona por persona, con «Agregar persona».
          </p>
          {activos.map((c) => {
            const id = `excluir-cargo-${c.clave}`;
            return (
              <div key={c.clave} className="row" style={{ gap: '0.5rem', alignItems: 'center', minHeight: 44 }}>
                <input id={id} type="checkbox" checked={excluir.has(c.clave)} onChange={() => alternar(c.clave)} />
                <label htmlFor={id}>
                  {c.nombre} <span className="muted">({c.centro})</span>
                </label>
              </div>
            );
          })}
        </fieldset>

        <fieldset style={{ border: 0, padding: 0, margin: '0 0 1rem' }}>
          <legend>Personal del CPE</legend>
          <p className="muted" style={{ marginTop: 0 }}>
            El CDA toma el cantón y el técnico del recinto de su última pareja. El CPE no tiene recinto: se le pone este cantón y este encargado.
          </p>
          <div className="row" style={{ gap: '0.75rem', flexWrap: 'wrap' }}>
            <label className="ocda-campo" style={{ flex: '1 1 180px' }}>
              <span>Cantón del CPE</span>
              <input value={cantonCpe} onChange={(e) => setCantonCpe(e.target.value)} maxLength={100} />
            </label>
            <label className="ocda-campo" style={{ flex: '1 1 220px' }}>
              <span>Encargado del CPE</span>
              <input value={encargadoCpe} onChange={(e) => setEncargadoCpe(e.target.value)} maxLength={200} />
            </label>
          </div>
        </fieldset>

        {error && (
          <p className="banner error" role="alert">
            {error}
          </p>
        )}
        <div className="row" style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
          <button type="submit" className="btn" disabled={crear.isPending} aria-busy={crear.isPending}>
            {crear.isPending ? 'Repartiendo…' : 'Crear y repartir'}
          </button>
          <button type="button" className="btn secondary" onClick={onClose}>
            Cancelar
          </button>
        </div>
      </form>
    </Modal>
  );
}
