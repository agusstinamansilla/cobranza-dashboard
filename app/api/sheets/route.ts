import { google } from 'googleapis';
import { NextRequest, NextResponse } from 'next/server';

function getAuth() {
  return new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

export async function GET() {
  try {
    const auth = getAuth();
    const sheets = google.sheets({ version: 'v4', auth });
    const id = process.env.GOOGLE_SHEET_ID!;
    const [tabla, cobros, reversos, reintegros, sobrantesSheet] = await Promise.all([
      sheets.spreadsheets.values.get({ spreadsheetId: id, range: 'Tabla!A:F' }),
      sheets.spreadsheets.values.get({ spreadsheetId: id, range: 'Cobros!A:I' }),
      sheets.spreadsheets.values.get({ spreadsheetId: id, range: 'Reversos!A:B' }),
      sheets.spreadsheets.values.get({ spreadsheetId: id, range: 'Reintegros!A:B' }),
      sheets.spreadsheets.values.get({ spreadsheetId: id, range: 'Sobrantes!A:E' }).catch(() => ({ data: { values: [] } })),
    ]);
    return NextResponse.json({
      tabla: tabla.data.values || [],
      cobros: cobros.data.values || [],
      reversos: reversos.data.values || [],
      reintegros: reintegros.data.values || [],
      sobrantes: sobrantesSheet.data.values || [],
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = getAuth();
    const sheets = google.sheets({ version: 'v4', auth });
    const id = process.env.GOOGLE_SHEET_ID!;
    const body = await req.json();
    const { action, sheet, rows } = body;

    if (action === 'append') {
      await sheets.spreadsheets.values.append({
        spreadsheetId: id, range: sheet + '!A:A',
        valueInputOption: 'RAW', requestBody: { values: rows },
      });
    }

    if (action === 'clear_and_write') {
      await sheets.spreadsheets.values.clear({ spreadsheetId: id, range: sheet + '!A1:Z' });
      if (rows.length > 0) {
        await sheets.spreadsheets.values.update({
          spreadsheetId: id, range: sheet + '!A1',
          valueInputOption: 'RAW', requestBody: { values: rows },
        });
      }
    }

    if (action === 'format_tabla') {
      const meta = await sheets.spreadsheets.get({ spreadsheetId: id });
      const tablaSheet = meta.data.sheets?.find(s => s.properties?.title === 'Tabla');
      if (!tablaSheet) throw new Error('Hoja Tabla no encontrada');
      const sheetId = tablaSheet.properties!.sheetId!;

      // Leer con FORMULA para obtener valores reales
      const tablaData = await sheets.spreadsheets.values.get({
        spreadsheetId: id,
        range: 'Tabla!A:F',
        valueRenderOption: 'UNFORMATTED_VALUE',
      });
      const allRows = tablaData.data.values || [];
      const headerRowIndex = allRows.findIndex(r => r && r[0] && String(r[0]).trim().toLowerCase() === 'fecha');
      if (headerRowIndex < 0) throw new Error('No se encontró el encabezado "Fecha"');

      const firstDataRow = headerRowIndex + 1;
      // Detectar última fila de datos reales — excluir basura como % Cobro, Fecha, Pendiente, Vto
      const lastDataRow = (() => {
        let last = firstDataRow;
        for (let i = firstDataRow; i < allRows.length; i++) {
          const val = allRows[i]?.[0];
          if (!val) continue;
          const s = String(val);
          const isDateISO  = /^\d{4}-\d{2}-\d{2}/.test(s);
          const isDateSlash = /^\d{2}\/\d{2}\/\d{4}$/.test(s);
          const isDateNum  = typeof val === 'number' && val > 40000;
          if (isDateISO || isDateSlash || isDateNum) last = i + 1;
        }
        return last;
      })();

      // Parsear número con posible coma decimal (ej: "4467821,47")
      const parseNum = (v: any) => {
        if (typeof v === 'number') return v;
        if (!v) return 0;
        return parseFloat(String(v).replace(/\./g, '').replace(',', '.')) || 0;
      };

      // Calcular totales con valores numéricos reales
      const VTO = 232751387;
      let totalCobro = 0, totalNeto = 0, totalRev = 0, totalRei = 0, totalSob = 0;
      for (let i = firstDataRow; i < lastDataRow; i++) {
        const r = allRows[i];
        if (!r) continue;
        totalCobro += parseNum(r[1]);
        totalSob   += parseNum(r[2]);
        totalRev   += parseNum(r[3]);
        totalRei   += parseNum(r[4]);
        totalNeto  += parseNum(r[5]);
      }
      const cobroBruto = totalCobro + totalSob; // Cobro + Sobrante
      const pctCobrado = VTO > 0 ? Math.round((totalNeto / VTO) * 100) : 0;
      const pctRevRei  = totalCobro > 0 ? Math.round(((totalRev + totalRei) / totalCobro) * 100) : 0;
      const pendiente  = VTO - totalNeto;

      const requests: any[] = [];

      // Limpiar formato previo
      // Borrar filas basura SIEMPRE entre header y primera fila de datos (fila 2 con % Cobro)
      await sheets.spreadsheets.values.clear({ spreadsheetId: id, range: `Tabla!A2:F2` });
      if (headerRowIndex > 1) {
        await sheets.spreadsheets.values.clear({ spreadsheetId: id, range: `Tabla!A2:F${headerRowIndex}` });
      }
      // Borrar filas basura después de los datos reales
      await sheets.spreadsheets.values.clear({ spreadsheetId: id, range: `Tabla!A${lastDataRow + 1}:F${lastDataRow + 10}` });
      requests.push({
        repeatCell: {
          range: { sheetId, startRowIndex: 0, endRowIndex: lastDataRow + 20, startColumnIndex: 0, endColumnIndex: 12 },
          cell: { userEnteredFormat: { backgroundColor: { red: 1, green: 1, blue: 1 }, textFormat: { bold: false, fontSize: 10, foregroundColor: { red: 0.2, green: 0.2, blue: 0.2 } }, horizontalAlignment: 'LEFT' } },
          fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,numberFormat)',
        }
      });

      // Deshacer merges previos en cols H-I
      requests.push({ unmergeCells: { range: { sheetId, startRowIndex: 0, endRowIndex: lastDataRow + 20, startColumnIndex: 7, endColumnIndex: 9 } } });
      // Limpiar TODO el formato en cols H-I antes de redibujar
      requests.push({
        repeatCell: {
          range: { sheetId, startRowIndex: 0, endRowIndex: lastDataRow + 20, startColumnIndex: 7, endColumnIndex: 9 },
          cell: { userEnteredFormat: { backgroundColor: { red: 1, green: 1, blue: 1 }, textFormat: { bold: false, fontSize: 10, foregroundColor: { red: 0.2, green: 0.2, blue: 0.2 } } } },
          fields: 'userEnteredFormat(backgroundColor,textFormat)',
        }
      });

      // ── Tabla principal ──
      // Header
      requests.push({
        repeatCell: {
          range: { sheetId, startRowIndex: headerRowIndex, endRowIndex: headerRowIndex + 1, startColumnIndex: 0, endColumnIndex: 6 },
          cell: { userEnteredFormat: { backgroundColor: { red: 0.11, green: 0.11, blue: 0.11 }, textFormat: { bold: true, fontSize: 11, foregroundColor: { red: 1, green: 1, blue: 1 } }, horizontalAlignment: 'CENTER' } },
          fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)',
        }
      });

      // Filas alternas
      for (let i = firstDataRow; i < lastDataRow; i++) {
        const isEven = (i - firstDataRow) % 2 === 0;
        requests.push({
          repeatCell: {
            range: { sheetId, startRowIndex: i, endRowIndex: i + 1, startColumnIndex: 0, endColumnIndex: 6 },
            cell: { userEnteredFormat: { backgroundColor: isEven ? { red: 0.97, green: 0.97, blue: 0.97 } : { red: 1, green: 1, blue: 1 }, textFormat: { bold: false, fontSize: 10 } } },
            fields: 'userEnteredFormat(backgroundColor,textFormat)',
          }
        });
      }

      // Fecha dd/mm/yyyy
      requests.push({ repeatCell: { range: { sheetId, startRowIndex: firstDataRow, endRowIndex: lastDataRow, startColumnIndex: 0, endColumnIndex: 1 }, cell: { userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'dd/mm/yyyy' }, horizontalAlignment: 'LEFT' } }, fields: 'userEnteredFormat(numberFormat,horizontalAlignment)' } });

      // Números sin decimales B-F
      requests.push({ repeatCell: { range: { sheetId, startRowIndex: firstDataRow, endRowIndex: lastDataRow, startColumnIndex: 1, endColumnIndex: 6 }, cell: { userEnteredFormat: { numberFormat: { type: 'NUMBER', pattern: '$ #,##0' }, horizontalAlignment: 'RIGHT' } }, fields: 'userEnteredFormat(numberFormat,horizontalAlignment)' } });

      // Colores columnas
      requests.push({ repeatCell: { range: { sheetId, startRowIndex: firstDataRow, endRowIndex: lastDataRow, startColumnIndex: 2, endColumnIndex: 3 }, cell: { userEnteredFormat: { textFormat: { foregroundColor: { red: 0.75, green: 0.45, blue: 0.0 } } } }, fields: 'userEnteredFormat(textFormat)' } });
      requests.push({ repeatCell: { range: { sheetId, startRowIndex: firstDataRow, endRowIndex: lastDataRow, startColumnIndex: 3, endColumnIndex: 4 }, cell: { userEnteredFormat: { textFormat: { foregroundColor: { red: 0.8, green: 0.1, blue: 0.1 } } } }, fields: 'userEnteredFormat(textFormat)' } });
      requests.push({ repeatCell: { range: { sheetId, startRowIndex: firstDataRow, endRowIndex: lastDataRow, startColumnIndex: 5, endColumnIndex: 6 }, cell: { userEnteredFormat: { textFormat: { bold: false, foregroundColor: { red: 0.1, green: 0.45, blue: 0.1 } } } }, fields: 'userEnteredFormat(textFormat)' } });

      // Bordes tabla
      if (lastDataRow > firstDataRow) {
        requests.push({ updateBorders: { range: { sheetId, startRowIndex: headerRowIndex, endRowIndex: lastDataRow, startColumnIndex: 0, endColumnIndex: 6 }, top: { style: 'SOLID_MEDIUM', color: { red: 0.6, green: 0.6, blue: 0.6 } }, bottom: { style: 'SOLID_MEDIUM', color: { red: 0.6, green: 0.6, blue: 0.6 } }, left: { style: 'SOLID_MEDIUM', color: { red: 0.6, green: 0.6, blue: 0.6 } }, right: { style: 'SOLID_MEDIUM', color: { red: 0.6, green: 0.6, blue: 0.6 } }, innerHorizontal: { style: 'SOLID', color: { red: 0.85, green: 0.85, blue: 0.85 } }, innerVertical: { style: 'SOLID', color: { red: 0.85, green: 0.85, blue: 0.85 } } } });
      }

      // Ancho columnas A-F
      [110, 140, 130, 130, 130, 140].forEach((px, i) => {
        requests.push({ updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 }, properties: { pixelSize: px }, fields: 'pixelSize' } });
      });

      // Freeze header
      requests.push({ updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: headerRowIndex + 1 } }, fields: 'gridProperties.frozenRowCount' } });

      // ══════════════════════════════════
      // BLOQUE 1: TOTALES — empieza una fila debajo del header (fila 2 si header es fila 1)
      const colH = 7; // columna H
      const b1Start = headerRowIndex + 1;

      // Merge H-I para el título
      requests.push({ mergeCells: { range: { sheetId, startRowIndex: b1Start, endRowIndex: b1Start + 1, startColumnIndex: colH, endColumnIndex: colH + 2 }, mergeType: 'MERGE_ALL' } });
      requests.push({
        repeatCell: {
          range: { sheetId, startRowIndex: b1Start, endRowIndex: b1Start + 1, startColumnIndex: colH, endColumnIndex: colH + 2 },
          cell: { userEnteredFormat: { backgroundColor: { red: 0.13, green: 0.27, blue: 0.53 }, textFormat: { bold: true, fontSize: 12, foregroundColor: { red: 1, green: 1, blue: 1 } }, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE' } },
          fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
        }
      });

      const totalesRows = [
        { label: 'Vencimiento', value: VTO,        color: { red: 0.2,  green: 0.2,  blue: 0.5  }, bg: { red: 0.93, green: 0.95, blue: 1.0  } },
        { label: 'Cobro bruto', value: cobroBruto,  color: { red: 0.1,  green: 0.35, blue: 0.65 }, bg: { red: 1.0,  green: 1.0,  blue: 1.0  } },
        { label: 'Reversos',    value: totalRev,    color: { red: 0.75, green: 0.1,  blue: 0.1  }, bg: { red: 0.93, green: 0.95, blue: 1.0  } },
        { label: 'Reintegros',  value: totalRei,    color: { red: 0.2,  green: 0.2,  blue: 0.2  }, bg: { red: 1.0,  green: 1.0,  blue: 1.0  } },
        { label: 'Neto total',  value: totalNeto,   color: { red: 0.1,  green: 0.45, blue: 0.1  }, bg: { red: 0.93, green: 0.98, blue: 0.93 } },
        { label: 'Pendiente',   value: pendiente,   color: { red: 0.75, green: 0.1,  blue: 0.1  }, bg: { red: 1.0,  green: 0.95, blue: 0.95 } },
      ];

      totalesRows.forEach((item, idx) => {
        const r = b1Start + 1 + idx;
        requests.push({ repeatCell: { range: { sheetId, startRowIndex: r, endRowIndex: r+1, startColumnIndex: colH, endColumnIndex: colH+1 }, cell: { userEnteredFormat: { backgroundColor: item.bg, textFormat: { bold: true, fontSize: 10, foregroundColor: { red: 0.25, green: 0.25, blue: 0.25 } }, horizontalAlignment: 'LEFT' } }, fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)' } });
        requests.push({ repeatCell: { range: { sheetId, startRowIndex: r, endRowIndex: r+1, startColumnIndex: colH+1, endColumnIndex: colH+2 }, cell: { userEnteredFormat: { backgroundColor: item.bg, textFormat: { bold: true, fontSize: 11, foregroundColor: item.color }, horizontalAlignment: 'RIGHT', numberFormat: { type: 'NUMBER', pattern: '$ #,##0' } } }, fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,numberFormat)' } });
      });

      requests.push({ updateBorders: { range: { sheetId, startRowIndex: b1Start, endRowIndex: b1Start + 7, startColumnIndex: colH, endColumnIndex: colH + 2 }, top: { style: 'SOLID_MEDIUM', color: { red: 0.3, green: 0.4, blue: 0.6 } }, bottom: { style: 'SOLID_MEDIUM', color: { red: 0.3, green: 0.4, blue: 0.6 } }, left: { style: 'SOLID_MEDIUM', color: { red: 0.3, green: 0.4, blue: 0.6 } }, right: { style: 'SOLID_MEDIUM', color: { red: 0.3, green: 0.4, blue: 0.6 } }, innerHorizontal: { style: 'SOLID', color: { red: 0.75, green: 0.8, blue: 0.9 } }, innerVertical: { style: 'SOLID', color: { red: 0.75, green: 0.8, blue: 0.9 } } } });

      // ══════════════════════════════════
      // BLOQUE 2: INDICADORES — sin separación, justo debajo del bloque 1
      const b2Start = b1Start + 7; // header(1) + 6 filas datos = 7

      // Merge H-I para el título
      requests.push({ mergeCells: { range: { sheetId, startRowIndex: b2Start, endRowIndex: b2Start + 1, startColumnIndex: colH, endColumnIndex: colH + 2 }, mergeType: 'MERGE_ALL' } });
      requests.push({
        repeatCell: {
          range: { sheetId, startRowIndex: b2Start, endRowIndex: b2Start + 1, startColumnIndex: colH, endColumnIndex: colH + 2 },
          cell: { userEnteredFormat: { backgroundColor: { red: 0.18, green: 0.38, blue: 0.22 }, textFormat: { bold: true, fontSize: 12, foregroundColor: { red: 1, green: 1, blue: 1 } }, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE' } },
          fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
        }
      });

      const indicadoresRows = [
        { label: '% Cobrado',         value: pctCobrado + '%', color: { red: 0.1,  green: 0.45, blue: 0.1 }, bg: { red: 0.93, green: 0.98, blue: 0.93 } },
        { label: '% Rev+Rei / Cobro Bruto', value: pctRevRei + '%',  color: { red: 0.65, green: 0.35, blue: 0.0 }, bg: { red: 1.0,  green: 0.97, blue: 0.9  } },
      ];

      indicadoresRows.forEach((item, idx) => {
        const r = b2Start + 1 + idx;
        requests.push({ repeatCell: { range: { sheetId, startRowIndex: r, endRowIndex: r+1, startColumnIndex: colH, endColumnIndex: colH+1 }, cell: { userEnteredFormat: { backgroundColor: item.bg, textFormat: { bold: true, fontSize: 10, foregroundColor: { red: 0.25, green: 0.25, blue: 0.25 } }, horizontalAlignment: 'LEFT' } }, fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)' } });
        requests.push({ repeatCell: { range: { sheetId, startRowIndex: r, endRowIndex: r+1, startColumnIndex: colH+1, endColumnIndex: colH+2 }, cell: { userEnteredFormat: { backgroundColor: item.bg, textFormat: { bold: true, fontSize: 16, foregroundColor: item.color }, horizontalAlignment: 'RIGHT', numberFormat: { type: 'TEXT' } } }, fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,numberFormat)' } });
      });

      requests.push({ updateBorders: { range: { sheetId, startRowIndex: b2Start, endRowIndex: b2Start + 3, startColumnIndex: colH, endColumnIndex: colH + 2 }, top: { style: 'SOLID_MEDIUM', color: { red: 0.2, green: 0.45, blue: 0.25 } }, bottom: { style: 'SOLID_MEDIUM', color: { red: 0.2, green: 0.45, blue: 0.25 } }, left: { style: 'SOLID_MEDIUM', color: { red: 0.2, green: 0.45, blue: 0.25 } }, right: { style: 'SOLID_MEDIUM', color: { red: 0.2, green: 0.45, blue: 0.25 } }, innerHorizontal: { style: 'SOLID', color: { red: 0.7, green: 0.85, blue: 0.75 } }, innerVertical: { style: 'SOLID', color: { red: 0.7, green: 0.85, blue: 0.75 } } } });

      // Limpiar celdas con formato que puedan quedar debajo de los bloques
      requests.push({
        repeatCell: {
          range: { sheetId, startRowIndex: b2Start + 3, endRowIndex: b2Start + 8, startColumnIndex: colH, endColumnIndex: colH + 2 },
          cell: { userEnteredFormat: { backgroundColor: { red: 1, green: 1, blue: 1 }, textFormat: { bold: false } } },
          fields: 'userEnteredFormat(backgroundColor,textFormat)',
        }
      });
      requests.push({ unmergeCells: { range: { sheetId, startRowIndex: b2Start + 3, endRowIndex: b2Start + 8, startColumnIndex: colH, endColumnIndex: colH + 2 } } });
      requests.push({
        updateBorders: {
          range: { sheetId, startRowIndex: b2Start + 3, endRowIndex: b2Start + 8, startColumnIndex: colH, endColumnIndex: colH + 2 },
          top: { style: 'NONE' }, bottom: { style: 'NONE' }, left: { style: 'NONE' }, right: { style: 'NONE' },
          innerHorizontal: { style: 'NONE' }, innerVertical: { style: 'NONE' },
        }
      });

      // Ancho cols H e I
      requests.push({ updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: colH, endIndex: colH + 1 }, properties: { pixelSize: 150 }, fields: 'pixelSize' } });
      requests.push({ updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: colH + 1, endIndex: colH + 2 }, properties: { pixelSize: 150 }, fields: 'pixelSize' } });

      await sheets.spreadsheets.batchUpdate({ spreadsheetId: id, requestBody: { requests } });

      // Escribir valores numéricos reales (no texto) para que el formato de moneda funcione
      await sheets.spreadsheets.values.update({
        spreadsheetId: id,
        range: `Tabla!H${b1Start + 1}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [
            ['Totales del mes'],
            ['Vencimiento', VTO],
            ['Cobro bruto', cobroBruto],
            ['Reversos', totalRev],
            ['Reintegros', totalRei],
            ['Neto total', totalNeto],
            ['Pendiente', pendiente],
          ]
        }
      });

      await sheets.spreadsheets.values.update({
        spreadsheetId: id,
        range: `Tabla!H${b2Start + 1}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [
            ['Indicadores'],
            ['% Cobrado', pctCobrado + '%'],
            ['% Rev+Rei / Cobro Bruto', pctRevRei + '%'],
          ]
        }
      });

      // ── Formato fechas en hoja Cobros ──
      const cobrosSheet = meta.data.sheets?.find(s => s.properties?.title === 'Cobros');
      if (cobrosSheet) {
        const cobrosSheetId = cobrosSheet.properties!.sheetId!;
        const cobrosData = await sheets.spreadsheets.values.get({ spreadsheetId: id, range: 'Cobros!A:A' });
        const cobrosLastRow = (cobrosData.data.values || []).length;
        if (cobrosLastRow > 1) {
          await sheets.spreadsheets.batchUpdate({
            spreadsheetId: id,
            requestBody: {
              requests: [{
                repeatCell: {
                  range: { sheetId: cobrosSheetId, startRowIndex: 1, endRowIndex: cobrosLastRow, startColumnIndex: 0, endColumnIndex: 1 },
                  cell: { userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'dd/mm/yyyy' } } },
                  fields: 'userEnteredFormat(numberFormat)',
                }
              }]
            }
          });
        }
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
