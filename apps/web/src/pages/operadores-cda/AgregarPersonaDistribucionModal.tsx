import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { sileo } from 'sileo';
import { MAX_CANDIDATOS_DISTRIBUCION, agregarPersonaDistribucionSchema } from '@cne/shared-validation';
import { Modal } from '../../components/Modal';
import { Cargando } from '../../components/Cargando';
import { agregarPersonaDistribucion, getCandidatosDistribucion } from '../../lib/queries/distribucion-dias';
import { diaCorto } from './distribucionDias';
import { mensajeError } from './utils';

type Tipo = 'REGISTRADA' | 'EXTERNA';

/** Espera a que se deje de escribir para no consultar en cada tecla. */
function useDiferido(valor: string, ms = 300): string {
  const [v, setV] = useState(valor);
  useEffect(() => {
    const t = setTimeout(() => setV(valor), ms);
    return () => clearTimeout(t);
  }, [valor, ms]);
  return v;
}

/**
 * Agregar a mano a una persona en un día: alguien del personal registrado de
 * cualquier cargo (también los excluidos del reparto, como Supervisores) o una
 * persona externa que no está en el sistema.
 */
export function AgregarPersonaDistribucionModal({
  distribucionId,
  fechas,
  sugerencias,
  onClose,
}: {
  distribucionId: string;
  fechas: string[];
  sugerencias: { cantones: string[]; encargados: string[] };
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [tipo, setTipo] = useState<Tipo>('REGISTRADA');
  const [fecha, setFecha] = useState(fechas[0] ?? '');
  const [buscar, setBuscar] = useState('');
  const [operadorId, setOperadorId] = useState('');
  const [ext, setExt] = useState({ nombres: '', cedula: '', telefono: '', sexo: '', cargo: '', canton: '', encargado: '' });
  const [error, setError] = useState<string | null>(null);
  const diferido = useDiferido(buscar);

  const candidatos = useQuery({
    queryKey: ['distribuciones-dias', distribucionId, 'candidatos', diferido],
    queryFn: () => getCandidatosDistribucion(distribucionId, diferido),
    enabled: tipo === 'REGISTRADA',
  });

  const agregar = useMutation({
    mutationFn: (body: Parameters<typeof agregarPersonaDistribucion>[1]) => agregarPersonaDistribucion(distribucionId, body),
    onSuccess: (p) => {
      void qc.invalidateQueries({ queryKey: ['distribuciones-dias'] });
      sileo.success({ title: 'Persona agregada', description: `${p.nombres} · ${diaCorto(p.fecha)}` });
      onClose();
    },
    onError: (e) => setError(mensajeError(e, 'No se pudo agregar a la persona')),
  });

  function enviar(e: FormEvent) {
    e.preventDefault();
    const datos =
      tipo === 'REGISTRADA'
        ? { tipo, fecha, operadorId }
        : { tipo, fecha, ...ext, telefono: ext.telefono || undefined, sexo: ext.sexo || undefined };
    const r = agregarPersonaDistribucionSchema.safeParse(datos);
    if (!r.success) {
      setError(tipo === 'REGISTRADA' && !operadorId ? 'Elija a una persona de la lista' : (r.error.issues[0]?.message ?? 'Revise los datos'));
      return;
    }
    setError(null);
    agregar.mutate(r.data);
  }

  const campo = (clave: keyof typeof ext, etiqueta: string, extra: Record<string, unknown> = {}) => (
    <label className="ocda-campo" style={{ flex: '1 1 200px' }}>
      <span>{etiqueta}</span>
      <input value={ext[clave]} onChange={(e) => setExt((prev) => ({ ...prev, [clave]: e.target.value }))} {...extra} />
    </label>
  );

  return (
    <Modal labelledBy="agregar-distribucion-titulo" onClose={onClose} maxWidth={620}>
      <form className="login-card" style={{ width: '100%', maxWidth: 'none' }} onSubmit={enviar} noValidate>
        <h1 id="agregar-distribucion-titulo">Agregar persona</h1>

        <fieldset style={{ border: 0, padding: 0, margin: '0 0 1rem' }}>
          <legend>¿Quién?</legend>
          <div className="row" style={{ gap: '1rem', flexWrap: 'wrap' }}>
            {(
              [
                ['REGISTRADA', 'Del personal registrado (cualquier cargo)'],
                ['EXTERNA', 'Persona externa (no está en el sistema)'],
              ] as const
            ).map(([valor, texto]) => (
              <label key={valor} className="row" style={{ gap: '0.4rem', alignItems: 'center', minHeight: 44 }}>
                <input type="radio" name="tipo-persona" value={valor} checked={tipo === valor} onChange={() => setTipo(valor)} />
                {texto}
              </label>
            ))}
          </div>
        </fieldset>

        <label className="ocda-campo">
          <span>Día</span>
          <select value={fecha} onChange={(e) => setFecha(e.target.value)}>
            {fechas.map((f) => (
              <option key={f} value={f}>
                {diaCorto(f)}
              </option>
            ))}
          </select>
        </label>

        {tipo === 'REGISTRADA' ? (
          <div style={{ marginTop: '1rem' }}>
            <label className="ocda-campo">
              <span>Buscar por nombre o cédula</span>
              <input type="search" value={buscar} onChange={(e) => setBuscar(e.target.value)} maxLength={60} autoFocus />
            </label>
            {candidatos.isLoading && <Cargando />}
            {candidatos.error && (
              <p className="banner error" role="alert">
                {mensajeError(candidatos.error, 'No se pudo buscar')}
              </p>
            )}
            {candidatos.data && (
              <fieldset style={{ border: 0, padding: 0, margin: '0.5rem 0 1rem', maxHeight: 280, overflowY: 'auto' }}>
                <legend className="sr-only">Personas encontradas</legend>
                <p className="muted" role="status">
                  {candidatos.data.length === 0
                    ? 'Nadie coincide, o ya están todos en la distribución.'
                    : `${candidatos.data.length} resultado(s)${candidatos.data.length >= MAX_CANDIDATOS_DISTRIBUCION ? '; escriba más para afinar' : ''}.`}
                </p>
                {candidatos.data.map((c) => {
                  const id = `candidato-${c.id}`;
                  return (
                    <div key={c.id} className="row" style={{ gap: '0.5rem', alignItems: 'center', minHeight: 44 }}>
                      <input id={id} type="radio" name="candidato" checked={operadorId === c.id} onChange={() => setOperadorId(c.id)} />
                      <label htmlFor={id}>
                        {c.nombre} <span className="muted">· {c.cedula} · {c.cargo}</span>
                      </label>
                    </div>
                  );
                })}
              </fieldset>
            )}
          </div>
        ) : (
          <div className="row" style={{ gap: '0.75rem', flexWrap: 'wrap', marginTop: '1rem' }}>
            {campo('nombres', 'Apellidos y nombres', { maxLength: 200, required: true, autoComplete: 'off' })}
            {campo('cedula', 'Cédula', { inputMode: 'numeric', maxLength: 10, required: true, pattern: '\\d{10}' })}
            {campo('telefono', 'Celular (opcional)', { inputMode: 'tel', maxLength: 15, placeholder: '09XXXXXXXX' })}
            <label className="ocda-campo" style={{ flex: '1 1 140px' }}>
              <span>Sexo</span>
              <select value={ext.sexo} required onChange={(e) => setExt((prev) => ({ ...prev, sexo: e.target.value }))}>
                <option value="">Elija…</option>
                <option value="M">Hombre</option>
                <option value="F">Mujer</option>
              </select>
            </label>
            {campo('cargo', 'Cargo', { maxLength: 160, required: true })}
            {campo('canton', 'Cantón (opcional)', { maxLength: 100, list: 'agregar-cantones' })}
            {campo('encargado', 'Encargado (opcional)', { maxLength: 200, list: 'agregar-encargados' })}
            <datalist id="agregar-cantones">
              {sugerencias.cantones.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            <datalist id="agregar-encargados">
              {sugerencias.encargados.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
        )}

        {error && (
          <p className="banner error" role="alert">
            {error}
          </p>
        )}
        <div className="row" style={{ gap: '0.5rem', flexWrap: 'wrap', marginTop: '1rem' }}>
          <button type="submit" className="btn" disabled={agregar.isPending} aria-busy={agregar.isPending}>
            {agregar.isPending ? 'Agregando…' : 'Agregar'}
          </button>
          <button type="button" className="btn secondary" onClick={onClose}>
            Cancelar
          </button>
        </div>
      </form>
    </Modal>
  );
}
