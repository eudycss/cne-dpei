/**
 * Banco de preguntas del asistente contra el modelo REAL (Groq/Gemini), con datos de
 * prueba ficticios. Da el porcentaje de aciertos para comparar cambios de
 * instrucciones o de modelo. No corre en CI: gasta la cuota gratuita.
 *
 *   pnpm --filter @cne/api eval:asistente            # todo el banco
 *   pnpm --filter @cne/api eval:asistente -- técnico  # solo preguntas que contengan "técnico"
 *   pnpm --filter @cne/api eval:asistente -- --sql    # con el modo SQL (ASISTENTE_SQL_ENABLED)
 *
 * Usa GROQ_API_KEY / GEMINI_API_KEY de apps/api/.env.
 */
import { resolve } from 'node:path';
import { config } from 'dotenv';
import { Logger } from '@nestjs/common';
import { AsistenteService } from '../asistente.service';
import { LlmClient, proveedoresConfigurados } from '../llm.client';
import { CASOS } from './casos';
import { ASIGNACIONES_PRUEBA, CAIDAS_PRUEBA, CODIGOS_PRUEBA, ENCARGADOS_PRUEBA, ENLACES_PRUEBA } from './datos-prueba';
import { evaluarCaso } from './evaluar';

/** Groq gratis permite ~30 preguntas por minuto: se deja margen. */
const PAUSA_MS = 2_500;

async function main(): Promise<void> {
  config({ path: resolve(__dirname, '../../../../.env') });
  if (proveedoresConfigurados().length === 0) {
    console.error('Falta GROQ_API_KEY o GEMINI_API_KEY en apps/api/.env');
    process.exit(1);
  }
  Logger.overrideLogger(['error']);

  let salida: string[] = [];
  const telegram = {
    enviarTexto: async (t: string) => void salida.push(t),
    enviarHtml: async (t: string) => void salida.push(t),
    indicarEscribiendo: async () => undefined,
  };
  const prisma = {
    enlaceRecinto: {
      findMany: async () => ENLACES_PRUEBA,
      findUnique: async ({ where }: { where: { codigoRecinto: string } }) =>
        ENLACES_PRUEBA.find((e) => e.codigoRecinto === where.codigoRecinto) ?? null,
    },
    enlaceCaida: {
      findMany: async ({ where }: { where: { fin?: null } }) =>
        where.fin === null ? CAIDAS_PRUEBA.filter((c) => c.fin === null) : CAIDAS_PRUEBA,
    },
  };
  const estadisticas = { enviarEstadisticasTelegram: async (_: Date, periodo = 'dia') => void salida.push(`[estadisticas ${periodo}]`) };
  const servicio = new AsistenteService(
    prisma as never,
    telegram as never,
    { asignaciones: async () => ASIGNACIONES_PRUEBA } as never,
    { encargados: async () => ENCARGADOS_PRUEBA } as never,
    new LlmClient(),
    estadisticas as never,
  );

  const argumentos = process.argv.slice(2);
  if (argumentos.includes('--sql')) process.env.ASISTENTE_SQL_ENABLED = 'true';
  const filtro = argumentos.find((a) => !a.startsWith('--'))?.toLowerCase();
  console.log(`Modo: ${process.env.ASISTENTE_SQL_ENABLED === 'true' ? 'SQL' : 'filtros'}\n`);
  const casos = filtro ? CASOS.filter((c) => c.pregunta.toLowerCase().includes(filtro)) : CASOS;
  let aciertos = 0;
  for (const [i, caso] of casos.entries()) {
    salida = [];
    // Cada pregunta como de otra persona: el límite por persona no debe cortar el banco.
    await servicio.responder(caso.pregunta, `eval:${i}`);
    const r = evaluarCaso(salida.join('\n'), caso.esperado, CODIGOS_PRUEBA);
    if (r.ok) aciertos++;
    console.log(`${r.ok ? '✅' : '❌'} ${caso.pregunta}${r.ok ? '' : `\n     ${r.fallas.join(' · ')}`}`);
    if (i < casos.length - 1) await new Promise((ok) => setTimeout(ok, PAUSA_MS));
  }
  const pct = casos.length ? Math.round((aciertos / casos.length) * 100) : 0;
  console.log(`\nAciertos: ${aciertos}/${casos.length} (${pct} %)`);
}

void main();
