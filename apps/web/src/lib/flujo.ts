import { CalendarDays, ClipboardList, Package, School, ShieldCheck, Users, type LucideIcon } from 'lucide-react';
import type { ModuloWebId } from '@cne/shared-validation';

export type PasoId = 'recintos' | 'usuarios' | 'militares' | 'evento' | 'asignaciones' | 'kits';

export interface PasoFlujo {
  id: PasoId;
  ruta: string;
  etiqueta: string;
  icono: LucideIcon;
  /** Módulo de la web que el administrador muestra u oculta por rol. */
  modulo: ModuloWebId;
  /** Pasos que deben estar listos antes (solo se avisa, no se bloquea). */
  requisitos: readonly PasoId[];
}

/**
 * Preparación de un evento, en el orden que impone el modelo de datos:
 * un militar necesita su recinto, una asignación necesita operadores y el
 * evento activo, y un kit necesita recinto y evento activo.
 */
export const PASOS_PREPARACION: readonly PasoFlujo[] = [
  { id: 'recintos', ruta: '/recintos', etiqueta: 'Recintos Electorales', icono: School, modulo: 'recintos', requisitos: [] },
  { id: 'usuarios', ruta: '/users', etiqueta: 'Usuarios', icono: Users, modulo: 'usuarios', requisitos: [] },
  {
    id: 'militares',
    ruta: '/militares',
    etiqueta: 'Militares',
    icono: ShieldCheck,
    modulo: 'militares',
    requisitos: ['recintos'],
  },
  { id: 'evento', ruta: '/eventos', etiqueta: 'Eventos Electorales', icono: CalendarDays, modulo: 'eventos', requisitos: [] },
  {
    id: 'asignaciones',
    ruta: '/asignaciones',
    etiqueta: 'Asignaciones',
    icono: ClipboardList,
    modulo: 'asignaciones',
    requisitos: ['usuarios', 'evento'],
  },
  {
    id: 'kits',
    ruta: '/kits',
    etiqueta: 'Kits Electorales',
    icono: Package,
    modulo: 'kits',
    requisitos: ['recintos', 'evento'],
  },
];
