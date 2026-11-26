import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import { cedulaSchema, FOTOS_INFORME_CDA } from '@cne/shared-validation';
import type { EstadoFotoInformeCda, VisitaInformeCdaPublica } from '@cne/shared-types';

import { consultarInformeCda, generarInformeCda, subirFotoInformeCda } from '../../lib/queries/informe-cda';
import { guardarArchivo } from '../../lib/queries/custodia';
import { textoDeBlob } from '../../lib/useDescargaPdf';
import { cargoCorto } from '../operadores-cda/utils';
import { FotoIlegibleError, reducirFoto } from '../foto-cda/reducirFoto';

// Las fotos del informe se ven bien impresas a media página: lado mayor de 1600 px.
const LADO_FOTO = 1600;
const BYTES_FOTO = 600 * 1024;

const estado = (e: unknown) => (e as { response?: { status?: number } })?.response?.status;

async function mensajeDe(e: unknown, porDefecto: string): Promise<string> {
  if (estado(e) === 429) return 'Demasiados intentos. Espere un minuto e intente de nuevo.';
  const cuerpo = (e as { response?: { data?: unknown } })?.response?.data;
  try {
    if (cuerpo instanceof Blob) return JSON.parse(await textoDeBlob(cuerpo))?.message ?? porDefecto;
  } catch {
    /* mensaje genérico */
  }
  return (cuerpo as { message?: string } | undefined)?.message ?? porDefecto;
}

/** Que el enlace no se filtre por Referer ni aparezca en buscadores. */
function usePaginaPrivada() {
  useEffect(() => {
    const metas = [
      Object.assign(document.createElement('meta'), { name: 'referrer', content: 'no-referrer' }),
      Object.assign(document.createElement('meta'), { name: 'robots', content: 'noindex, nofollow' }),
    ];
    metas.forEach((m) => document.head.appendChild(m));
    const tituloAnterior = document.title;
    document.title = 'Informe de productos · CNE Imbabura';
    return () => {
      metas.forEach((m) => m.remove());
      document.title = tituloAnterior;
    };
  }, []);
}

/**
 * Página pública del informe de productos del personal CDA/CPE: la persona
 * escribe su cédula, sube 6 fotos de su trabajo (con vista previa y opción de
 * reemplazar) y descarga su informe en Word. Por seguridad, las fotos de una
 * visita anterior no se muestran (cualquiera puede escribir una cédula ajena).
 */
export function InformeCdaPage() {
  usePaginaPrivada();
  const [visita, setVisita] = useState<VisitaInformeCdaPublica | null>(null);
  return (
    <div className="tema-futurista fcda">
      <main className="fcda-contenedor icda">
        {visita ? <Fotos visita={visita} onSalir={() => setVisita(null)} /> : <PedirCedula onVisita={setVisita} />}
      </main>
    </div>
  );
}

function Cabecera() {
  return (
    <header className="fcda-cabecera">
      <div className="fcda-marca">
        <span className="fcda-logo" aria-hidden="true">
          CNE
        </span>
        <div>
          <p className="fcda-marca-titulo">CNE · Imbabura</p>
          <p className="fcda-marca-sub">Informe de productos · Personal CDA y CPE</p>
        </div>
      </div>
    </header>
  );
}

/** Título que recibe el foco al cambiar de pantalla (los lectores de pantalla lo anuncian). */
function Titulo({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <h1 ref={ref} tabIndex={-1} className="fcda-titulo">
      {children}
    </h1>
  );
}

