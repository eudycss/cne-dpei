import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { cedulaSchema, tokenFotoCdaSchema } from '@cne/shared-validation';
import type {
  EnlaceFotoCdaCreado,
  EnlaceFotoCdaPublico,
  FotoCdaPorCedula,
  SubidaFotoCdaResult,
} from '@cne/shared-types';
import {
  consultarEnlaceFotoCda,
  consultarFotoCdaPorCedula,
  subirFotoCda,
  subirFotoCdaPorCedula,
} from '../../lib/queries/operadores-cda';
import { cargoCorto, partirNombre } from '../operadores-cda/utils';
import { reducirFoto } from './reducirFoto';

type Activo = Extract<EnlaceFotoCdaPublico, { estado: 'ACTIVO' }>;
/** Lo que muestran las pantallas, venga del enlace personal o de la cédula. */
interface Persona {
  saludo: string;
  nombre: string;
  /** Enmascarada. */
  cedula: string;
  telefono: string | null;
  cargo: string;
  /** Líneas grande y pequeña del nombre en la credencial de muestra. */
  credencial: { principal: string; secundaria: string | null };
  pie: string | null;
}
type Paso = { tipo: 'datos' } | { tipo: 'vista'; foto: Blob; url: string } | { tipo: 'listo'; url: string };

