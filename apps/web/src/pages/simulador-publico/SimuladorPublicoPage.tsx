import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { EstadoIntentoSimulador, IngresoSimuladorResponse, PracticaDisponibleSimulador } from '@cne/shared-types';
import { ingresoSimuladorSchema } from '@cne/shared-validation';
import {
  estadoHttp,
  estadoSimulador,
  ingresarSimulador,
  iniciarSimulador,
  mensajeDe,
  tokenSimulador,
} from '../../lib/queries/simulador-publico';
import { fechaHoraEcuador } from '../../lib/queries/simulador';
import { PantallaDigitacion } from './PantallaDigitacion';

type Fase =
  | { tipo: 'cargando' }
  | { tipo: 'sin-conexion' }
  | { tipo: 'ingreso'; aviso?: string }
  | { tipo: 'practicas'; cedula: string; datos: IngresoSimuladorResponse }
  | { tipo: 'digitando'; token: string; estado: EstadoIntentoSimulador }
  | { tipo: 'resumen'; estado: EstadoIntentoSimulador };

const FUENTE_MANUSCRITA = 'https://fonts.googleapis.com/css2?family=Caveat:wght@500;700&display=swap';

/** Página pública: sin Referer hacia otros sitios, fuera de buscadores, y la letra manuscrita del acta. */
function usePaginaSimulador() {
  useEffect(() => {
    const elementos = [
      Object.assign(document.createElement('meta'), { name: 'referrer', content: 'no-referrer' }),
      Object.assign(document.createElement('meta'), { name: 'robots', content: 'noindex, nofollow' }),
      Object.assign(document.createElement('link'), { rel: 'stylesheet', href: FUENTE_MANUSCRITA }),
    ];
    elementos.forEach((e) => document.head.appendChild(e));
    const tituloAnterior = document.title;
    document.title = 'Simulador de digitación · CNE Imbabura';
    return () => {
      elementos.forEach((e) => e.remove());
      document.title = tituloAnterior;
    };
  }, []);
}

const SESION_PERDIDA =
  'Su sesión de práctica se abrió en otro equipo o ya no es válida. Vuelva a entrar con su cédula.';

/**
 * Simulador de digitación (público, como la pantalla de Digitación del SIER).
 * Se entra solo con la cédula; el token de la práctica queda en esta pestaña.
 */
