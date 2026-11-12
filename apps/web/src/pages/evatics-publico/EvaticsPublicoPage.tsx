import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import { cedulaSchema } from '@cne/shared-validation';
import type { ConsultaEvaticsPublica, EstadoCertificadoEvatics, SubidaEvaticsResult } from '@cne/shared-types';
import { consultarEvatics, subirEvatics } from '../../lib/queries/evatics';
import { reducirFoto } from '../foto-cda/reducirFoto';
import { cargoCorto, fechaLarga } from '../operadores-cda/utils';

/** El nombre del certificado debe leerse: más resolución que la foto de la credencial, bajo el tope de 2 MB de la API. */
export const LADO_CERTIFICADO = 1600;
export const BYTES_CERTIFICADO = 900 * 1024;

type Paso =
  | { tipo: 'cedula' }
  | { tipo: 'estado'; cedula: string; datos: ConsultaEvaticsPublica }
  | { tipo: 'vista'; cedula: string; datos: ConsultaEvaticsPublica; foto: Blob; url: string }
  | { tipo: 'listo'; cedula: string; datos: ConsultaEvaticsPublica; resultado: SubidaEvaticsResult };

const ESTADO: Record<EstadoCertificadoEvatics, { etiqueta: string; clase: string }> = {
  SIN_SUBIR: { etiqueta: 'Aún no lo sube', clase: 'vacio' },
  PENDIENTE: { etiqueta: 'En revisión', clase: 'aviso' },
  APROBADO: { etiqueta: 'Aprobado', clase: 'ok' },
  RECHAZADO: { etiqueta: 'Rechazado: suba otra foto', clase: 'error' },
};