const estado = (e: unknown) => (e as { response?: { status?: number } })?.response?.status;
function mensajeDe(e: unknown, porDefecto: string): string {
  // El límite de intentos responde en inglés (Nest): se traduce aquí.
  if (estado(e) === 429) return 'Demasiados intentos. Espere un minuto e intente de nuevo.';
  return (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? porDefecto;
}

/** "LUCÍA ESTEFANÍA" → "Lucía" */
function nombreDePila(apellidosNombres: string): string {
  const primero = partirNombre(apellidosNombres).nombres.split(' ')[0] || apellidosNombres.split(' ')[0];
  return primero.charAt(0) + primero.slice(1).toLowerCase();
}

function fechaHora(iso: string): string {
  return new Date(iso).toLocaleString('es-EC', {
    timeZone: 'America/Guayaquil',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
}

function deEnlace(d: Activo): Persona {
  const { apellidos, nombres } = partirNombre(d.apellidosNombres);
  return {
    saludo: nombreDePila(d.apellidosNombres),
    nombre: d.apellidosNombres,
    cedula: d.cedula,
    telefono: d.telefono,
    cargo: d.cargo,
    credencial: { principal: apellidos, secundaria: nombres || null },
    pie: `Enlace personal · vence ${fechaHora(d.expiraEn)}`,
  };
}

/** Con la cédula solo llega el nombre corto ("Lucía C."): cualquiera puede escribir una cédula ajena. */
function dePorCedula(d: FotoCdaPorCedula): Persona {
  return {
    saludo: d.nombreCorto.split(' ')[0] || d.nombreCorto,
    nombre: d.nombreCorto,
    cedula: d.cedula,
    telefono: null,
    cargo: d.cargo,
    credencial: { principal: d.nombreCorto, secundaria: null },
    pie: null,
  };
}

/** "14:35" en hora de Ecuador. */
function hora(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-EC', {
    timeZone: 'America/Guayaquil',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
}

/** Al terminar, el token sale de la barra de direcciones (historial, capturas de pantalla). */
function olvidarToken() {
  window.history.replaceState(null, '', window.location.pathname);
}

/** El enlace no debe filtrarse a otros sitios (Referer) ni aparecer en buscadores. */
function usePaginaPrivada() {
  useEffect(() => {
    const metas = [
      Object.assign(document.createElement('meta'), { name: 'referrer', content: 'no-referrer' }),
      Object.assign(document.createElement('meta'), { name: 'robots', content: 'noindex, nofollow' }),
    ];
    metas.forEach((m) => document.head.appendChild(m));
    const tituloAnterior = document.title;
    document.title = 'Registro de foto · CNE Imbabura';
    return () => {
      metas.forEach((m) => m.remove());
      document.title = tituloAnterior;
    };
  }, []);
}

/**
 * Página pública de foto del personal CDA/CPE (pantallas M1–M4 de Figma). Dos
 * formas de entrar: el enlace único /foto-cda (la persona escribe su cédula) o
 * el enlace personal /foto-cda#token que genera la Delegación (el token viaja
 * en el fragmento #). Solo el personal sirve para cambiar una foto ya subida.
 */
export function FotoCdaPage() {
  usePaginaPrivada();
  const [token] = useState(() => window.location.hash.slice(1));
  return (
    <div className="tema-futurista fcda">
      <main className="fcda-contenedor">{token ? <PorEnlace token={token} /> : <PorCedula />}</main>
    </div>
  );
}

function PorEnlace({ token }: { token: string }) {
  const tokenValido = tokenFotoCdaSchema.safeParse(token).success;

  const { data, isLoading, isError } = useQuery({
    queryKey: ['enlace-foto-cda', token],
    queryFn: () => consultarEnlaceFotoCda(token),
    enabled: tokenValido,
    retry: 1,
    staleTime: Infinity,
  });

  let contenido: ReactNode;
  if (!tokenValido || data?.estado === 'INACTIVO') contenido = <EnlaceInactivo />;
  else if (isLoading) {
    contenido = (
      <>
        <Cabecera />
        <Titulo>Registro de foto</Titulo>
        <p className="fcda-texto" role="status">
          Abriendo su enlace…
        </p>
      </>
    );
  } else if (isError || !data) {
    contenido = (
      <>
        <Cabecera />
        <Titulo>Registro de foto</Titulo>
        <div className="banner error" role="alert">
          No se pudo abrir el enlace. Revise su conexión a internet y recargue la página.
        </div>
      </>
    );
  } else {
    contenido = (
      <Flujo
        persona={deEnlace(data)}
        enviar={(foto) => subirFotoCda(token, foto)}
        pantallaPorError={(s) => (s === 410 ? <EnlaceInactivo /> : null)}
      />
    );
  }
  return <>{contenido}</>;
}

/** Enlace único: primero la cédula; si ya tiene foto, no se deja reemplazar desde aquí. */
function PorCedula() {
  const [encontrada, setEncontrada] = useState<{ cedula: string; datos: FotoCdaPorCedula } | null>(null);
  const [nueva, setNueva] = useState(false);
  if (!encontrada) return <PedirCedula onDatos={(cedula, datos) => setEncontrada({ cedula, datos })} />;
  if (encontrada.datos.tieneFoto && !nueva) return <YaTieneFoto onNueva={() => setNueva(true)} />;
  return (
    <Flujo
      persona={dePorCedula(encontrada.datos)}
      enviar={(foto) => subirFotoCdaPorCedula(encontrada.cedula, foto)}
      // Un 409 (otra subida a la vez) se muestra como aviso y deja reintentar.
      pantallaPorError={() => null}
      onVolver={() => {
        setNueva(false);
        setEncontrada(null);
      }}
    />
  );
}

function PedirCedula({ onDatos }: { onDatos: (cedula: string, datos: FotoCdaPorCedula) => void }) {
  const [cedula, setCedula] = useState('');
  const [error, setError] = useState<string | null>(null);
  const campo = useRef<HTMLInputElement>(null);
  const consultar = useMutation({
    mutationFn: consultarFotoCdaPorCedula,
    onSuccess: (datos, c) => onDatos(c, datos),
  });

  function enviar(e: FormEvent) {
    e.preventDefault();
    const r = cedulaSchema.safeParse(cedula.trim());
    if (!r.success) {
      setError(r.error.issues[0]?.message ?? 'Cédula inválida');
      campo.current?.focus();
      return;
    }
    setError(null);
    consultar.mutate(r.data);
  }

  const errorApi = consultar.isError
    ? mensajeDe(consultar.error, 'No se pudo consultar. Revise su conexión a internet e intente de nuevo.')
    : null;
  return (
    <form className="fcda-form" onSubmit={enviar} noValidate aria-busy={consultar.isPending}>
      <Cabecera paso={1} />
      <Titulo>Registro de foto</Titulo>
      <p className="fcda-texto">
        Ingrese su cédula para cargar su foto.
      </p>
      <div className="fcda-campo">
        <label htmlFor="fcda-cedula">Número de cédula</label>
        <input
          id="fcda-cedula"
          ref={campo}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          maxLength={10}
          value={cedula}
          aria-required="true"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'fcda-cedula-error' : undefined}
          onChange={(e) => setCedula(e.target.value.replace(/\D/g, ''))}
        />
        {error && (
          <span id="fcda-cedula-error" className="fcda-error">
            {error}
          </span>
        )}
      </div>
      {errorApi && (
        <div className="banner error" role="alert">
          {errorApi}
        </div>
      )}
      <div className="fcda-acciones">
        <button type="submit" className="btn" disabled={consultar.isPending}>
          {consultar.isPending ? 'Consultando…' : 'Continuar'}
        </button>
      </div>
    </form>
  );
}

function Cabecera({ paso }: { paso?: 1 | 2 | 3 }) {
  return (
    <header className="fcda-cabecera">
      <div className="fcda-marca">
        <span className="fcda-logo" aria-hidden="true">
          CNE
        </span>
        <div>
          <p className="fcda-marca-titulo">CNE · Imbabura</p>
          <p className="fcda-marca-sub">Registro de foto · Personal CDA y CPE</p>
        </div>
      </div>
      {paso && (
        <div className="fcda-progreso" role="img" aria-label={`Paso ${paso} de 3`}>
          {[1, 2, 3].map((n) => (
            <span key={n} className={n <= paso ? 'hecho' : ''} />
          ))}
        </div>
      )}
    </header>
  );
}

/** Título que recibe el foco al cambiar de pantalla (los lectores de pantalla lo anuncian). */
function Titulo({ children, centrado }: { children: ReactNode; centrado?: boolean }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <h1 ref={ref} tabIndex={-1} className={`fcda-titulo${centrado ? ' centrado' : ''}`}>
      {children}
    </h1>
  );
}

function Flujo({
  persona,
  enviar,
  pantallaPorError,
  onVolver,
}: {
  persona: Persona;
  enviar: (foto: Blob) => Promise<SubidaFotoCdaResult>;
  /** Errores que terminan el flujo (enlace gastado, ya tiene foto): su pantalla, o null. */
  pantallaPorError: (status: number | undefined) => ReactNode;
  onVolver?: () => void;
}) {
  const [paso, setPaso] = useState<Paso>({ tipo: 'datos' });
  const [final, setFinal] = useState<ReactNode>(null);
  // Enlace de cambio (30 min) que devuelve cada subida: solo vive en esta pestaña.
  const [cambio, setCambio] = useState<EnlaceFotoCdaCreado | null>(null);

  // Libera la vista previa anterior al cambiar de foto o salir.
  const url = paso.tipo === 'datos' ? null : paso.url;
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);

  const subir = useMutation({
    mutationFn: (foto: Blob) => (cambio ? subirFotoCda(cambio.token, foto) : enviar(foto)),
    onSuccess: (r, foto) => {
      if (r.pendiente) return setFinal(<FotoEnRevision />);
      setCambio(r.cambio);
      setPaso({ tipo: 'listo', url: URL.createObjectURL(foto) });
    },
    onError: (e) =>
      setFinal(cambio && estado(e) === 410 ? <CambioVencido /> : pantallaPorError(estado(e))),
  });

  if (final) return <>{final}</>;
  if (paso.tipo === 'listo') {
    return (
      <FotoRegistrada
        persona={persona}
        url={paso.url}
        cambiarHasta={cambio?.expiraEn ?? null}
        onCambiar={() => {
          subir.reset();
          setPaso({ tipo: 'datos' });
        }}
      />
    );
  }
  if (paso.tipo === 'vista') {
    return (
      <VistaPrevia
        foto={paso.foto}
        url={paso.url}
        subiendo={subir.isPending}
        error={subir.isError ? mensajeDe(subir.error, 'No se pudo subir la foto. Intente de nuevo.') : null}
        onUsar={() => subir.mutate(paso.foto)}
        onOtra={() => {
          subir.reset();
          setPaso({ tipo: 'datos' });
        }}
      />
    );
  }
  return (
    <ConfirmarDatos
      persona={persona}
      onFoto={(foto) => setPaso({ tipo: 'vista', foto, url: URL.createObjectURL(foto) })}
      onVolver={cambio ? undefined : onVolver}
    />
  );
}