export function SimuladorPublicoPage() {
  usePaginaSimulador();
  const [fase, setFase] = useState<Fase>(() => (tokenSimulador.leer() ? { tipo: 'cargando' } : { tipo: 'ingreso' }));

  // Recargar la página retoma la práctica de esta pestaña.
  function recuperar() {
    const token = tokenSimulador.leer();
    if (!token) return setFase({ tipo: 'ingreso' });
    setFase({ tipo: 'cargando' });
    estadoSimulador(token)
      .then((estado) => setFase(estado.terminado ? terminar(estado) : { tipo: 'digitando', token, estado }))
      .catch((e) => {
        // Solo un token rechazado se olvida; una caída de red o un reinicio de la API no hacen perder la práctica.
        const rechazado = [401, 404].includes(estadoHttp(e) ?? 0);
        if (rechazado) tokenSimulador.borrar();
        setFase(rechazado ? { tipo: 'ingreso' } : { tipo: 'sin-conexion' });
      });
  }
  useEffect(() => {
    if (tokenSimulador.leer()) recuperar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function terminar(estado: EstadoIntentoSimulador): Fase {
    tokenSimulador.borrar();
    return { tipo: 'resumen', estado };
  }

  return (
    <div className="sier">
      <header className="sier-cabecera">
        <span className="sier-marca" aria-hidden="true">
          CNE
        </span>
        <h1 className="sier-titulo">Simulador de digitación de actas</h1>
        <span className="sier-etiqueta">Práctica · no es el SIER</span>
      </header>
      <main className="sier-contenido">
        {fase.tipo === 'cargando' && (
          <p className="sier-tarjeta" role="status">
            Recuperando su práctica…
          </p>
        )}
        {fase.tipo === 'sin-conexion' && (
          <section className="sier-tarjeta" aria-labelledby="sim-sin-conexion">
            <TituloEnfocado id="sim-sin-conexion">No se pudo recuperar su práctica</TituloEnfocado>
            <p className="sier-aviso" role="alert">
              Revise la conexión a internet. Su práctica sigue guardada; el tiempo sigue corriendo.
            </p>
            <button type="button" className="sier-btn azul" onClick={recuperar}>
              Reintentar
            </button>
          </section>
        )}
        {fase.tipo === 'ingreso' && (
          <Ingreso aviso={fase.aviso} onIngresado={(cedula, datos) => setFase({ tipo: 'practicas', cedula, datos })} />
        )}
        {fase.tipo === 'practicas' && (
          <Practicas
            cedula={fase.cedula}
            datos={fase.datos}
            onVolver={() => setFase({ tipo: 'ingreso' })}
            onIniciada={(token, estado) => {
              tokenSimulador.guardar(token);
              setFase(estado.terminado ? terminar(estado) : { tipo: 'digitando', token, estado });
            }}
          />
        )}
        {fase.tipo === 'digitando' && (
          <PantallaDigitacion
            token={fase.token}
            estadoInicial={fase.estado}
            onTerminada={(estado) => setFase(terminar(estado))}
            onSesionPerdida={() => {
              tokenSimulador.borrar();
              setFase({ tipo: 'ingreso', aviso: SESION_PERDIDA });
            }}
          />
        )}
        {fase.tipo === 'resumen' && <Resumen estado={fase.estado} onSalir={() => setFase({ tipo: 'ingreso' })} />}
      </main>
    </div>
  );
}

/**
 * Título que recibe el foco al aparecer: al cambiar de fase, el foco no cae
 * en el vacío y el lector de pantalla anuncia dónde está (WCAG 2.4.3).
 */
function TituloEnfocado({ id, children }: { id: string; children: string }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <h2 id={id} ref={ref} tabIndex={-1}>
      {children}
    </h2>
  );
}

function Ingreso({
  aviso,
  onIngresado,
}: {
  aviso?: string;
  onIngresado: (cedula: string, datos: IngresoSimuladorResponse) => void;
}) {
  const [cedula, setCedula] = useState('');
  const [error, setError] = useState<string | null>(null);
  const ingresar = useMutation({
    mutationFn: ingresarSimulador,
    onSuccess: (datos, c) => onIngresado(c, datos),
    onError: (e) => setError(mensajeDe(e, 'No se pudo ingresar. Intente de nuevo.')),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const r = ingresoSimuladorSchema.safeParse({ cedula: cedula.trim() });
    if (!r.success) {
      setError(r.error.issues[0].message);
      document.getElementById('sim-cedula')?.focus();
      return;
    }
    setError(null);
    ingresar.mutate(r.data.cedula);
  }

  return (
    <form className="sier-tarjeta sier-ingreso" onSubmit={onSubmit} noValidate aria-busy={ingresar.isPending}>
      <h2>Ingresar a la práctica</h2>
      {aviso && (
        <p className="sier-aviso" role="alert">
          {aviso}
        </p>
      )}
      <label htmlFor="sim-cedula">Número de cédula</label>
      <input
        id="sim-cedula"
        inputMode="numeric"
        autoComplete="off"
        maxLength={10}
        autoFocus
        value={cedula}
        aria-required
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? 'sim-cedula-error' : undefined}
        onChange={(e) => {
          setCedula(e.target.value.replace(/\D/g, ''));
          setError(null);
        }}
      />
      {error && (
        <p id="sim-cedula-error" className="sier-error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="sier-btn azul" disabled={ingresar.isPending}>
        {ingresar.isPending ? 'Ingresando…' : 'Ingresar'}
      </button>
    </form>
  );
}

function Practicas({
  cedula,
  datos,
  onVolver,
  onIniciada,
}: {
  cedula: string;
  datos: IngresoSimuladorResponse;
  onVolver: () => void;
  onIniciada: (token: string, estado: EstadoIntentoSimulador) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const iniciar = useMutation({
    mutationFn: (p: PracticaDisponibleSimulador) => iniciarSimulador(cedula, p.id),
    onSuccess: (r) => onIniciada(r.token, r.estado),
    onError: (e) => setError(mensajeDe(e, 'No se pudo empezar la práctica. Intente de nuevo.')),
  });

  return (
    <section className="sier-tarjeta" aria-labelledby="sim-practicas-titulo" aria-busy={iniciar.isPending}>
      <TituloEnfocado id="sim-practicas-titulo">Prácticas disponibles</TituloEnfocado>
      <p className="sier-persona">
        {datos.nombre} · {datos.cargo}
      </p>
      {error && (
        <p className="sier-aviso" role="alert">
          {error}
        </p>
      )}
      <ul className="sier-practicas">
        {datos.practicas.map((p) => {
          const agotada = !p.enCurso && p.intentosUsados >= p.intentosMax;
          return (
            <li key={p.id}>
              <h3>{p.nombre}</h3>
              <p>
                Meta: <strong>{p.metaActas} actas</strong> de {p.filasPorActa} filas en <strong>{p.plazoMinutos} minutos</strong>.
              </p>
              <p className="sier-suave">
                Intentos: {p.intentosUsados} de {p.intentosMax} · Puede empezar hasta {fechaHoraEcuador(p.fin)}
              </p>
              {!p.enCurso && !agotada && (
                <p className="sier-suave">
                  El cronómetro empieza al pulsar el botón. Alt+Q pide una nueva acta, Enter pasa de fila y Alt+W la envía.
                </p>
              )}
              <button
                type="button"
                className="sier-btn verde"
                disabled={agotada || iniciar.isPending}
                onClick={() => {
                  setError(null);
                  iniciar.mutate(p);
                }}
              >
                {p.enCurso ? 'Continuar' : agotada ? 'Sin intentos' : `Empezar intento ${p.intentosUsados + 1}`}
              </button>
            </li>
          );
        })}
      </ul>
      <button type="button" className="sier-btn claro" onClick={onVolver}>
        Salir
      </button>
    </section>
  );
}

function Resumen({ estado, onSalir }: { estado: EstadoIntentoSimulador; onSalir: () => void }) {
  const cumplio = estado.motivo === 'META';
  return (
    <section className="sier-tarjeta sier-resumen" aria-labelledby="sim-resumen-titulo">
      <TituloEnfocado id="sim-resumen-titulo">{cumplio ? 'Cumplió la meta' : 'Se acabó el tiempo'}</TituloEnfocado>
      <p className="sier-persona">
        {estado.nombre} · {estado.cargo} · {estado.practica} (intento {estado.numeroIntento})
      </p>
      <dl className="sier-cifras">
        <div>
          <dt>Registros digitados</dt>
          <dd>{estado.filasDigitadas}</dd>
        </div>
        <div>
          <dt>Registros correctos</dt>
          <dd>{estado.filasCorrectas}</dd>
        </div>
        <div>
          <dt>Registros con error</dt>
          <dd>{estado.filasDigitadas - estado.filasCorrectas}</dd>
        </div>
        <div>
          <dt>Actas digitadas</dt>
          <dd>
            {estado.completadas} de {estado.metaActas}
          </dd>
        </div>
        <div>
          <dt>Sin errores al primer guardado</dt>
          <dd>{estado.perfectas}</dd>
        </div>
        <div>
          <dt>Con algún error</dt>
          <dd>{estado.completadas - estado.perfectas}</dd>
        </div>
      </dl>
      <button type="button" className="sier-btn azul" onClick={onSalir}>
        Terminar
      </button>
    </section>
  );
}

export { SESION_PERDIDA };
