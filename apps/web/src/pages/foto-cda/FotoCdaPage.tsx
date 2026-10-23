import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { tokenFotoCdaSchema } from '@cne/shared-validation';
import type { EnlaceFotoCdaPublico } from '@cne/shared-types';
import { consultarEnlaceFotoCda, subirFotoCda } from '../../lib/queries/operadores-cda';
import { cargoCorto, partirNombre } from '../operadores-cda/utils';
import { reducirFoto } from './reducirFoto';

type Activo = Extract<EnlaceFotoCdaPublico, { estado: 'ACTIVO' }>;
type Paso = { tipo: 'datos' } | { tipo: 'vista'; foto: Blob; url: string } | { tipo: 'listo'; url: string };

function mensajeDe(e: unknown, porDefecto: string): string {
  return (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? porDefecto;
}
const estado = (e: unknown) => (e as { response?: { status?: number } })?.response?.status;

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
 * Página pública que abre el operador CDA desde el enlace que le llega por
 * WhatsApp (pantallas M1–M4 de Figma). El token viaja en el fragmento (#).
 */
export function FotoCdaPage() {
  usePaginaPrivada();
  const [token] = useState(() => window.location.hash.slice(1));
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
  } else contenido = <Flujo token={token} datos={data} />;

  return (
    <div className="tema-futurista fcda">
      <main className="fcda-contenedor">{contenido}</main>
    </div>
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
          <p className="fcda-marca-sub">Registro de foto · Operador CDA</p>
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

function Flujo({ token, datos }: { token: string; datos: Activo }) {
  const [paso, setPaso] = useState<Paso>({ tipo: 'datos' });
  const [inactivo, setInactivo] = useState(false);

  // Libera la vista previa anterior al cambiar de foto o salir.
  const url = paso.tipo === 'datos' ? null : paso.url;
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);

  const subir = useMutation({
    mutationFn: (foto: Blob) => subirFotoCda(token, foto),
    onSuccess: (_r, foto) => setPaso({ tipo: 'listo', url: URL.createObjectURL(foto) }),
    onError: (e) => estado(e) === 410 && setInactivo(true),
  });

  if (inactivo) return <EnlaceInactivo />;
  if (paso.tipo === 'listo') return <FotoRegistrada datos={datos} url={paso.url} />;
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
      datos={datos}
      onFoto={(foto) => setPaso({ tipo: 'vista', foto, url: URL.createObjectURL(foto) })}
    />
  );
}

function ConfirmarDatos({ datos, onFoto }: { datos: Activo; onFoto: (foto: Blob) => void }) {
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
      <Titulo>Hola, {nombreDePila(datos.apellidosNombres)}</Titulo>
      <p className="fcda-texto">Confirme que sus datos son correctos antes de subir su foto para la credencial.</p>

      <dl className="fcda-datos">
        <div>
          <dt>Nombre</dt>
          <dd>{datos.apellidosNombres}</dd>
        </div>
        <div>
          <dt>Cédula</dt>
          <dd className="mono">{datos.cedula}</dd>
        </div>
        {datos.telefono && (
          <div>
            <dt>Teléfono</dt>
            <dd className="mono">{datos.telefono}</dd>
          </div>
        )}
        <div>
          <dt>Cargo</dt>
          <dd>{cargoCorto(datos.cargo)}</dd>
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
      </div>
      <p className="fcda-pie">Enlace personal · vence {fechaHora(datos.expiraEn)}</p>
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

function FotoRegistrada({ datos, url }: { datos: Activo; url: string }) {
  const { apellidos, nombres } = partirNombre(datos.apellidosNombres);
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
            <p className="fcda-credencial-cargo">{cargoCorto(datos.cargo)}</p>
            <p className="fcda-credencial-apellidos">{apellidos}</p>
            {nombres && <p className="fcda-credencial-nombres">{nombres}</p>}
            <p className="mono">C.I. {datos.cedula}</p>
          </div>
        </div>
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
