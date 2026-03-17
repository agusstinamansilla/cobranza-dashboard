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
      const headerRowIndex = allRows.findIndex(r => r[0] === 'Fecha');
      const lastDataRow = allRows.length;
      const firstDataRow = headerRowIndex + 1;

      const requests: any[] = [];

      // Limpiar formato previo
      requests.push({
        repeatCell: {
          range: { sheetId, startRowIndex: 0, endRowIndex: lastDataRow + 2, startColumnIndex: 0, endColumnIndex: 6 },
          cell: { userEnteredFormat: { backgroundColor: { red: 1, green: 1, blue: 1 }, textFormat: { bold: false, fontSize: 10, foregroundColor: { red: 0.2, green: 0.2, blue: 0.2 } }, horizontalAlignment: 'LEFT' } },
          fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,numberFormat)',
        }
      });

      // Header oscuro
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

      // Filas alternas
      for (let i = firstDataRow; i < lastDataRow; i++) {
        const isEven = (i - firstDataRow) % 2 === 0;
        requests.push({
          repeatCell: {
            range: { sheetId, startRowIndex: i, endRowIndex: i + 1, startColumnIndex: 0, endColumnIndex: 6 },
            cell: {
              userEnteredFormat: {
                backgroundColor: isEven ? { red: 0.97, green: 0.97, blue: 0.97 } : { red: 1, green: 1, blue: 1 },
                textFormat: { fontSize: 10 },
              }
            },
            fields: 'userEnteredFormat(backgroundColor,textFormat)',
          }
        });
      }

      // Formato moneda columnas B-F
      requests.push({
        repeatCell: {
          range: { sheetId, startRowIndex: firstDataRow, endRowIndex: lastDataRow, startColumnIndex: 1, endColumnIndex: 6 },
          cell: {
            userEnteredFormat: {
              numberFormat: { type: 'CURRENCY', pattern: '$ #,##0.00' },
              horizontalAlignment: 'RIGHT',
            }
          },
          fields: 'userEnteredFormat(numberFormat,horizontalAlignment)',
        }
      });

      // Sobrante: ámbar
      requests.push({
        repeatCell: {
          range: { sheetId, startRowIndex: firstDataRow, endRowIndex: lastDataRow, startColumnIndex: 2, endColumnIndex: 3 },
          cell: { userEnteredFormat: { textFormat: { foregroundColor: { red: 0.8, green: 0.5, blue: 0.0 } } } },
          fields: 'userEnteredFormat(textFormat)',
        }
      });

      // Reverso: rojo
      requests.push({
        repeatCell: {
          range: { sheetId, startRowIndex: firstDataRow, endRowIndex: lastDataRow, startColumnIndex: 3, endColumnIndex: 4 },
          cell: { userEnteredFormat: { textFormat: { foregroundColor: { red: 0.8, green: 0.1, blue: 0.1 } } } },
          fields: 'userEnteredFormat(textFormat)',
        }
      });

      // Neto: verde negrita
      requests.push({
        repeatCell: {
          range: { sheetId, startRowIndex: firstDataRow, endRowIndex: lastDataRow, startColumnIndex: 5, endColumnIndex: 6 },
          cell: { userEnteredFormat: { textFormat: { bold: true, foregroundColor: { red: 0.1, green: 0.5, blue: 0.1 } } } },
          fields: 'userEnteredFormat(textFormat)',
        }
      });

      // Fila TOTAL: azul suave + negrita
      requests.push({
        repeatCell: {
          range: { sheetId, startRowIndex: lastDataRow - 1, endRowIndex: lastDataRow, startColumnIndex: 0, endColumnIndex: 6 },
          cell: {
            userEnteredFormat: {
              backgroundColor: { red: 0.91, green: 0.94, blue: 1.0 },
              textFormat: { bold: true, fontSize: 11 },
            }
          },
          fields: 'userEnteredFormat(backgroundColor,textFormat)',
        }
      });

      // Bordes
      requests.push({
        updateBorders: {
          range: { sheetId, startRowIndex: headerRowIndex, endRowIndex: lastDataRow, startColumnIndex: 0, endColumnIndex: 6 },
          top:    { style: 'SOLID_MEDIUM', color: { red: 0.7, green: 0.7, blue: 0.7 } },
          bottom: { style: 'SOLID_MEDIUM', color: { red: 0.7, green: 0.7, blue: 0.7 } },
          left:   { style: 'SOLID_MEDIUM', color: { red: 0.7, green: 0.7, blue: 0.7 } },
          right:  { style: 'SOLID_MEDIUM', color: { red: 0.7, green: 0.7, blue: 0.7 } },
          innerHorizontal: { style: 'SOLID', color: { red: 0.85, green: 0.85, blue: 0.85 } },
          innerVertical:   { style: 'SOLID', color: { red: 0.85, green: 0.85, blue: 0.85 } },
        }
      });

      // Ancho columnas
      [100, 140, 140, 130, 130, 140].forEach((pixels, i) => {
        requests.push({
          updateDimensionProperties: {
            range: { sheetId, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 },
            properties: { pixelSize: pixels },
            fields: 'pixelSize',
          }
        });
      });

      // Freeze header
      requests.push({
        updateSheetProperties: {
          properties: { sheetId, gridProperties: { frozenRowCount: headerRowIndex + 1 } },
          fields: 'gridProperties.frozenRowCount',
        }
      });

      await sheets.spreadsheets.batchUpdate({ spreadsheetId: id, requestBody: { requests } });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}