function PedirCedula({ onVisita }: { onVisita: (v: VisitaInformeCdaPublica) => void }) {
  const [cedula, setCedula] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [errorApi, setErrorApi] = useState<string | null>(null);
  const campo = useRef<HTMLInputElement>(null);
  const consultar = useMutation({
    mutationFn: consultarInformeCda,
    onSuccess: onVisita,
    onError: async (e) => setErrorApi(await mensajeDe(e, 'No se pudo consultar. Revise su conexión e intente de nuevo.')),
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
    setErrorApi(null);
    consultar.mutate(r.data);
  }

  return (
    <form className="fcda-form" onSubmit={enviar} noValidate aria-busy={consultar.isPending}>
      <Cabecera />
      <Titulo>Informe de productos</Titulo>
      <p className="fcda-texto">Ingrese su cédula para subir las 6 fotos de su trabajo y descargar su informe.</p>
      <div className="fcda-campo">
        <label htmlFor="icda-cedula">Número de cédula</label>
        <input
          id="icda-cedula"
          ref={campo}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          maxLength={10}
          value={cedula}
          aria-required="true"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'icda-cedula-error' : undefined}
          onChange={(e) => setCedula(e.target.value.replace(/\D/g, ''))}
        />
        {error && (
          <span id="icda-cedula-error" className="fcda-error">
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

interface Casilla {
  /** Vista previa local (solo lo que se subió en esta visita). */
  url: string | null;
  subiendo: boolean;
  error: string | null;
}

function Fotos({ visita, onSalir }: { visita: VisitaInformeCdaPublica; onSalir: () => void }) {
  const [fotos, setFotos] = useState<EstadoFotoInformeCda[]>(visita.fotos);
  const [casillas, setCasillas] = useState<Casilla[]>(() =>
    Array.from({ length: FOTOS_INFORME_CDA }, () => ({ url: null, subiendo: false, error: null })),
  );
  const [acepta, setAcepta] = useState(false);
  const [vencida, setVencida] = useState(false);
  const [aviso, setAviso] = useState('');
  const [ampliada, setAmpliada] = useState<number | null>(null);
  const [errorInforme, setErrorInforme] = useState<string | null>(null);
  const urls = useRef<string[]>([]);

  // Las vistas previas viven solo en esta página: se liberan al salir.
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const cargadas = fotos.filter((f) => f.cargada).length;
  const deAntes = fotos.filter((f) => f.cargada && !f.deEstaVisita).map((f) => f.posicion);
  const listas = cargadas === FOTOS_INFORME_CDA && deAntes.length === 0;

  function actualizar(i: number, cambio: Partial<Casilla>) {
    setCasillas((c) => c.map((x, j) => (j === i ? { ...x, ...cambio } : x)));
  }

  async function elegir(posicion: number, e: ChangeEvent<HTMLInputElement>) {
    const archivo = e.target.files?.[0];
    e.target.value = ''; // permite volver a elegir el mismo archivo
    if (!archivo) return;
    const i = posicion - 1;
    actualizar(i, { subiendo: true, error: null });
    setAviso(`Subiendo la foto ${posicion}…`);
    try {
      const reducida = await reducirFoto(archivo, { ladoMaximo: LADO_FOTO, bytesObjetivo: BYTES_FOTO });
      const nuevas = await subirFotoInformeCda(visita.token, posicion, reducida);
      const url = URL.createObjectURL(reducida);
      urls.current.push(url);
      const anterior = casillas[i].url;
      if (anterior) URL.revokeObjectURL(anterior);
      setFotos(nuevas);
      actualizar(i, { subiendo: false, url });
      setAviso(`Foto ${posicion} cargada. Lleva ${nuevas.filter((f) => f.cargada).length} de ${FOTOS_INFORME_CDA}.`);
    } catch (err) {
      if (estado(err) === 410) setVencida(true);
      const mensaje =
        err instanceof FotoIlegibleError ? err.message : await mensajeDe(err, 'No se pudo subir la foto. Intente de nuevo.');
      actualizar(i, { subiendo: false, error: mensaje });
      setAviso(`Foto ${posicion}: ${mensaje}`);
    }
  }

  const generar = useMutation({
    mutationFn: () => generarInformeCda(visita.token),
    onSuccess: (blob) => {
      setErrorInforme(null);
      guardarArchivo(blob, 'informe_productos.docx');
      setAviso('Informe descargado.');
    },
    onError: async (e) => {
      if (estado(e) === 410) setVencida(true);
      setErrorInforme(await mensajeDe(e, 'No se pudo generar el informe. Intente de nuevo.'));
    },
  });

  if (vencida) {
    return (
      <div className="fcda-form">
        <Cabecera />
        <Titulo>La visita venció</Titulo>
        <p className="fcda-texto">
          Por seguridad, cada visita dura 2 horas. Escriba su cédula de nuevo para continuar; las fotos ya subidas se
          conservan.
        </p>
        <div className="fcda-acciones">
          <button type="button" className="btn" onClick={onSalir}>
            Volver a ingresar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fcda-form">
      <Cabecera />
      <Titulo>Hola, {visita.nombreCorto}</Titulo>
      <dl className="fcda-datos">
        <div>
          <dt>Cédula</dt>
          <dd className="mono">{visita.cedula}</dd>
        </div>
        <div>
          <dt>Cargo</dt>
          <dd>{cargoCorto(visita.cargo)}</dd>
        </div>
      </dl>

      {!visita.tieneInforme && (
        <div className="banner" role="status">
          Su cargo aún no tiene formato de informe. Puede subir sus fotos; el informe lo entrega la Delegación.
        </div>
      )}

      <div className={`fcda-consentimiento${acepta ? ' marcado' : ''}`}>
        <label>
          <input type="checkbox" checked={acepta} onChange={(e) => setAcepta(e.target.checked)} />
          <span>
            Autorizo al CNE – Delegación Provincial Electoral de Imbabura a usar estas fotografías únicamente como
            registro fotográfico de mi informe de productos de este proceso electoral (LOPDP, art. 7 y 8).
          </span>
        </label>
        <details>
          <summary>Ver cómo se tratan sus datos</summary>
          <ul>
            <li>
              <strong>Para qué:</strong> el anexo «Registro fotográfico de trabajo» de su informe. No se comparte con
              terceros.
            </li>
            <li>
              <strong>Cómo se guardan:</strong> cifradas, sin la ubicación ni otros datos de su celular.
            </li>
            <li>
              <strong>Quién las ve:</strong> usted, solo durante esta visita, y la Delegación.
            </li>
            <li>
              <strong>Sus derechos:</strong> puede pedir ver, corregir o eliminar sus datos en la Delegación.
            </li>
          </ul>
        </details>
      </div>

      <div className="icda-avance">
        <label htmlFor="icda-progreso">
          <strong>{cargadas}</strong> de {FOTOS_INFORME_CDA} fotos
        </label>
        <progress id="icda-progreso" max={FOTOS_INFORME_CDA} value={cargadas} />
      </div>

      <ol className="icda-fotos" aria-label="Fotos del registro fotográfico">
        {fotos.map((f) => {
          const c = casillas[f.posicion - 1];
          const id = `icda-foto-${f.posicion}`;
          return (
            <li key={f.posicion} className={`icda-casilla${f.cargada ? ' cargada' : ''}${c.error ? ' con-error' : ''}`}>
              <span className="icda-numero">Foto {f.posicion}</span>
              {c.url ? (
                <button
                  type="button"
                  className="icda-miniatura"
                  onClick={() => setAmpliada(f.posicion)}
                  aria-label={`Ver la foto ${f.posicion} en grande`}
                >
                  <img src={c.url} alt="" />
                </button>
              ) : (
                <div className="icda-vacia" aria-hidden="true">
                  {f.cargada ? '✓' : '+'}
                </div>
              )}
              <p className="icda-estado">
                {c.subiendo
                  ? 'Subiendo…'
                  : c.error
                    ? c.error
                    : f.cargada
                      ? f.deEstaVisita
                        ? 'Cargada ✓'
                        : 'Cargada antes ✓ (no se muestra por seguridad)'
                      : 'Pendiente'}
              </p>
              <input
                id={id}
                className="icda-archivo"
                type="file"
                accept="image/*"
                disabled={!acepta || c.subiendo}
                onChange={(e) => elegir(f.posicion, e)}
              />
              <label
                htmlFor={id}
                className={`btn${f.cargada ? ' secondary' : ''}${!acepta || c.subiendo ? ' deshabilitado' : ''}`}
                aria-disabled={!acepta || c.subiendo}
              >
                {f.cargada ? 'Reemplazar' : 'Subir foto'}
                <span className="sr-only"> {f.posicion}</span>
              </label>
            </li>
          );
        })}
      </ol>
      {!acepta && <p className="fcda-texto">Marque la autorización para poder subir las fotos.</p>}

      <div className="sr-only" role="status" aria-live="polite">
        {aviso}
      </div>

      {errorInforme && (
        <div className="banner error" role="alert">
          {errorInforme}
        </div>
      )}
      {deAntes.length > 0 && cargadas === FOTOS_INFORME_CDA && (
        <p className="fcda-texto">
          Las fotos {deAntes.join(', ')} se subieron en otra visita. Reemplácelas aquí para descargar el informe, o
          pídalo a la Delegación.
        </p>
      )}
      <div className="fcda-acciones">
        <button
          type="button"
          className="btn"
          disabled={!listas || !visita.tieneInforme || generar.isPending}
          aria-busy={generar.isPending}
          onClick={() => generar.mutate()}
        >
          {generar.isPending ? 'Generando…' : 'Generar informe'}
        </button>
      </div>

      <Ampliada
        url={ampliada ? casillas[ampliada - 1].url : null}
        posicion={ampliada}
        onCerrar={() => setAmpliada(null)}
      />
    </div>
  );
}

/** Foto en grande con <dialog> nativo (Esc y foco atrapado los da el navegador). */
function Ampliada({ url, posicion, onCerrar }: { url: string | null; posicion: number | null; onCerrar: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (url && !d.open) d.showModal?.();
    if (!url && d.open) d.close?.();
  }, [url]);
  return (
    <dialog ref={ref} className="icda-dialogo" aria-label={`Foto ${posicion ?? ''}`} onClose={onCerrar}>
      {url && <img src={url} alt={`Foto ${posicion} que subió`} />}
      <form method="dialog">
        <button className="btn" autoFocus>
          Cerrar
        </button>
      </form>
    </dialog>
  );
}
