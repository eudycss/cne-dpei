import { BadRequestException } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { parse as csvParse } from 'csv-parse/sync';

export async function parseUploadRows(
  file: Express.Multer.File,
): Promise<Array<Record<string, string>>> {
  const filename = (file.originalname ?? '').toLowerCase();
  const isExcel = filename.endsWith('.xlsx') || filename.endsWith('.xls');
  const isCsv = filename.endsWith('.csv') || file.mimetype === 'text/csv';

  if (isExcel) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(file.buffer as any);
    const ws = wb.worksheets[0];
    if (!ws) return [];
    const headers: string[] = [];
    ws.getRow(1).eachCell((cell, col) => {
      headers[col - 1] = String(cell.value ?? '').trim().toLowerCase();
    });
    const result: Array<Record<string, string>> = [];
    ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
      if (rowNum === 1) return;
      const obj: Record<string, string> = {};
      headers.forEach((h, i) => {
        if (!h) return;
        const v = row.getCell(i + 1).value;
        obj[h] = v == null ? '' : String(v).trim();
      });
      result.push(obj);
    });
    return result;
  }
  if (isCsv) {
    return csvParse(file.buffer.toString('utf8'), {
      columns: (h: string[]) => h.map((c) => c.trim().toLowerCase()),
      skip_empty_lines: true,
      trim: true,
    }) as Array<Record<string, string>>;
  }
  throw new BadRequestException('Formato no soportado: usa .xlsx o .csv');
}
