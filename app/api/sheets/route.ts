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
    const [tabla, cobros, reversos, reintegros] = await Promise.all([
      sheets.spreadsheets.values.get({ spreadsheetId: id, range: 'Tabla!A:F' }),
      sheets.spreadsheets.values.get({ spreadsheetId: id, range: 'Cobros!A:I' }),
      sheets.spreadsheets.values.get({ spreadsheetId: id, range: 'Reversos!A:B' }),
      sheets.spreadsheets.values.get({ spreadsheetId: id, range: 'Reintegros!A:B' }),
    ]);
    return NextResponse.json({
      tabla: tabla.data.values || [],
      cobros: cobros.data.values || [],
      reversos: reversos.data.values || [],
      reintegros: reintegros.data.values || [],
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
      await sheets.spreadsheets.values.clear({ spreadsheetId: id, range: sheet + '!A2:Z' });
      if (rows.length > 0) {
        await sheets.spreadsheets.values.update({
          spreadsheetId: id, range: sheet + '!A2',
          valueInputOption: 'RAW', requestBody: { values: rows },
        });
      }
    }

    if (action === 'format_tabla') {
      const meta = await sheets.spreadsheets.get({ spreadsheetId: id });
      const tablaSheet = meta.data.sheets?.find(s => s.properties?.title === 'Tabla');
      if (!tablaSheet) throw new Error('Hoja Tabla no encontrada');
      const sheetId = tablaSheet.properties!.sheetId!;

      const tablaData = await sheets.spreadsheets.values.get({ spreadsheetId: id, range: 'Tabla!A:F' });
      const allRows = tablaData.data.values || [];
      const headerRowIndex = allRows.findIndex(r => r && r[0] && String(r[0]).trim().toLowerCase() === 'fecha');
      if (headerRowIndex < 0) throw new Error('No se encontró el encabezado "Fecha" en la hoja Tabla');

      const firstDataRow = headerRowIndex + 1;
      const lastDataRow = allRows.length;

      const VTO = 232751387;
      let totalCobro = 0, totalNeto = 0, totalRev = 0, totalRei = 0;
      for (let i = firstDataRow; i < lastDataRow; i++) {
        totalCobro += parseFloat(allRows[i]?.[1] || '0') || 0;
        totalRev   += parseFloat(allRows[i]?.[3] || '0') || 0;
        totalRei   += parseFloat(allRows[i]?.[4] || '0') || 0;
        totalNeto  += parseFloat(allRows[i]?.[5] || '0') || 0;
      }
      const pctCobrado = totalCobro > 0 ? Math.round((totalNeto / VTO) * 100) : 0;
      const pctRevRei  = totalCobro > 0 ? Math.round(((totalRev + totalRei) / totalCobro) * 100) : 0;
      const pendiente  = VTO - totalNeto;

      const requests: any[] = [];

      // Limpiar formato previo
      requests.push({
        repeatCell: {
          range: { sheetId, startRowIndex: 0, endRowIndex: lastDataRow + 15, startColumnIndex: 0, endColumnIndex: 12 },
          cell: { userEnteredFormat: { backgroundColor: { red: 1, green: 1, blue: 1 }, textFormat: { bold: false, fontSize: 10, foregroundColor: { red: 0.2, green: 0.2, blue: 0.2 } }, horizontalAlignment: 'LEFT' } },
          fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,numberFormat)',
        }
      });

      // Header tabla principal
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
      requests.push({ updateBorders: { range: { sheetId, startRowIndex: headerRowIndex, endRowIndex: lastDataRow, startColumnIndex: 0, endColumnIndex: 6 }, top: { style: 'SOLID_MEDIUM', color: { red: 0.6, green: 0.6, blue: 0.6 } }, bottom: { style: 'SOLID_MEDIUM', color: { red: 0.6, green: 0.6, blue: 0.6 } }, left: { style: 'SOLID_MEDIUM', color: { red: 0.6, green: 0.6, blue: 0.6 } }, right: { style: 'SOLID_MEDIUM', color: { red: 0.6, green: 0.6, blue: 0.6 } }, innerHorizontal: { style: 'SOLID', color: { red: 0.85, green: 0.85, blue: 0.85 } }, innerVertical: { style: 'SOLID', color: { red: 0.85, green: 0.85, blue: 0.85 } } } });

      // Ancho columnas A-F
      [110, 140, 130, 130, 130, 140].forEach((px, i) => {
        requests.push({ updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 }, properties: { pixelSize: px }, fields: 'pixelSize' } });
      });

      // Freeze header
      requests.push({ updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: headerRowIndex + 1 } }, fields: 'gridProperties.frozenRowCount' } });

      // ── BLOQUE 1: TOTALES (col H-I) ──
      const colH = 7;
      const b1Start = headerRowIndex;

      requests.push({ repeatCell: { range: { sheetId, startRowIndex: b1Start, endRowIndex: b1Start + 1, startColumnIndex: colH, endColumnIndex: colH + 2 }, cell: { userEnteredFormat: { backgroundColor: { red: 0.13, green: 0.27, blue: 0.53 }, textFormat: { bold: true, fontSize: 11, foregroundColor: { red: 1, green: 1, blue: 1 } }, horizontalAlignment: 'CENTER' } }, fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)' } });

      const totalesRows = [
        { label: 'Vencimiento', value: VTO,       color: { red: 0.2,  green: 0.2,  blue: 0.5  }, bg: { red: 0.93, green: 0.95, blue: 1.0  } },
        { label: 'Cobro bruto', value: totalCobro, color: { red: 0.1,  green: 0.35, blue: 0.65 }, bg: { red: 1.0,  green: 1.0,  blue: 1.0  } },
        { label: 'Reversos',    value: totalRev,   color: { red: 0.75, green: 0.1,  blue: 0.1  }, bg: { red: 0.93, green: 0.95, blue: 1.0  } },
        { label: 'Reintegros',  value: totalRei,   color: { red: 0.2,  green: 0.2,  blue: 0.2  }, bg: { red: 1.0,  green: 1.0,  blue: 1.0  } },
        { label: 'Neto total',  value: totalNeto,  color: { red: 0.1,  green: 0.45, blue: 0.1  }, bg: { red: 0.93, green: 0.98, blue: 0.93 } },
        { label: 'Pendiente',   value: pendiente,  color: { red: 0.75, green: 0.1,  blue: 0.1  }, bg: { red: 1.0,  green: 0.95, blue: 0.95 } },
      ];

      totalesRows.forEach((item, idx) => {
        const r = b1Start + 1 + idx;
        requests.push({ repeatCell: { range: { sheetId, startRowIndex: r, endRowIndex: r+1, startColumnIndex: colH, endColumnIndex: colH+1 }, cell: { userEnteredFormat: { backgroundColor: item.bg, textFormat: { bold: true, fontSize: 10, foregroundColor: { red: 0.25, green: 0.25, blue: 0.25 } }, horizontalAlignment: 'LEFT' } }, fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)' } });
        requests.push({ repeatCell: { range: { sheetId, startRowIndex: r, endRowIndex: r+1, startColumnIndex: colH+1, endColumnIndex: colH+2 }, cell: { userEnteredFormat: { backgroundColor: item.bg, textFormat: { bold: true, fontSize: 11, foregroundColor: item.color }, horizontalAlignment: 'RIGHT', numberFormat: { type: 'NUMBER', pattern: '$ #,##0' } } }, fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,numberFormat)' } });
      });

      requests.push({ updateBorders: { range: { sheetId, startRowIndex: b1Start, endRowIndex: b1Start + 7, startColumnIndex: colH, endColumnIndex: colH + 2 }, top: { style: 'SOLID_MEDIUM', color: { red: 0.3, green: 0.4, blue: 0.6 } }, bottom: { style: 'SOLID_MEDIUM', color: { red: 0.3, green: 0.4, blue: 0.6 } }, left: { style: 'SOLID_MEDIUM', color: { red: 0.3, green: 0.4, blue: 0.6 } }, right: { style: 'SOLID_MEDIUM', color: { red: 0.3, green: 0.4, blue: 0.6 } }, innerHorizontal: { style: 'SOLID', color: { red: 0.75, green: 0.8, blue: 0.9 } }, innerVertical: { style: 'SOLID', color: { red: 0.75, green: 0.8, blue: 0.9 } } } });

      // ── BLOQUE 2: INDICADORES ──
      const b2Start = b1Start + 8;

      requests.push({ repeatCell: { range: { sheetId, startRowIndex: b2Start, endRowIndex: b2Start + 1, startColumnIndex: colH, endColumnIndex: colH + 2 }, cell: { userEnteredFormat: { backgroundColor: { red: 0.18, green: 0.38, blue: 0.22 }, textFormat: { bold: true, fontSize: 11, foregroundColor: { red: 1, green: 1, blue: 1 } }, horizontalAlignment: 'CENTER' } }, fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)' } });

      const indicadoresRows = [
        { label: '% Cobrado',         value: pctCobrado + '%', color: { red: 0.1,  green: 0.45, blue: 0.1  }, bg: { red: 0.93, green: 0.98, blue: 0.93 } },
        { label: '% Rev+Rei / Cobro', value: pctRevRei + '%',  color: { red: 0.65, green: 0.35, blue: 0.0  }, bg: { red: 1.0,  green: 0.97, blue: 0.9  } },
      ];

      indicadoresRows.forEach((item, idx) => {
        const r = b2Start + 1 + idx;
        requests.push({ repeatCell: { range: { sheetId, startRowIndex: r, endRowIndex: r+1, startColumnIndex: colH, endColumnIndex: colH+1 }, cell: { userEnteredFormat: { backgroundColor: item.bg, textFormat: { bold: true, fontSize: 10, foregroundColor: { red: 0.25, green: 0.25, blue: 0.25 } }, horizontalAlignment: 'LEFT' } }, fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)' } });
        requests.push({ repeatCell: { range: { sheetId, startRowIndex: r, endRowIndex: r+1, startColumnIndex: colH+1, endColumnIndex: colH+2 }, cell: { userEnteredFormat: { backgroundColor: item.bg, textFormat: { bold: true, fontSize: 14, foregroundColor: item.color }, horizontalAlignment: 'RIGHT', numberFormat: { type: 'TEXT' } } }, fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,numberFormat)' } });
      });

      requests.push({ updateBorders: { range: { sheetId, startRowIndex: b2Start, endRowIndex: b2Start + 3, startColumnIndex: colH, endColumnIndex: colH + 2 }, top: { style: 'SOLID_MEDIUM', color: { red: 0.2, green: 0.45, blue: 0.25 } }, bottom: { style: 'SOLID_MEDIUM', color: { red: 0.2, green: 0.45, blue: 0.25 } }, left: { style: 'SOLID_MEDIUM', color: { red: 0.2, green: 0.45, blue: 0.25 } }, right: { style: 'SOLID_MEDIUM', color: { red: 0.2, green: 0.45, blue: 0.25 } }, innerHorizontal: { style: 'SOLID', color: { red: 0.7, green: 0.85, blue: 0.75 } }, innerVertical: { style: 'SOLID', color: { red: 0.7, green: 0.85, blue: 0.75 } } } });

      // Ancho cols H e I
      requests.push({ updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: colH, endIndex: colH + 1 }, properties: { pixelSize: 150 }, fields: 'pixelSize' } });
      requests.push({ updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: colH + 1, endIndex: colH + 2 }, properties: { pixelSize: 150 }, fields: 'pixelSize' } });

      await sheets.spreadsheets.batchUpdate({ spreadsheetId: id, requestBody: { requests } });

      // Escribir valores bloque 1
      await sheets.spreadsheets.values.update({
        spreadsheetId: id,
        range: `Tabla!H${b1Start + 1}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [['Totales del mes', ''], ['Vencimiento', VTO], ['Cobro bruto', totalCobro], ['Reversos', totalRev], ['Reintegros', totalRei], ['Neto total', totalNeto], ['Pendiente', pendiente]] }
      });

      // Escribir valores bloque 2
      await sheets.spreadsheets.values.update({
        spreadsheetId: id,
        range: `Tabla!H${b2Start + 1}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [['Indicadores', ''], ['% Cobrado', pctCobrado + '%'], ['% Rev+Rei / Cobro', pctRevRei + '%']] }
      });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}