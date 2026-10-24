import { useEffect, useRef, useState } from 'react';
import type QrScanner from 'qr-scanner';

/**
 * Lee códigos QR con la cámara (la trasera si hay). `qr-scanner` se carga solo
 * al encender la cámara: usa el lector nativo del navegador cuando existe y,
 * si no, un worker. `pausado` congela la lectura sin soltar la cámara (no
 * vuelve a pedir permiso entre una persona y otra). Al desmontar se apaga.
 */
export function CamaraQr({
  onLeido,
  onError,
  pausado = false,
}: {
  onLeido: (codigo: string) => void;
  onError: (mensaje: string) => void;
  pausado?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const lectorRef = useRef<QrScanner | null>(null);
  const [lista, setLista] = useState(false);
  // En refs: el padre pasa funciones nuevas en cada render y no debe reiniciar la cámara.
  const onLeidoRef = useRef(onLeido);
  const onErrorRef = useRef(onError);
  const pausadoRef = useRef(pausado);
  onLeidoRef.current = onLeido;
  onErrorRef.current = onError;
  pausadoRef.current = pausado;

  useEffect(() => {
    let cancelado = false;
    (async () => {
      try {
        const { default: Lector } = await import('qr-scanner');
        if (cancelado || !videoRef.current) return;
        if (!(await Lector.hasCamera())) {
          onErrorRef.current('No se encontró una cámara en este equipo');
          return;
        }
        const lector = new Lector(videoRef.current, (r) => onLeidoRef.current(r.data), {
          preferredCamera: 'environment',
          maxScansPerSecond: 5,
          highlightScanRegion: true,
        });
        lectorRef.current = lector;
        await lector.start();
        if (cancelado) return;
        if (pausadoRef.current) await lector.pause();
        setLista(true);
      } catch (e) {
        if (cancelado) return;
        // Nunca el texto técnico del navegador: solo si fue por permiso o no.
        const sinPermiso = /NotAllowed|Permission|denied/i.test(String((e as Error)?.name ?? e) + String(e));
        onErrorRef.current(
          sinPermiso ? 'El navegador no dio permiso para usar la cámara' : 'No se pudo encender la cámara',
        );
      }
    })();
    return () => {
      cancelado = true;
      lectorRef.current?.destroy();
      lectorRef.current = null;
    };
  }, []);

  useEffect(() => {
    const lector = lectorRef.current;
    if (!lector || !lista) return;
    if (pausado) void lector.pause();
    else void lector.start().catch(() => onErrorRef.current('No se pudo encender la cámara'));
  }, [pausado, lista]);

  return (
    <div className="ocda-qr-camara">
      <video ref={videoRef} muted playsInline aria-label="Vista de la cámara para leer el carnet" />
      {!lista && <p className="muted">Encendiendo la cámara…</p>}
      {lista && !pausado && <p>Centre el código QR del carnet en el recuadro</p>}
    </div>
  );
}
