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
    const { action, sheet, rows } = await req.json();
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
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
