import { useId, useState, type Dispatch } from 'react';
import { useMutation } from '@tanstack/react-query';
import { pedirPropuestaPersonal } from '../../lib/queries/perimetro';
import { mensajeError } from '../operadores-cda/utils';
import { puestosVacantes, type AccionEditor, type EstadoEditor } from './editorPlan';
import { FiltrosPersonalCampos, type FiltrosPersonal } from './SelectorPersona';

/**
 * Llena los puestos vacíos con personal activo respetando el % de mujeres. El
 * servidor elige y ordena (el sexo no sale de allí); el resultado entra al
 * borrador, se revisa y se guarda como cualquier cambio (Ctrl+Z lo deshace).
 */
export function CompletarPersonal({ planId, estado, despachar }: { planId: string; estado: EstadoEditor; despachar: Dispatch<AccionEditor> }) {
  const id = useId();
  const { plan } = estado;
  const [filtros, setFiltros] = useState<FiltrosPersonal>({});
  const [aviso, setAviso] = useState('');
  // Texto propio: vaciar el campo para escribir otro número no debe poner 0 %.
  const [pct, setPct] = useState(String(plan.ajustes.pctMujeres));
  const vacantes = puestosVacantes(plan);

  const pedir = useMutation({
    mutationFn: () =>
      pedirPropuestaPersonal(planId, {
        total: vacantes,
        pctMujeres: plan.ajustes.pctMujeres,
        ...filtros,
        excluir: plan.puestos.flatMap((p) => (p.persona ? [p.persona.id] : [])),
      }),
    onSuccess: (r) => {
      despachar({ tipo: 'completarPersonal', personas: r.personas.map((p) => ({ id: p.id, nombre: p.nombre, tieneFoto: false })) });
      const otros = r.personas.filter((p) => p.enOtroPlan).length;
      setAviso(
        [
          `${r.personas.length} asignadas.`,
          r.faltan ? `Faltan ${r.faltan}: no hay más personal con esos filtros.` : '',
          otros ? `${otros} ya están en otro plan de este evento.` : '',
          'Revise y pulse Guardar.',
        ]
          .filter(Boolean)
          .join(' '),
      );
    },
    onError: (e) => setAviso(mensajeError(e, 'No se pudo pedir el personal. Intente de nuevo.')),
  });

  return (
    <section className="pp-completar" aria-labelledby={`${id}-titulo`}>
      <h4 id={`${id}-titulo`}>Asignar personal automáticamente</h4>
      <div className="pp-fila-campos">
        <label className="ocda-cargo" htmlFor={`${id}-pct`}>
          % de mujeres
          <input
            id={`${id}-pct`}
            type="number"
            min={0}
            max={100}
            value={pct}
            onChange={(e) => {
              setPct(e.target.value);
              const v = Number(e.target.value);
              if (e.target.value.trim() !== '' && Number.isInteger(v) && v >= 0 && v <= 100 && v !== plan.ajustes.pctMujeres) {
                despachar({ tipo: 'ajustes', ajustes: { pctMujeres: v } });
              }
            }}
          />
        </label>
      </div>
      <FiltrosPersonalCampos valor={filtros} onCambio={setFiltros} idBase={id} />
      <button type="button" className="btn ocda-btn-chico" disabled={vacantes === 0 || pedir.isPending || !!estado.dibujo} onClick={() => pedir.mutate()}>
        {pedir.isPending ? 'Buscando personal…' : `Completar ${vacantes} ${vacantes === 1 ? 'puesto vacío' : 'puestos vacíos'}`}
      </button>
      <p className="pp-ayuda" role="status">
        {aviso || 'Se reparten las mujeres a lo largo del perímetro. Los puestos con nombre libre (p. ej. Policía) no se llenan.'}
      </p>
    </section>
  );
}
