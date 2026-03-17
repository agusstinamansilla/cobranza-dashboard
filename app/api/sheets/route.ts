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
      const lastDataRow = allRows.length; // exclusive, 0-indexed

      // Calcular totales para el cuadro resumen
      const VTO = 232751387;
      let totalCobro = 0;
      for (let i = firstDataRow; i < lastDataRow; i++) {
        totalCobro += parseFloat(allRows[i]?.[1] || '0') || 0;
      }
      const pct = ((totalCobro / VTO) * 100).toFixed(1);
      const pendiente = VTO - totalCobro;

      const requests: any[] = [];

      // ── Limpiar formato previo (cols A-F y H-J) ──
      requests.push({
        repeatCell: {
          range: { sheetId, startRowIndex: 0, endRowIndex: lastDataRow + 5, startColumnIndex: 0, endColumnIndex: 10 },
          cell: {
            userEnteredFormat: {
              backgroundColor: { red: 1, green: 1, blue: 1 },
              textFormat: { bold: false, fontSize: 10, foregroundColor: { red: 0.2, green: 0.2, blue: 0.2 } },
              horizontalAlignment: 'LEFT',
            }
          },
          fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,numberFormat)',
        }
      });

      // ── Header oscuro ──
      requests.push({
        repeatCell: {
          range: { sheetId, startRowIndex: headerRowIndex, endRowIndex: headerRowIndex + 1, startColumnIndex: 0, endColumnIndex: 6 },
          cell: {
            userEnteredFormat: {
              backgroundColor: { red: 0.11, green: 0.11, blue: 0.11 },
              textFormat: { bold: true, fontSize: 11, foregroundColor: { red: 1, green: 1, blue: 1 } },
              horizontalAlignment: 'CENTER',
            }
          },
          fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)',
        }
      });

      // ── Filas de datos alternas ──
      for (let i = firstDataRow; i < lastDataRow; i++) {
        const isEven = (i - firstDataRow) % 2 === 0;
        requests.push({
          repeatCell: {
            range: { sheetId, startRowIndex: i, endRowIndex: i + 1, startColumnIndex: 0, endColumnIndex: 6 },
            cell: {
              userEnteredFormat: {
                backgroundColor: isEven
                  ? { red: 0.97, green: 0.97, blue: 0.97 }
                  : { red: 1, green: 1, blue: 1 },
                textFormat: { bold: false, fontSize: 10 },
              }
            },
            fields: 'userEnteredFormat(backgroundColor,textFormat)',
          }
        });
      }

      // ── Formato fecha dd/mm/yyyy en columna A ──
      requests.push({
        repeatCell: {
          range: { sheetId, startRowIndex: firstDataRow, endRowIndex: lastDataRow, startColumnIndex: 0, endColumnIndex: 1 },
          cell: {
            userEnteredFormat: {
              numberFormat: { type: 'DATE', pattern: 'dd/mm/yyyy' },
              horizontalAlignment: 'LEFT',
            }
          },
          fields: 'userEnteredFormat(numberFormat,horizontalAlignment)',
        }
      });

      // ── Formato número SIN decimales cols B-F ──
      requests.push({
        repeatCell: {
          range: { sheetId, startRowIndex: firstDataRow, endRowIndex: lastDataRow, startColumnIndex: 1, endColumnIndex: 6 },
          cell: {
            userEnteredFormat: {
              numberFormat: { type: 'NUMBER', pattern: '$ #,##0' },
              horizontalAlignment: 'RIGHT',
            }
          },
          fields: 'userEnteredFormat(numberFormat,horizontalAlignment)',
        }
      });

      // ── Sobrante: ámbar ──
      requests.push({
        repeatCell: {
          range: { sheetId, startRowIndex: firstDataRow, endRowIndex: lastDataRow, startColumnIndex: 2, endColumnIndex: 3 },
          cell: { userEnteredFormat: { textFormat: { foregroundColor: { red: 0.8, green: 0.5, blue: 0.0 } } } },
          fields: 'userEnteredFormat(textFormat)',
        }
      });

      // ── Reverso: rojo ──
      requests.push({
        repeatCell: {
          range: { sheetId, startRowIndex: firstDataRow, endRowIndex: lastDataRow, startColumnIndex: 3, endColumnIndex: 4 },
          cell: { userEnteredFormat: { textFormat: { foregroundColor: { red: 0.8, green: 0.1, blue: 0.1 } } } },
          fields: 'userEnteredFormat(textFormat)',
        }
      });

      // ── Neto: verde (sin negrita en filas normales) ──
      requests.push({
        repeatCell: {
          range: { sheetId, startRowIndex: firstDataRow, endRowIndex: lastDataRow, startColumnIndex: 5, endColumnIndex: 6 },
          cell: { userEnteredFormat: { textFormat: { bold: false, foregroundColor: { red: 0.1, green: 0.5, blue: 0.1 } } } },
          fields: 'userEnteredFormat(textFormat)',
        }
      });

      // ── Bordes tabla principal ──
      requests.push({
        updateBorders: {
          range: { sheetId, startRowIndex: headerRowIndex, endRowIndex: lastDataRow, startColumnIndex: 0, endColumnIndex: 6 },
          top:    { style: 'SOLID_MEDIUM', color: { red: 0.6, green: 0.6, blue: 0.6 } },
          bottom: { style: 'SOLID_MEDIUM', color: { red: 0.6, green: 0.6, blue: 0.6 } },
          left:   { style: 'SOLID_MEDIUM', color: { red: 0.6, green: 0.6, blue: 0.6 } },
          right:  { style: 'SOLID_MEDIUM', color: { red: 0.6, green: 0.6, blue: 0.6 } },
          innerHorizontal: { style: 'SOLID', color: { red: 0.85, green: 0.85, blue: 0.85 } },
          innerVertical:   { style: 'SOLID', color: { red: 0.85, green: 0.85, blue: 0.85 } },
        }
      });

      // ── Ancho columnas A-F ──
      [110, 140, 130, 130, 130, 140].forEach((pixels, i) => {
        requests.push({
          updateDimensionProperties: {
            range: { sheetId, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 },
            properties: { pixelSize: pixels },
            fields: 'pixelSize',
          }
        });
      });

      // ── Freeze header ──
      requests.push({
        updateSheetProperties: {
          properties: { sheetId, gridProperties: { frozenRowCount: headerRowIndex + 1 } },
          fields: 'gridProperties.frozenRowCount',
        }
      });

      // ─────────────────────────────────────────────────────────
      // ── CUADRO RESUMEN en columnas H-I (fijas, separadas) ──
      // Fila base del cuadro: headerRowIndex (misma altura que el header)
      // Cols: H=7, I=8
      const cuadroStartRow = headerRowIndex; // misma fila que header de tabla
      const cuadroCol = 7; // columna H

      // Header del cuadro
      requests.push({
        repeatCell: {
          range: { sheetId, startRowIndex: cuadroStartRow, endRowIndex: cuadroStartRow + 1, startColumnIndex: cuadroCol, endColumnIndex: cuadroCol + 2 },
          cell: {
            userEnteredFormat: {
              backgroundColor: { red: 0.18, green: 0.27, blue: 0.49 }, // azul oscuro
              textFormat: { bold: true, fontSize: 11, foregroundColor: { red: 1, green: 1, blue: 1 } },
              horizontalAlignment: 'CENTER',
            }
          },
          fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)',
        }
      });

      // Filas del cuadro resumen
      const cuadroRows = [
        { label: 'Vencimiento', value: VTO, color: { red: 0.2, green: 0.2, blue: 0.2 }, bg: { red: 0.94, green: 0.96, blue: 1.0 } },
        { label: 'Total cobrado', value: totalCobro, color: { red: 0.1, green: 0.4, blue: 0.7 }, bg: { red: 1, green: 1, blue: 1 } },
        { label: '% Cobrado', value: null, pct: pct + '%', color: { red: 0.1, green: 0.45, blue: 0.1 }, bg: { red: 0.94, green: 0.99, blue: 0.94 } },
        { label: 'Pendiente', value: pendiente, color: { red: 0.7, green: 0.1, blue: 0.1 }, bg: { red: 1.0, green: 0.96, blue: 0.96 } },
      ];

      cuadroRows.forEach((item, idx) => {
        const rowIdx = cuadroStartRow + 1 + idx;
        // Celda label
        requests.push({
          repeatCell: {
            range: { sheetId, startRowIndex: rowIdx, endRowIndex: rowIdx + 1, startColumnIndex: cuadroCol, endColumnIndex: cuadroCol + 1 },
            cell: {
              userEnteredFormat: {
                backgroundColor: item.bg,
                textFormat: { bold: true, fontSize: 10, foregroundColor: { red: 0.3, green: 0.3, blue: 0.3 } },
                horizontalAlignment: 'LEFT',
              }
            },
            fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)',
          }
        });
        // Celda valor
        requests.push({
          repeatCell: {
            range: { sheetId, startRowIndex: rowIdx, endRowIndex: rowIdx + 1, startColumnIndex: cuadroCol + 1, endColumnIndex: cuadroCol + 2 },
            cell: {
              userEnteredFormat: {
                backgroundColor: item.bg,
                textFormat: { bold: true, fontSize: 11, foregroundColor: item.color },
                horizontalAlignment: 'RIGHT',
                numberFormat: item.value !== null ? { type: 'NUMBER', pattern: '$ #,##0' } : { type: 'TEXT' },
              }
            },
            fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,numberFormat)',
          }
        });
      });

      // Bordes cuadro resumen
      requests.push({
        updateBorders: {
          range: { sheetId, startRowIndex: cuadroStartRow, endRowIndex: cuadroStartRow + 5, startColumnIndex: cuadroCol, endColumnIndex: cuadroCol + 2 },
          top:    { style: 'SOLID_MEDIUM', color: { red: 0.4, green: 0.4, blue: 0.6 } },
          bottom: { style: 'SOLID_MEDIUM', color: { red: 0.4, green: 0.4, blue: 0.6 } },
          left:   { style: 'SOLID_MEDIUM', color: { red: 0.4, green: 0.4, blue: 0.6 } },
          right:  { style: 'SOLID_MEDIUM', color: { red: 0.4, green: 0.4, blue: 0.6 } },
          innerHorizontal: { style: 'SOLID', color: { red: 0.7, green: 0.7, blue: 0.85 } },
          innerVertical:   { style: 'SOLID', color: { red: 0.7, green: 0.7, blue: 0.85 } },
        }
      });

      // Ancho col H e I
      requests.push({
        updateDimensionProperties: {
          range: { sheetId, dimension: 'COLUMNS', startIndex: cuadroCol, endIndex: cuadroCol + 1 },
          properties: { pixelSize: 130 },
          fields: 'pixelSize',
        }
      });
      requests.push({
        updateDimensionProperties: {
          range: { sheetId, dimension: 'COLUMNS', startIndex: cuadroCol + 1, endIndex: cuadroCol + 2 },
          properties: { pixelSize: 150 },
          fields: 'pixelSize',
        }
      });

      await sheets.spreadsheets.batchUpdate({ spreadsheetId: id, requestBody: { requests } });

      // ── Escribir valores del cuadro resumen ──
      await sheets.spreadsheets.values.update({
        spreadsheetId: id,
        range: `Tabla!H${headerRowIndex + 1}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [
            ['Resumen del mes', ''],
            ['Vencimiento', VTO],
            ['Total cobrado', totalCobro],
            ['% Cobrado', pct + '%'],
            ['Pendiente', pendiente],
          ]
        }
      });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}