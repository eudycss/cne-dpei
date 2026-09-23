import { Injectable } from '@nestjs/common';
import { google } from 'googleapis';

export interface SheetEnlaceRow {
  codigoRecinto: string;
  nombreRecinto: string;
  estado: 'ACTIVO' | 'FALLO';
}

@Injectable()
export class SheetsEnlacesClient {
  async leerEnlacesImbabura(): Promise<SheetEnlaceRow[]> {
    const credentials = JSON.parse(process.env.GOOGLE_SHEETS_CREDENTIALS_JSON ?? '{}');
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
    const sheets = google.sheets({ version: 'v4', auth: auth as any });
    const spreadsheetId = process.env.GOOGLE_SHEETS_ID!;
    const tab = process.env.GOOGLE_SHEETS_TAB_INF ?? 'INF';

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${tab}!A:AF`,
    });
    const rows = (res.data.values ?? []) as string[][];
    if (rows.length < 2) return [];

    const header = rows[0].map((h) => String(h ?? '').trim().toUpperCase());
    const idxProvincia = header.indexOf('PROVINCIA');
    const idxCodigo = header.indexOf('CODIGO DE RECINTO');
    const idxLocalidad = header.indexOf('LOCALIDAD');
    const idxEstado = header.indexOf('FALLO');

    const columnasFaltantes = [
      ['PROVINCIA', idxProvincia],
      ['CODIGO DE RECINTO', idxCodigo],
      ['LOCALIDAD', idxLocalidad],
      ['FALLO', idxEstado],
    ]
      .filter(([, idx]) => idx === -1)
      .map(([nombre]) => nombre);
    if (columnasFaltantes.length > 0) {
      throw new Error(
        `La pestaña "${tab}" no tiene la(s) columna(s) esperada(s): ${columnasFaltantes.join(', ')}`,
      );
    }

    const out: SheetEnlaceRow[] = [];
    for (const row of rows.slice(1)) {
      const provincia = (row[idxProvincia] ?? '').toString().trim().toUpperCase();
      if (provincia !== 'IMBABURA') continue;

      const codigoRecinto = (row[idxCodigo] ?? '').toString().trim();
      if (!codigoRecinto) continue;

      const estadoTexto = (row[idxEstado] ?? '').toString().trim().toUpperCase();
      out.push({
        codigoRecinto,
        nombreRecinto: (row[idxLocalidad] ?? '').toString().trim(),
        estado: estadoTexto === 'ACTIVO' ? 'ACTIVO' : 'FALLO',
      });
    }
    return out;
  }
}