function ConfirmarDatos({
  persona,
  onFoto,
  onVolver,
}: {
  persona: Persona;
  onFoto: (foto: Blob) => void;
  onVolver?: () => void;
}) {
  const [acepta, setAcepta] = useState(false);
  const [preparando, setPreparando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const camara = useRef<HTMLInputElement>(null);
  const galeria = useRef<HTMLInputElement>(null);
  const aviso = useRef<HTMLParagraphElement>(null);
  // Los botones se deshabilitan mientras se prepara la foto: el foco pasa al aviso.
  useEffect(() => {
    if (preparando) aviso.current?.focus();
  }, [preparando]);

  async function elegido(e: React.ChangeEvent<HTMLInputElement>) {
    const archivo = e.target.files?.[0];
    e.target.value = ''; // permite volver a elegir el mismo archivo
    if (!archivo) return;
    setError(null);
    setPreparando(true);
    try {
      onFoto(await reducirFoto(archivo));
    } catch (err) {
      setError((err as Error).message);
      setPreparando(false);
    }
  }

  const bloqueado = !acepta || preparando;
  return (
    <>
      <Cabecera paso={1} />
      <Titulo>Hola, {persona.saludo}</Titulo>
      <p className="fcda-texto">Confirme que sus datos son correctos antes de subir su foto para la credencial.</p>

      <dl className="fcda-datos">
        <div>
          <dt>Nombre</dt>
          <dd>{persona.nombre}</dd>
        </div>
        <div>
          <dt>Cédula</dt>
          <dd className="mono">{persona.cedula}</dd>
        </div>
        {persona.telefono && (
          <div>
            <dt>Teléfono</dt>
            <dd className="mono">{persona.telefono}</dd>
          </div>
        )}
        <div>
          <dt>Cargo</dt>
          <dd>{cargoCorto(persona.cargo)}</dd>
        </div>
      </dl>

      <ul className="fcda-consejos">
        <li>Rostro de frente, sin gafas ni gorra</li>
        <li>Buena luz y fondo claro</li>
        <li>Su foto solo se usa para la credencial CNE</li>
      </ul>

      <div className={`fcda-consentimiento${acepta ? ' marcado' : ''}`}>
        <label>
          <input type="checkbox" checked={acepta} onChange={(e) => setAcepta(e.target.checked)} />
          <span>
            Autorizo al CNE – Delegación Provincial Electoral de Imbabura a usar mi fotografía y mis datos únicamente
            para la credencial y el registro de asistencia de este proceso electoral (LOPDP, art. 7 y 8).
          </span>
        </label>
        <details>
          <summary>Ver cómo se tratan sus datos</summary>
          <ul>
            <li>
              <strong>Responsable:</strong> Consejo Nacional Electoral, Delegación Provincial Electoral de Imbabura.
            </li>
            <li>
              <strong>Para qué:</strong> imprimir su credencial y llevar el registro de asistencia y de entrega de
              prendas. No se comparte con terceros.
            </li>
            <li>
              <strong>Cómo se guarda:</strong> cifrada, sin la ubicación ni otros datos de su celular.
            </li>
            <li>
              <strong>Hasta cuándo:</strong> se elimina cuando usted deja de ser operador CDA.
            </li>
            <li>
              <strong>Sus derechos:</strong> puede pedir ver, corregir o eliminar sus datos en la Delegación.
            </li>
          </ul>
        </details>
      </div>

      {error && (
        <div className="banner error" role="alert">
          {error}
        </div>
      )}
      {preparando && (
        <p ref={aviso} tabIndex={-1} className="fcda-texto" role="status">
          Preparando la foto…
        </p>
      )}

      <div className="fcda-acciones">
        {!acepta && (
          <p id="fcda-falta-autorizar" className="fcda-nota">
            Marque la autorización para continuar.
          </p>
        )}
        <button
          type="button"
          className="btn"
          disabled={bloqueado}
          aria-describedby={acepta ? undefined : 'fcda-falta-autorizar'}
          onClick={() => camara.current?.click()}
        >
          Tomar foto
        </button>
        <button
          type="button"
          className="btn secondary"
          disabled={bloqueado}
          aria-describedby={acepta ? undefined : 'fcda-falta-autorizar'}
          onClick={() => galeria.current?.click()}
        >
          Elegir de la galería
        </button>
        <input ref={camara} type="file" accept="image/*" capture="user" hidden onChange={elegido} data-testid="camara" />
        <input ref={galeria} type="file" accept="image/*" hidden onChange={elegido} data-testid="galeria" />
        {onVolver && (
          <button type="button" className="btn secondary" disabled={preparando} onClick={onVolver}>
            No soy yo: cambiar cédula
          </button>
        )}
      </div>
      {persona.pie && <p className="fcda-pie">{persona.pie}</p>}
    </>
  );
}

function VistaPrevia(props: {
  foto: Blob;
  url: string;
  subiendo: boolean;
  error: string | null;
  onUsar: () => void;
  onOtra: () => void;
}) {
  return (
    <>
      <Cabecera paso={2} />
      <Titulo>¿Se ve bien?</Titulo>
      <p className="fcda-texto">El círculo muestra cómo aparecerá en la credencial.</p>
      <div className="fcda-circulo">
        <img src={props.url} alt="Vista previa de su foto" />
      </div>
      <p className="fcda-chip">
        <span>{Math.max(1, Math.round(props.foto.size / 1024))} KB · JPG</span>
      </p>
      {props.error && (
        <div className="banner error" role="alert">
          {props.error}
        </div>
      )}
      <div className="fcda-acciones">
        <button type="button" className="btn" disabled={props.subiendo} onClick={props.onUsar}>
          {props.subiendo ? 'Subiendo…' : 'Usar esta foto'}
        </button>
        <button type="button" className="btn secondary" disabled={props.subiendo} onClick={props.onOtra}>
          Tomar otra
        </button>
      </div>
    </>
  );
}

function FotoRegistrada({
  persona,
  url,
  cambiarHasta,
  onCambiar,
}: {
  persona: Persona;
  url: string;
  cambiarHasta: string | null;
  onCambiar: () => void;
}) {
  const { principal, secundaria } = persona.credencial;
  useEffect(olvidarToken, []);
  return (
    <>
      <Cabecera paso={3} />
      <div className="fcda-centro">
        <span className="fcda-icono exito" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M5 12.5l4.5 4.5L19 7.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <Titulo centrado>¡Listo, foto registrada!</Titulo>
        <p className="fcda-texto">Su foto quedó guardada para la credencial. Ya puede cerrar esta página.</p>
        <div className="fcda-credencial">
          <img src={url} alt="" />
          <div>
            <p className="fcda-credencial-cargo">{cargoCorto(persona.cargo)}</p>
            <p className="fcda-credencial-apellidos">{principal}</p>
            {secundaria && <p className="fcda-credencial-nombres">{secundaria}</p>}
            <p className="mono">C.I. {persona.cedula}</p>
          </div>
        </div>
        {cambiarHasta && (
          <div className="fcda-acciones">
            <p id="fcda-cambiar-hasta" className="fcda-nota">
              ¿No es la foto correcta? Puede cambiarla desde este celular hasta las {hora(cambiarHasta)}.
            </p>
            <button type="button" className="btn secondary" aria-describedby="fcda-cambiar-hasta" onClick={onCambiar}>
              Cambiar foto
            </button>
          </div>
        )}
      </div>
    </>
  );
}

function CambioVencido() {
  return (
    <>
      <Cabecera />
      <div className="fcda-centro">
        <span className="fcda-icono aviso" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" strokeLinecap="round" />
          </svg>
        </span>
        <Titulo centrado>El tiempo para cambiar la foto terminó</Titulo>
        <p className="fcda-texto">
          Su foto anterior quedó guardada. Si necesita cambiarla, pida un enlace personal a la Unidad de Seguridad
          Informática de la Delegación.
        </p>
      </div>
    </>
  );
}

function YaTieneFoto({ onNueva }: { onNueva: () => void }) {
  return (
    <>
      <Cabecera />
      <div className="fcda-centro">
        <span className="fcda-icono exito" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M5 12.5l4.5 4.5L19 7.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <Titulo centrado>Usted ya tiene una foto registrada</Titulo>
        <p id="fcda-nueva-ayuda" className="fcda-texto">
          Si necesita cambiarla, suba una foto nueva. La Delegación la revisará y, mientras tanto, se mantiene la
          actual.
        </p>
      </div>
      <div className="fcda-acciones">
        <button type="button" className="btn" aria-describedby="fcda-nueva-ayuda" onClick={onNueva}>
          Subir una foto nueva
        </button>
      </div>
    </>
  );
}

function FotoEnRevision() {
  return (
    <>
      <Cabecera paso={3} />
      <div className="fcda-centro">
        <span className="fcda-icono exito" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M5 12.5l4.5 4.5L19 7.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <Titulo centrado>Foto enviada</Titulo>
        <p className="fcda-texto">
          La Delegación revisará su foto nueva. Mientras tanto se mantiene la actual. Ya puede cerrar esta página.
        </p>
      </div>
    </>
  );
}

function EnlaceInactivo() {
  useEffect(olvidarToken, []);
  return (
    <>
      <Cabecera />
      <div className="fcda-centro">
        <span className="fcda-icono aviso" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" strokeLinecap="round" />
          </svg>
        </span>
        <Titulo centrado>Este enlace ya no está activo</Titulo>
        <p className="fcda-texto">
          Caducó o ya se usó para subir una foto. Pida un nuevo enlace a la Unidad de Seguridad Informática de la
          Delegación.
        </p>
      </div>
    </>
  );
}