function mensajeDe(e: unknown, porDefecto: string): string {
  return (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? porDefecto;
}

/** La página no debe filtrar la dirección a otros sitios ni aparecer en buscadores. */
function usePaginaPrivada() {
  useEffect(() => {
    const metas = [
      Object.assign(document.createElement('meta'), { name: 'referrer', content: 'no-referrer' }),
      Object.assign(document.createElement('meta'), { name: 'robots', content: 'noindex, nofollow' }),
    ];
    metas.forEach((m) => document.head.appendChild(m));
    const tituloAnterior = document.title;
    document.title = 'Certificado Evatics · CNE Imbabura';
    return () => {
      metas.forEach((m) => m.remove());
      document.title = tituloAnterior;
    };
  }, []);
}

/**
 * Página pública (sin sesión) para subir la foto del certificado Evatics. La
 * persona escribe su cédula; solo pasa si está en el personal CDA o CPE o es
 * Asistente Transversal. La cédula vive solo en memoria: no va en la URL ni se
 * guarda en el navegador.
 */
export function EvaticsPublicoPage() {
  usePaginaPrivada();
  const [paso, setPaso] = useState<Paso>({ tipo: 'cedula' });

  // Libera la vista previa al cambiar de foto o salir.
  const url = paso.tipo === 'vista' ? paso.url : null;
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);

  const reiniciar = () => setPaso({ tipo: 'cedula' });

  let contenido: ReactNode;
  if (paso.tipo === 'cedula') {
    contenido = <PedirCedula onDatos={(cedula, datos) => setPaso({ tipo: 'estado', cedula, datos })} />;
  } else if (paso.tipo === 'estado') {
    contenido = (
      <EstadoCertificado
        datos={paso.datos}
        onFoto={(foto) => setPaso({ ...paso, tipo: 'vista', foto, url: URL.createObjectURL(foto) })}
        onSalir={reiniciar}
      />
    );
  } else if (paso.tipo === 'vista') {
    contenido = (
      <VistaPrevia
        cedula={paso.cedula}
        foto={paso.foto}
        url={paso.url}
        onSubida={(resultado) => setPaso({ tipo: 'listo', cedula: paso.cedula, datos: paso.datos, resultado })}
        onOtra={() => setPaso({ tipo: 'estado', cedula: paso.cedula, datos: paso.datos })}
      />
    );
  } else {
    const { cedula, datos } = paso;
    contenido = (
      <Listo
        resultado={paso.resultado}
        onSalir={reiniciar}
        // La foto ya quedó en revisión: puede reemplazarla sin volver a escribir la cédula.
        onOtra={() => setPaso({ tipo: 'estado', cedula, datos: { ...datos, estado: 'PENDIENTE', motivoRechazo: null } })}
      />
    );
  }

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
          <p className="fcda-marca-sub">Certificado de capacitación Evatics</p>
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

function PedirCedula({ onDatos }: { onDatos: (cedula: string, datos: ConsultaEvaticsPublica) => void }) {
  const [cedula, setCedula] = useState('');
  const [error, setError] = useState<string | null>(null);
  const campo = useRef<HTMLInputElement>(null);
  const consultar = useMutation({
    mutationFn: consultarEvatics,
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
      <Titulo>Suba su certificado Evatics</Titulo>
      <p className="fcda-texto">
        Escriba su número de cédula. Si está registrado en el personal CDA, CPE o como Asistente Transversal, podrá
        subir la foto del certificado de la capacitación.
      </p>
      <div className="fcda-campo">
        <label htmlFor="evx-cedula">Número de cédula</label>
        <input
          id="evx-cedula"
          ref={campo}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          maxLength={10}
          value={cedula}
          aria-required="true"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'evx-cedula-error' : undefined}
          onChange={(e) => setCedula(e.target.value.replace(/\D/g, ''))}
        />
        {error && (
          <span id="evx-cedula-error" className="fcda-error">
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

function EstadoCertificado({
  datos,
  onFoto,
  onSalir,
}: {
  datos: ConsultaEvaticsPublica;
  onFoto: (foto: Blob) => void;
  onSalir: () => void;
}) {
  const e = ESTADO[datos.estado];
  return (
    <>
      <Cabecera paso={2} />
      <Titulo>Hola, {datos.nombreCorto}</Titulo>
      <dl className="fcda-datos">
        <div>
          <dt>Cargo</dt>
          <dd>{cargoCorto(datos.cargo)}</dd>
        </div>
        <div>
          <dt>Certificado</dt>
          <dd>
            <span className={`ocda-estado ${e.clase}`}>{e.etiqueta}</span>
          </dd>
        </div>
        <div>
          <dt>Plazo</dt>
          <dd>{datos.fechaLimite ? `Hasta el ${fechaLarga(datos.fechaLimite)}` : 'Sin fecha límite'}</dd>
        </div>
      </dl>
      <p className="fcda-texto">
        ¿No es usted? <button type="button" className="fcda-enlace" onClick={onSalir}>Escribir otra cédula</button>
      </p>

      {datos.estado === 'RECHAZADO' && datos.motivoRechazo && (
        <div className="banner error" role="status">
          <strong>Motivo del rechazo:</strong> {datos.motivoRechazo}
        </div>
      )}
      {datos.estado === 'APROBADO' && (
        <div className="banner" role="status">
          Sus notas ya fueron recibidas. No necesita hacer nada más.
        </div>
      )}
      {datos.estado === 'PENDIENTE' && datos.puedeSubir && (
        <p className="fcda-texto">
          Ya subió una foto y está en revisión. Si se equivocó de foto, puede reemplazarla.
        </p>
      )}
      {datos.plazoVencido && datos.estado !== 'APROBADO' && (
        <div className="banner error" role="status">
          El plazo para subir el certificado terminó. Comuníquese con la Delegación.
        </div>
      )}

      {datos.puedeSubir && <ElegirFoto onFoto={onFoto} reemplaza={datos.estado !== 'SIN_SUBIR'} />}
    </>
  );
}

function ElegirFoto({ onFoto, reemplaza }: { onFoto: (foto: Blob) => void; reemplaza: boolean }) {
  const [acepta, setAcepta] = useState(false);
  const [preparando, setPreparando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const camara = useRef<HTMLInputElement>(null);
  const galeria = useRef<HTMLInputElement>(null);
  const aviso = useRef<HTMLParagraphElement>(null);
  const banner = useRef<HTMLDivElement>(null);
  // Si sale (p. ej. "Escribir otra cédula") mientras se prepara, la foto no debe ir a la pantalla de otra persona.
  const montado = useRef(true);
  useEffect(
    () => () => {
      montado.current = false;
    },
    [],
  );
  // Los botones se deshabilitan mientras se prepara la foto: el foco pasa al aviso, y al error si falla.
  useEffect(() => {
    if (preparando) aviso.current?.focus();
  }, [preparando]);
  useEffect(() => {
    if (error) banner.current?.focus();
  }, [error]);

  async function elegido(e: React.ChangeEvent<HTMLInputElement>) {
    const archivo = e.target.files?.[0];
    e.target.value = ''; // permite volver a elegir el mismo archivo
    if (!archivo) return;
    setError(null);
    setPreparando(true);
    try {
      const foto = await reducirFoto(archivo, { ladoMaximo: LADO_CERTIFICADO, bytesObjetivo: BYTES_CERTIFICADO });
      if (montado.current) onFoto(foto);
    } catch (err) {
      if (!montado.current) return;
      setError((err as Error).message);
      setPreparando(false);
    }
  }

  const bloqueado = !acepta || preparando;
  return (
    <>
      <ul className="fcda-consejos">
        <li>Que se lea su nombre completo</li>
        <li>Certificado entero, de frente y con buena luz</li>
        <li>Sirve una captura de pantalla del certificado</li>
      </ul>

      <div className={`fcda-consentimiento${acepta ? ' marcado' : ''}`}>
        <label>
          <input type="checkbox" checked={acepta} onChange={(e) => setAcepta(e.target.checked)} />
          <span>
            Autorizo al CNE – Delegación Provincial Electoral de Imbabura a usar la foto de mi certificado y mi nombre
            únicamente para verificar que completé la capacitación Evatics (LOPDP, art. 7 y 8). Para leer el nombre,
            la foto se envía a un servicio de inteligencia artificial.
          </span>
        </label>
        <details>
          <summary>Ver cómo se tratan sus datos</summary>
          <ul>
            <li>
              <strong>Responsable:</strong> Consejo Nacional Electoral, Delegación Provincial Electoral de Imbabura.
            </li>
            <li>
              <strong>Para qué:</strong> comprobar que el certificado es suyo. Un técnico supervisor lo revisa y lo
              aprueba; la inteligencia artificial solo sugiere.
            </li>
            <li>
              <strong>Inteligencia artificial:</strong> la foto se envía a Google Gemini o, si no responde, a Groq,
              solo para leer el nombre impreso. En su plan gratuito, Google puede conservar el contenido para mejorar
              sus servicios.
            </li>
            <li>
              <strong>Cómo se guarda:</strong> cifrada, sin la ubicación ni otros datos de su celular.
            </li>
            <li>
              <strong>Hasta cuándo:</strong> la foto y sus datos se eliminan 90 días después de la fecha límite
              de entrega (si no hay fecha límite, 90 días después de subirla). Queda un registro de auditoría con la
              fecha y la dirección IP, sin su cédula ni su foto.
            </li>
            <li>
              <strong>Sus derechos:</strong> puede pedir ver, corregir o eliminar sus datos en la Delegación.
            </li>
          </ul>
        </details>
      </div>

      {error && (
        <div ref={banner} tabIndex={-1} className="banner error" role="alert">
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
          <p id="evx-falta-autorizar" className="fcda-nota">
            Marque la autorización para continuar.
          </p>
        )}
        <button
          type="button"
          className="btn"
          disabled={bloqueado}
          aria-describedby={acepta ? undefined : 'evx-falta-autorizar'}
          onClick={() => camara.current?.click()}
        >
          {reemplaza ? 'Tomar otra foto' : 'Tomar foto'}
        </button>
        <button
          type="button"
          className="btn secondary"
          disabled={bloqueado}
          aria-describedby={acepta ? undefined : 'evx-falta-autorizar'}
          onClick={() => galeria.current?.click()}
        >
          Elegir de la galería
        </button>
        <input
          ref={camara}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={elegido}
          data-testid="camara"
        />
        <input ref={galeria} type="file" accept="image/*" hidden onChange={elegido} data-testid="galeria" />
      </div>
    </>
  );
}

function VistaPrevia(props: {
  cedula: string;
  foto: Blob;
  url: string;
  onSubida: (r: SubidaEvaticsResult) => void;
  onOtra: () => void;
}) {
  const subir = useMutation({
    mutationFn: () => subirEvatics(props.cedula, props.foto),
    onSuccess: props.onSubida,
  });
  return (
    <>
      <Cabecera paso={2} />
      <Titulo>¿Se lee su nombre?</Titulo>
      <p className="fcda-texto">Revise que el certificado se vea completo y que su nombre se lea bien.</p>
      <div className="fcda-documento">
        <img src={props.url} alt="Vista previa del certificado" />
      </div>
      <p className="fcda-chip">
        <span>{Math.max(1, Math.round(props.foto.size / 1024))} KB · JPG</span>
      </p>
      {subir.isError && (
        <div className="banner error" role="alert">
          {mensajeDe(subir.error, 'No se pudo subir la foto. Intente de nuevo.')}
        </div>
      )}
      {subir.isPending && (
        <p className="fcda-texto" role="status">
          Subiendo y leyendo el certificado… puede tardar unos segundos.
        </p>
      )}
      <div className="fcda-acciones">
        <button type="button" className="btn" disabled={subir.isPending} onClick={() => subir.mutate()}>
          {subir.isPending ? 'Subiendo…' : 'Subir esta foto'}
        </button>
        <button type="button" className="btn secondary" disabled={subir.isPending} onClick={props.onOtra}>
          Elegir otra
        </button>
      </div>
    </>
  );
}

function Listo({
  resultado,
  onSalir,
  onOtra,
}: {
  resultado: SubidaEvaticsResult;
  onSalir: () => void;
  onOtra: () => void;
}) {
  return (
    <>
      <Cabecera paso={3} />
      <div className="fcda-centro">
        <span className={`fcda-icono ${resultado.aviso ? 'aviso' : 'exito'}`} aria-hidden="true">
          <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" strokeWidth="2.5">
            {resultado.aviso ? (
              <path d="M12 7v6M12 17h.01" strokeLinecap="round" />
            ) : (
              <path d="M5 12.5l4.5 4.5L19 7.5" strokeLinecap="round" strokeLinejoin="round" />
            )}
          </svg>
        </span>
        <Titulo centrado>{resultado.aviso ? 'Foto recibida, pero revísela' : '¡Listo, certificado recibido!'}</Titulo>
        {resultado.aviso ? (
          <div className="banner error" role="status">
            {resultado.aviso}
          </div>
        ) : (
          <p className="fcda-texto">
            Un supervisor revisará su imagen. Puede volver a esta página con su cédula para ver si fue aprobado.
          </p>
        )}
      </div>
      <div className="fcda-acciones">
        {resultado.aviso && (
          <button type="button" className="btn" onClick={onOtra}>
            Subir otra foto
          </button>
        )}
        <button type="button" className="btn secondary" onClick={onSalir}>
          Terminar
        </button>
      </div>
    </>
  );
}
