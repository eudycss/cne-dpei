import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { sileo } from 'sileo';
import type { EventoElectoral } from '@cne/shared-types';
import { LIMITES_PERIMETRO } from '@cne/shared-validation';
import { api } from '../../lib/api';
import { useModulos } from '../../lib/useModulos';
import { clavePlanes, crearPlanPerimetro, getPlanesPerimetro } from '../../lib/queries/perimetro';
import { mensajeError } from '../operadores-cda/utils';
import { CENTRO_DELEGACION } from './MapaPlan';
import { DetallePlan } from './DetallePlan';

/** Plan de perímetro: despliegue de puestos (personal CDA/CPE), vallas y zonas sobre el mapa de un evento. */
export function PlanPerimetroPage() {
  const { data: eventos, isError: errorEventos } = useQuery({
    queryKey: ['eventos'],
    queryFn: async () => (await api.get<EventoElectoral[]>('/eventos')).data,
  });
  const [eventoId, setEventoId] = useState('');
  const [planId, setPlanId] = useState<string | null>(null);
  // Con cambios a medio editar no se cambia de evento ni de plan.
  const [editando, setEditando] = useState(false);
  const { puede } = useModulos();

  // Por defecto, el evento ACTIVO (o el primero de la lista).
  useEffect(() => {
    if (eventoId || !eventos?.length) return;
    setEventoId((eventos.find((e) => e.estado === 'ACTIVO') ?? eventos[0]).id);
  }, [eventos, eventoId]);

  const { data: planes, isLoading: cargandoPlanes, isError: errorPlanes } = useQuery({
    queryKey: clavePlanes(eventoId),
    queryFn: () => getPlanesPerimetro(eventoId),
    enabled: !!eventoId,
  });

  // Al cambiar de evento se abre su primer plan.
  useEffect(() => {
    if (!planes) return;
    if (!planId || !planes.some((p) => p.id === planId)) setPlanId(planes[0]?.id ?? null);
  }, [planes, planId]);

  const evento = eventos?.find((e) => e.id === eventoId);
  const eventoEditable = !!evento && evento.estado !== 'CERRADO' && !evento.reabiertoEn;
  const puedeEditar = puede('perimetro.planes.editar') && eventoEditable;

  return (
    <div className="tema-futurista ocda pp">
      <div className="ocda-encabezado">
        <div>
          <p className="ocda-ruta">Operación / Plan de perímetro</p>
          <h2 className="ocda-titulo">Plan de perímetro</h2>
          <p className="ocda-subtitulo">
            Puestos del personal CDA/CPE, vallas y zonas sobre el mapa. Gire el mapa con dos dedos o con clic derecho y
            arrastre, e inclínelo en 3D con Ctrl y arrastre.
          </p>
        </div>
      </div>

      <div className="ocda-filtros">
        <label className="ocda-cargo pp-evento">
          Evento
          <select value={eventoId} disabled={editando} onChange={(e) => { setEventoId(e.target.value); setPlanId(null); }}>
            {(eventos ?? []).map((e) => (
              <option key={e.id} value={e.id}>
                {e.nombre}
                {e.estado === 'CERRADO' ? ' (cerrado)' : ''}
              </option>
            ))}
          </select>
        </label>
        {planes && planes.length > 0 && (
          <label className="ocda-cargo">
            Plan
            <select value={planId ?? ''} disabled={editando} onChange={(e) => setPlanId(e.target.value)}>
              {planes.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre} · {p.puestosConPersona}/{p.puestos} con persona
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {puedeEditar && !editando && <NuevoPlan eventoId={eventoId} onCreado={setPlanId} />}

      {errorEventos && <div className="banner error">No se pudieron cargar los eventos.</div>}
      {errorPlanes && <div className="banner error">No se pudieron cargar los planes de este evento.</div>}
      {cargandoPlanes && <p className="ocda-subtitulo">Cargando planes…</p>}
      {planes && planes.length === 0 && (
        <div className="banner info">Este evento todavía no tiene planes de perímetro.</div>
      )}
      {planId && (
        <DetallePlan
          key={planId}
          planId={planId}
          editable={puedeEditar}
          onEditando={setEditando}
          onEliminado={() => setPlanId(null)}
        />
      )}
    </div>
  );
}

function NuevoPlan({ eventoId, onCreado }: { eventoId: string; onCreado: (id: string) => void }) {
  const qc = useQueryClient();
  const [nombre, setNombre] = useState('');
  const crear = useMutation({
    mutationFn: () =>
      crearPlanPerimetro({
        eventoId,
        nombre: nombre.trim(),
        vista: { lat: CENTRO_DELEGACION[0], lng: CENTRO_DELEGACION[1], zoom: 17, bearing: 0, pitch: 60 },
      }),
    onSuccess: async (plan) => {
      setNombre('');
      // Primero la lista nueva: si no, se abriría el primer plan de la lista vieja.
      await qc.invalidateQueries({ queryKey: clavePlanes(eventoId) });
      onCreado(plan.id);
      sileo.success({ title: 'Plan creado' });
    },
    onError: (e) => sileo.error({ title: mensajeError(e, 'No se pudo crear el plan') }),
  });

  function enviar(e: FormEvent) {
    e.preventDefault();
    if (nombre.trim()) crear.mutate();
  }
  return (
    <form className="pp-nuevo" onSubmit={enviar}>
      <label className="ocda-campo">
        <span className="sr-only">Nombre del plan nuevo</span>
        <input
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          maxLength={LIMITES_PERIMETRO.maxNombrePlan}
          placeholder="Nombre del plan nuevo (p. ej. Coliseo Ibarra)"
          required
        />
      </label>
      <button type="submit" className="btn" disabled={crear.isPending || !nombre.trim()}>
        {crear.isPending ? 'Creando…' : 'Crear plan'}
      </button>
    </form>
  );
}
