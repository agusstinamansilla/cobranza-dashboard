'use client';
import { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';

const ARS = (v: number) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2 }).format(v);

const fmtD = (s: string) =>
  new Date(s + 'T12:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });

const fmtDFull = (s: string) =>
  new Date(s + 'T12:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' });

type TablaRow = { fecha: string; cobro: number; sobrante: number; reverso: number; reintegros: number; neto: number };
type CobroRow = { fecha: string; monto: number; producto: string; forma: string; credito: number; mora: string; periodo: string; banco: string; tipo: string; documento: number };
type SimpleRow = { fecha: string; monto: number };
type SobranteRow = { fecha: string; archivo: string; declarado: number; cobrado: number; sobrante: number };
// Mapa de crédito → datos de la base
type BaseMap = Map<number, { producto: string; forma: string; mora: string; periodo: string; banco: string; tipo: string; documento: number }>;

const VTO = 232751387;

export default function Dashboard() {
  const [tabla, setTabla] = useState<TablaRow[]>([]);
  const [cobros, setCobros] = useState<CobroRow[]>([]);
  const [reversos, setReversos] = useState<SimpleRow[]>([]);
  const [reintegros, setReintegros] = useState<SimpleRow[]>([]);
  const [sobrantes, setSobrantes] = useState<SobranteRow[]>([]);
  const [baseMap, setBaseMap] = useState<BaseMap>(new Map());
  const [activeTab, setActiveTab] = useState('tabla');
  const [fechaSel, setFechaSel] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [revF, setRevF] = useState('');
  const [revM, setRevM] = useState('');
  const [reiF, setReiF] = useState('');
  const [reiM, setReiM] = useState('');

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    setError('');
    try {
      const r = await fetch('/api/sheets');
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      if (d.tabla?.length > 1) {
        setTabla(d.tabla.slice(1)
          .filter((row: string[]) => row[0] && row[0] !== 'Fecha' && !String(row[0]).includes('%'))
          .map((row: string[]) => {
            let fecha = '';
            const raw = row[0];
            if (!raw) return null;
            if (typeof raw === 'number' || /^\d{5}$/.test(raw)) {
              // Serial de Excel → yyyy-mm-dd
              const serial = Number(raw);
              // Usar fecha local, no UTC, para evitar el problema de timezone
              const totalDays = serial - 25569;
              const utcMs = totalDays * 86400 * 1000;
              const d = new Date(utcMs);
              // Ajustar a fecha local
              const localDate = new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
              fecha = localDate.toISOString().slice(0, 10);
            } else if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) {
              const [dd, mm, yyyy] = raw.split('/');
              fecha = `${yyyy}-${mm}-${dd}`;
            } else {
              fecha = raw;
            }
            return { fecha, cobro: +row[1] || 0, sobrante: +row[2] || 0, reverso: +row[3] || 0, reintegros: +row[4] || 0, neto: +row[5] || 0 };
          }).filter(Boolean) as TablaRow[]);
      }
      if (d.cobros?.length > 1) {
        setCobros(d.cobros.slice(1).map((row: string[]) => ({
          fecha: row[0] || '', monto: +row[1] || 0, producto: row[2] || '', forma: row[3] || '',
          credito: +row[4] || 0,
          mora: (row[5] || '').replace(/^'/, ''), // quitar comilla si la tiene
          periodo: row[6] || '', banco: row[7] || '', tipo: row[8] || '', documento: +row[9] || 0,
        })));
      }
      if (d.reversos?.length > 1) setReversos(d.reversos.slice(1).map((row: string[]) => ({ fecha: row[0] || '', monto: +row[1] || 0 })));
      if (d.reintegros?.length > 1) setReintegros(d.reintegros.slice(1).map((row: string[]) => ({ fecha: row[0] || '', monto: +row[1] || 0 })));
      if (d.sobrantes?.length > 1) setSobrantes(d.sobrantes.slice(1).map((row: string[]) => ({
        fecha: row[0] || '', archivo: row[1] || '', declarado: +row[2] || 0, cobrado: +row[3] || 0, sobrante: +row[4] || 0,
      })));
    } catch (e: any) {
      setError('Error al cargar datos: ' + e.message);
    }
    setLoading(false);
  }

  async function saveSheet(sheet: string, header: string[], rows: (string | number)[][]) {
    setSaving(true);
    try {
      const res = await fetch('/api/sheets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'clear_and_write', sheet, rows: [header, ...rows] }),
      });
      const d = await res.json();
      if (d.error) throw new Error(d.error);
    } catch (e: any) {
      setError('Error al guardar: ' + e.message);
    }
    setSaving(false);
  }

  async function saveTabla(t: TablaRow[]) {
    await saveSheet('Tabla', ['Fecha', 'Cobro', 'Sobrante', 'Reverso', 'Reintegros', 'Neto'],
      t.map(r => {
        const [y, m, d] = r.fecha.split('-');
        return [`${d}/${m}/${y}`, r.cobro, r.sobrante, r.reverso, r.reintegros, r.neto];
      }));
  }

  async function appendCobros(nuevos: CobroRow[]) {
    setSaving(true);
    try {
      const res = await fetch('/api/sheets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'append',
          sheet: 'Cobros',
          rows: nuevos.map(r => [String(r.fecha), r.monto, r.producto, r.forma, r.credito, r.mora, r.periodo, r.banco, r.tipo, r.documento || '']),
        }),
      });
      const d = await res.json();
      if (d.error) throw new Error(d.error);
    } catch (e: any) {
      setError('Error al guardar cobros: ' + e.message);
    }
    setSaving(false);
  }

  async function saveCobrosData(todos: CobroRow[]) {
    await saveSheet('Cobros', ['Fecha', 'Monto', 'Producto', 'Forma', 'Credito', 'Mora', 'Periodo', 'Banco', 'Tipo', 'Documento'],
      todos.map(r => [
        String(r.fecha), r.monto, r.producto, r.forma, r.credito,
        r.mora,  // mora se guarda normal, el formato RAW en saveSheet evita el error
        r.periodo, r.banco, r.tipo, r.documento || ''
      ]));
  }

  async function saveSobrantesData(todos: SobranteRow[]) {
    await saveSheet('Sobrantes', ['Fecha', 'Archivo', 'Declarado', 'Cobrado', 'Sobrante'],
      todos.map(r => [String(r.fecha), r.archivo, r.declarado, r.cobrado, r.sobrante]));
  }

  // ─── Carga de Base mensual (Base_a_subir) ────────────────────────────────
  // Columnas: Nombre(0) Documento(1) Plan(2) Credito(3) Estado(4) Banco(5)
  //           Mora(6) Primario/Renovacion(7) Periodo(8) Producto conjunto(9)
  function handleBase(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const wb = XLSX.read(new Uint8Array(ev.target!.result as ArrayBuffer), { type: 'array' });
      const rows: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null });
      const map: BaseMap = new Map();
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row) continue;
        const cred = typeof row[3] === 'number' ? row[3] : parseInt(row[3]);
        if (!cred || isNaN(cred)) continue;
        map.set(cred, {
          producto: row[9] || '',
          forma: '',
          mora: row[6] || '',
          periodo: row[8] || '',
          banco: row[5] || '',
          tipo: row[7] || '',
          documento: typeof row[1] === 'number' ? row[1] : parseInt(row[1]) || 0,
        });
      }
      setBaseMap(map);
      setError('');
      alert(`Base cargada: ${map.size} créditos`);
      e.target.value = '';
    };
    reader.readAsArrayBuffer(file);
  }

  // ─── Carga histórica inicial (Base_Marzo) ────────────────────────────────
  // Lee hoja "Tabla" y hoja "Cobro" del archivo y los sube a Google Sheets
  function handleBaseMes(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const wb = XLSX.read(new Uint8Array(ev.target!.result as ArrayBuffer), { type: 'array' });

      // ── Hoja Tabla ──
      let newTabla: TablaRow[] = [];
      const tablaSheet = wb.Sheets['Tabla'];
      if (tablaSheet) {
        const tRows: any[][] = XLSX.utils.sheet_to_json(tablaSheet, { header: 1, defval: null });
        newTabla = tRows.slice(1)
          .filter(r => r && r[0])
          .map(r => {
            // fecha puede venir como Date serial o string
            let fecha = '';
            if (r[0] instanceof Date) {
              fecha = r[0].toISOString().slice(0, 10);
            } else if (typeof r[0] === 'number') {
              // Excel serial date
              const d = XLSX.SSF.parse_date_code(r[0]);
              fecha = `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;
            } else {
              fecha = String(r[0]).slice(0, 10);
            }
            return {
              fecha,
              cobro: +r[1] || 0,
              sobrante: +r[2] || 0,
              reverso: +r[3] || 0,
              reintegros: +r[4] || 0,
              neto: +r[5] || 0,
            };
          });
      }

      // ── Hoja Cobro ──
      let newCobros: CobroRow[] = [];
      const cobroSheet = wb.Sheets['Cobro'];
      if (cobroSheet) {
        // Columnas: Fecha(0) Monto(1) Producto(2) Forma(3) Credito(4) Mora(5) Periodo(6) Banco(7) Primario/Renovacion(8)
        const cRows: any[][] = XLSX.utils.sheet_to_json(cobroSheet, { header: 1, defval: null });
        newCobros = cRows.slice(1)
          .filter(r => r && r[0] && r[4])
          .map(r => {
            let fecha = '';
            if (r[0] instanceof Date) {
              fecha = r[0].toISOString().slice(0, 10);
            } else if (typeof r[0] === 'number') {
              const d = XLSX.SSF.parse_date_code(r[0]);
              fecha = `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;
            } else {
              fecha = String(r[0]).slice(0, 10);
            }
            return {
              fecha,
              monto: +r[1] || 0,
              producto: r[2] || '',
              forma: r[3] || '',
              credito: +r[4] || 0,
              mora: r[5] || '',
              periodo: r[6] || '',
              banco: r[7] || '',
              tipo: r[8] || '',
              documento: +r[9] || 0,
            };
          });
      }

      setTabla(newTabla);
      setCobros(newCobros);
      await saveTabla(newTabla);
      await saveCobrosData(newCobros);
      setError('');
      alert(`Base histórica cargada: ${newTabla.length} días, ${newCobros.length} cobros`);
      e.target.value = '';
    };
    reader.readAsArrayBuffer(file);
  }

  // ─── Carga diaria (archivo del día) ─────────────────────────────────────
  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const dm = file.name.match(/(\d{1,2})-(\d{1,2})-(\d{4})/);
    const fecha = dm ? `${dm[3]}-${dm[2].padStart(2, '0')}-${dm[1].padStart(2, '0')}` : '';
    if (!fecha) {
      setError('El nombre del archivo debe incluir la fecha (ej: 14-03-2026.xlsx)');
      return;
    }
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const wb = XLSX.read(new Uint8Array(ev.target!.result as ArrayBuffer), { type: 'array' });
      const rows: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null });

      // Declarado: buscar fila que contenga 'por $' y tomar el número siguiente
      let declarado = 0;
      for (let i = 0; i < Math.min(rows.length, 20); i++) {
        const row = rows[i];
        if (!row) continue;
        const porIdx = row.findIndex((v: any) => typeof v === 'string' && v.includes('por $'));
        if (porIdx >= 0) {
          // Buscar número > 1000 después de 'por $' en esa misma fila
          const num = row.slice(porIdx + 1).find((v: any) => typeof v === 'number' && v > 1000);
          if (num) { declarado = +num; break; }
        }
      }

      // Cobro real: buscar desde la última fila hacia arriba en columna T (índice 19)
      let totalReal = 0;
      for (let i = rows.length - 1; i >= 0; i--) {
        const row = rows[i];
        if (!row) continue;
        const val = row[19];
        if (typeof val === 'number' && val > 100) {
          totalReal = val;
          break;
        }
      }

      const sob = declarado > 0 && totalReal > 0 ? Math.max(declarado - totalReal, 0) : 0;

      // Extraer créditos e importes (filas desde índice 16, excluye la última)
      const newCobros: CobroRow[] = [];
      for (let i = 16; i < rows.length - 1; i++) {
        const row = rows[i];
        if (!row) continue;
        const deuda = row[12];
        const deudaLower = typeof deuda === 'string' ? deuda.toLowerCase() : '';
        if (deudaLower.includes('créd') || deudaLower.includes('cred')) {
          const m = deuda.match(/[Cc]r[eéÉ]d\.N[ºo°]\s*(\d+)/i) || deuda.match(/(\d{4,6})\s+de\s+CASA/i);
          const cred = m ? +m[1] : 0;
          const cred = m ? +m[1] : 0;
          const imp = typeof row[19] === 'number' ? row[19] : 0;
          if (cred && imp > 0) {
            // Cruzar con la base
            const base = baseMap.get(cred);
            newCobros.push({
              fecha,
              monto: imp,
              credito: cred,
              producto: base?.producto || '',
              forma: 'COMERCIO',
              mora: base?.mora || '',
              periodo: base?.periodo || '',
              banco: base?.banco || '',
              tipo: base?.tipo || '',
              documento: base?.documento || 0,
            });
          }
        }
      }

      const rev = reversos.filter(r => r.fecha === fecha).reduce((a, r) => a + r.monto, 0);
      const rei = reintegros.filter(r => r.fecha === fecha).reduce((a, r) => a + r.monto, 0);

      // Guardar sobrante en hoja Sobrantes con número de archivo
      const archivoNum = String((sobrantes.filter(s => s.fecha === fecha).length) + 1);
      const newSobranteRow: SobranteRow = { fecha, archivo: archivoNum, declarado, cobrado: totalReal, sobrante: sob };
      const newSobrantes = [...sobrantes, newSobranteRow];
      setSobrantes(newSobrantes);

      // Sobrante total del día = suma de todos los sobrantes de esa fecha
      const sobTotalDia = newSobrantes.filter(s => s.fecha === fecha).reduce((a, s) => a + s.sobrante, 0);

      // Si ya existe esa fecha en la tabla, SUMAR cobro al existente
      const existente = tabla.find(r => r.fecha === fecha);
      const cobroTotal = (existente?.cobro || 0) + totalReal;
      const newRow: TablaRow = {
        fecha,
        cobro: cobroTotal,
        sobrante: sobTotalDia,
        reverso: rev,
        reintegros: rei,
        neto: cobroTotal - rev + rei,
      };

      const newTabla = existente
        ? tabla.map(r => r.fecha === fecha ? newRow : r)
        : [...tabla, newRow].sort((a, b) => a.fecha.localeCompare(b.fecha));

      // Cobros: ACUMULAR — solo guardar los NUEVOS en Sheets (append, no reescribir todo)
      const todosCobros = [...cobros, ...newCobros];
      setCobros(todosCobros);
      setTabla(newTabla);

      await saveSobrantesData(newSobrantes);
      // Solo appendear los nuevos cobros del día, no reescribir los 4900+
      if (newCobros.length > 0) {
        await appendCobros(newCobros);
      }
      await saveTabla(newTabla);
      setError(`✓ ${newCobros.length} cobros guardados`);

      setActiveTab('detalle');
      setFechaSel(fecha);
      e.target.value = '';
    };
    reader.readAsArrayBuffer(file);
  }

  async function addRev() {
    if (!revF || !revM) return;
    const nr = [...reversos, { fecha: revF, monto: +revM }];
    setReversos(nr);
    setRevF(''); setRevM('');
    await saveSheet('Reversos', ['Fecha', 'Monto'], nr.map(r => [r.fecha, r.monto]));
    await recalcTabla(nr, reintegros);
  }

  async function deleteRev(i: number) {
    const nr = reversos.filter((_, idx) => idx !== i);
    setReversos(nr);
    await saveSheet('Reversos', ['Fecha', 'Monto'], nr.map(r => [r.fecha, r.monto]));
    await recalcTabla(nr, reintegros);
  }

  async function addRei() {
    if (!reiF || !reiM) return;
    const nr = [...reintegros, { fecha: reiF, monto: +reiM }];
    setReintegros(nr);
    setReiF(''); setReiM('');
    await saveSheet('Reintegros', ['Fecha', 'Monto'], nr.map(r => [r.fecha, r.monto]));
    await recalcTabla(reversos, nr);
  }

  async function deleteRei(i: number) {
    const nr = reintegros.filter((_, idx) => idx !== i);
    setReintegros(nr);
    await saveSheet('Reintegros', ['Fecha', 'Monto'], nr.map(r => [r.fecha, r.monto]));
    await recalcTabla(reversos, nr);
  }

  async function recalcTabla(revs: SimpleRow[], reis: SimpleRow[]) {
    // Solo recalcular si hay datos reales en la tabla
    if (tabla.length === 0 || tabla.every(r => r.cobro === 0 && r.reverso === 0)) return;
    const nt = tabla.map(r => ({
      ...r,
      reverso: revs.filter(x => x.fecha === r.fecha).reduce((a, x) => a + x.monto, 0),
      reintegros: reis.filter(x => x.fecha === r.fecha).reduce((a, x) => a + x.monto, 0),
      neto: r.cobro
        - revs.filter(x => x.fecha === r.fecha).reduce((a, x) => a + x.monto, 0)
        + reis.filter(x => x.fecha === r.fecha).reduce((a, x) => a + x.monto, 0),
    }));
    setTabla(nt);
    await saveTabla(nt);
  }

  const totalCobro = tabla.reduce((a, r) => a + r.cobro, 0);
  const totalSob = tabla.reduce((a, r) => a + (r.sobrante || 0), 0);
  const totalRev = tabla.reduce((a, r) => a + (r.reverso || 0), 0);
  const totalRei = tabla.reduce((a, r) => a + (r.reintegros || 0), 0);
  const totalNeto = tabla.reduce((a, r) => a + (r.neto || 0), 0);
  const pct = Math.min(Math.round((totalCobro / VTO) * 100), 100);

  const detRows = cobros.filter(c => c.fecha === fechaSel);
  const fechas = [...new Set(cobros.map(c => c.fecha))].sort().reverse();

  const moraClass = (m: string) => {
    if (m === 'Cobrado al día' || m === 'C1 al día') return 'bg-green-100 text-green-800';
    if (m === '0-31 días') return 'bg-blue-100 text-blue-800';
    if (m === '30-60 días' || m === '60-120 días') return 'bg-yellow-100 text-yellow-800';
    if (m) return 'bg-red-100 text-red-800';
    return 'bg-gray-100 text-gray-600';
  };

  const tabs = [
    { id: 'tabla', label: 'Tabla diaria' },
    { id: 'carga', label: 'Carga diaria' },
    { id: 'detalle', label: 'Cobros del día' },
    { id: 'sobrantes', label: 'Sobrantes' },
    { id: 'reversos', label: 'Reversos' },
    { id: 'reintegros', label: 'Reintegros' },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-gray-500 text-sm">Cargando datos de Google Sheets...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto p-6 pb-16">

        {/* Header */}
        <div className="flex justify-between items-start mb-6 flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Dashboard de Cobranza</h1>
            <p className="text-sm text-gray-500 mt-1">
              PROTECAP · {new Date().toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
          </div>
          <div className="flex gap-2 items-center flex-wrap">
            {saving && <span className="text-xs text-blue-600 animate-pulse font-medium">Guardando en Sheets...</span>}
            {baseMap.size > 0 && (
              <span className="text-xs text-green-600 font-medium bg-green-50 px-2 py-1 rounded-lg">
                ✓ Base cargada ({baseMap.size} créditos)
              </span>
            )}
            <button
              onClick={async () => {
                setSaving(true);
                try {
                  const res = await fetch('/api/sheets', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'format_tabla' }),
                  });
                  const d = await res.json();
                  if (d.error) throw new Error(d.error);
                  alert('✅ Sheet formateado correctamente');
                } catch (e: any) {
                  setError('Error al formatear: ' + e.message);
                }
                setSaving(false);
              }}
              disabled={saving}
              className="px-3 py-2 text-sm border rounded-lg hover:bg-white bg-white shadow-sm disabled:opacity-50 transition-all"
            >
              🎨 Formatear Sheet
            </button>
            <button
              onClick={loadData}
              disabled={saving}
              className="px-3 py-2 text-sm border rounded-lg hover:bg-white bg-white shadow-sm disabled:opacity-50 transition-all"
            >
              ↻ Actualizar
            </button>
          </div>
        </div>

        {/* Error banner */}
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex justify-between items-start">
            <p className="text-sm text-red-700">{error}</p>
            <button onClick={() => setError('')} className="text-red-400 hover:text-red-600 ml-3 text-lg leading-none">×</button>
          </div>
        )}

        {/* KPI Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">
          {[
            { label: 'Cobro total', value: totalCobro, color: 'text-blue-600' },
            { label: 'Sobrante', value: totalSob, color: 'text-amber-600' },
            { label: 'Reversos', value: totalRev, color: 'text-red-600' },
            { label: 'Reintegros', value: totalRei, color: 'text-gray-700' },
            { label: 'Neto', value: totalNeto, color: 'text-green-600' },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-white border rounded-xl p-4 shadow-sm">
              <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">{label}</div>
              <div className={`text-lg font-semibold font-mono ${color}`}>{ARS(value)}</div>
            </div>
          ))}
        </div>

        {/* Progress bar */}
        <div className="bg-white border rounded-xl p-4 shadow-sm mb-5">
          <div className="flex justify-between text-sm mb-2">
            <span className="text-gray-500">Avance sobre vencimiento</span>
            <span className="font-semibold text-blue-600">{pct}%</span>
          </div>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 rounded-full transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-gray-400 mt-1">
            <span>Cobrado: {ARS(totalCobro)}</span>
            <span>Vto: {ARS(VTO)}</span>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-4 flex-wrap bg-white border rounded-xl p-1 shadow-sm w-fit">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === t.id
                  ? 'bg-gray-900 text-white shadow-sm'
                  : 'text-gray-500 hover:text-gray-800 hover:bg-gray-50'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab: Tabla diaria */}
        {activeTab === 'tabla' && (
          <div className="bg-white border rounded-xl shadow-sm overflow-hidden">
            <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-gray-50 z-10">
                  <tr>
                    {['Fecha', 'Cobro', 'Sobrante', 'Reverso', 'Reintegros', 'Neto'].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide border-b">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tabla.length === 0 ? (
                    <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-400">Sin datos — cargá un archivo xlsx</td></tr>
                  ) : (
                    tabla.map((r, i) => (
                      <tr key={i} className="border-b hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 font-medium">{fmtD(r.fecha)}</td>
                        <td className="px-4 py-3 text-right font-mono">{ARS(r.cobro)}</td>
                        <td className="px-4 py-3 text-right font-mono text-amber-600">{r.sobrante ? ARS(r.sobrante) : '—'}</td>
                        <td className="px-4 py-3 text-right font-mono text-red-600">{r.reverso ? ARS(r.reverso) : '—'}</td>
                        <td className="px-4 py-3 text-right font-mono">{r.reintegros ? ARS(r.reintegros) : '—'}</td>
                        <td className={`px-4 py-3 text-right font-mono font-semibold ${r.neto < 0 ? 'text-red-600' : 'text-green-600'}`}>
                          {ARS(r.neto)}
                        </td>
                      </tr>
                    ))
                  )}
                  {tabla.length > 0 && (
                    <tr className="bg-gray-50 font-semibold border-t-2 border-gray-300">
                      <td className="px-4 py-3 text-gray-700">TOTAL</td>
                      <td className="px-4 py-3 text-right font-mono">{ARS(totalCobro)}</td>
                      <td className="px-4 py-3 text-right font-mono text-amber-600">{ARS(totalSob)}</td>
                      <td className="px-4 py-3 text-right font-mono text-red-600">{ARS(totalRev)}</td>
                      <td className="px-4 py-3 text-right font-mono">{ARS(totalRei)}</td>
                      <td className="px-4 py-3 text-right font-mono text-green-600">{ARS(totalNeto)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tab: Carga diaria */}
        {activeTab === 'carga' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

            {/* Cobro diario */}
            <div className="bg-white border rounded-xl p-5 shadow-sm">
              <h3 className="font-semibold text-gray-800 mb-1">Cobro diario</h3>
              <p className="text-xs text-gray-400 mb-4">El nombre del archivo debe incluir la fecha, ej: <code className="bg-gray-100 px-1 rounded">14-03-2026.xlsx</code></p>
              {baseMap.size === 0 && (
                <div className="mb-3 p-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
                  ⚠️ Cargá la base mensual primero para enriquecer los cobros con producto, mora y banco
                </div>
              )}
              <label className="flex flex-col items-center justify-center border-2 border-dashed border-gray-300 rounded-xl p-10 cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-all">
                <span className="text-4xl mb-3">📂</span>
                <span className="text-sm font-medium text-gray-700">Arrastrá o elegí el archivo del día</span>
                <span className="text-xs text-gray-400 mt-1">.xlsx</span>
                <input type="file" accept=".xlsx" className="hidden" onChange={handleFile} />
              </label>
            </div>

            {/* Base mensual */}
            <div className="bg-white border rounded-xl p-5 shadow-sm">
              <h3 className="font-semibold text-gray-800 mb-1">Base mensual</h3>
              <p className="text-xs text-gray-400 mb-4">Subí la base una vez al mes para cruzar los cobros con producto, mora y banco. Archivo: <code className="bg-gray-100 px-1 rounded">Base_a_subir.xlsx</code></p>
              <label className="flex flex-col items-center justify-center border-2 border-dashed border-gray-300 rounded-xl p-6 cursor-pointer hover:border-green-400 hover:bg-green-50 transition-all">
                <span className="text-4xl mb-3">🗂️</span>
                <span className="text-sm font-medium text-gray-700">Elegí la base del mes</span>
                <span className="text-xs text-gray-400 mt-1">.xlsx · se carga solo en memoria</span>
                <input type="file" accept=".xlsx" className="hidden" onChange={handleBase} />
              </label>
              {baseMap.size > 0 && (
                <p className="mt-3 text-xs text-center text-green-600 font-medium">✓ {baseMap.size} créditos cargados</p>
              )}
            </div>

            {/* Carga histórica (solo primer mes) */}
            <div className="bg-white border border-dashed border-gray-200 rounded-xl p-5 shadow-sm md:col-span-2">
              <h3 className="font-semibold text-gray-800 mb-1">Carga histórica inicial <span className="text-xs font-normal text-gray-400 ml-2">(solo primer mes)</span></h3>
              <p className="text-xs text-gray-400 mb-4">Subí el archivo con los datos históricos del mes (ej: <code className="bg-gray-100 px-1 rounded">Base_Marzo_2026.xlsx</code>). Requiere hojas <code className="bg-gray-100 px-1 rounded">Tabla</code> y <code className="bg-gray-100 px-1 rounded">Cobro</code>. <strong className="text-red-500">Reemplaza todo lo que hay en Sheets.</strong></p>
              <label className="flex flex-col items-center justify-center border-2 border-dashed border-orange-200 rounded-xl p-6 cursor-pointer hover:border-orange-400 hover:bg-orange-50 transition-all">
                <span className="text-4xl mb-3">📋</span>
                <span className="text-sm font-medium text-gray-700">Elegí el archivo histórico del mes</span>
                <span className="text-xs text-gray-400 mt-1">.xlsx con hojas Tabla y Cobro</span>
                <input type="file" accept=".xlsx" className="hidden" onChange={handleBaseMes} />
              </label>
            </div>

            {/* Estado de carga */}
            <div className="bg-white border rounded-xl p-5 shadow-sm md:col-span-2">
              <h3 className="font-semibold text-gray-800 mb-4">Estado de carga</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div className="flex justify-between items-center py-2 border-b">
                  <span className="text-gray-500">✅ Cobros cargados</span>
                  <span className="font-semibold">{cobros.length} registros</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b">
                  <span className="text-gray-500">📅 Días cargados</span>
                  <span className="font-semibold">{fechas.length} días</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b">
                  <span className="text-gray-500">↩️ Reversos</span>
                  <span className="font-semibold">{reversos.length} registros</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b">
                  <span className="text-gray-500">💰 Reintegros</span>
                  <span className="font-semibold">{reintegros.length} registros</span>
                </div>
              </div>
              {fechas.length > 0 && (
                <div className="mt-4 pt-4 border-t">
                  <p className="text-xs text-gray-400 mb-2">Último día cargado</p>
                  <p className="text-sm font-semibold text-gray-700">{fmtDFull(fechas[0])}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tab: Cobros del día */}
        {activeTab === 'detalle' && (
          <div className="bg-white border rounded-xl shadow-sm overflow-hidden">
            <div className="p-4 border-b flex gap-3 items-center flex-wrap">
              <h3 className="font-semibold text-gray-800">Cobros del día</h3>
              <select
                value={fechaSel}
                onChange={e => setFechaSel(e.target.value)}
                className="border rounded-lg px-3 py-1.5 text-sm bg-white"
              >
                <option value="">— Elegir fecha —</option>
                {fechas.map(f => <option key={f} value={f}>{fmtD(f)}</option>)}
              </select>
              {fechaSel && (
                <span className="text-sm text-gray-500">
                  {detRows.length} cobros · {ARS(detRows.reduce((a, r) => a + r.monto, 0))}
                </span>
              )}
            </div>
            <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-gray-50 z-10">
                  <tr>
                    {['Crédito', 'Documento', 'Mora', 'Producto', 'Forma', 'Banco', 'Periodo', 'Tipo', 'Importe'].map(h => (
                      <th key={h} className="px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide border-b">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {detRows.length === 0 ? (
                    <tr><td colSpan={9} className="px-4 py-10 text-center text-gray-400">
                      {fechaSel ? 'Sin cobros para esta fecha' : 'Seleccioná una fecha'}
                    </td></tr>
                  ) : detRows.map((r, i) => (
                    <tr key={i} className="border-b hover:bg-gray-50 transition-colors">
                      <td className="px-3 py-2.5 font-mono font-semibold text-gray-800">{r.credito}</td>
                      <td className="px-3 py-2.5 font-mono text-xs text-gray-600">{r.documento || '—'}</td>
                      <td className="px-3 py-2.5">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${moraClass(r.mora)}`}>
                          {r.mora || '—'}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-xs text-gray-600">{r.producto || '—'}</td>
                      <td className="px-3 py-2.5 text-xs text-gray-600">{r.forma || '—'}</td>
                      <td className="px-3 py-2.5 text-xs text-gray-600 max-w-32 truncate">{r.banco || '—'}</td>
                      <td className="px-3 py-2.5 text-xs text-gray-600">{r.periodo || '—'}</td>
                      <td className="px-3 py-2.5 text-xs text-gray-600">{r.tipo || '—'}</td>
                      <td className="px-3 py-2.5 text-right font-mono font-semibold">{ARS(r.monto)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tab: Sobrantes */}
        {activeTab === 'sobrantes' && (
          <div className="bg-white border rounded-xl shadow-sm overflow-hidden">
            <div className="p-4 border-b">
              <h3 className="font-semibold text-gray-800">Sobrantes por archivo</h3>
              <p className="text-xs text-gray-400 mt-1">Cada fila corresponde a un archivo subido. El sobrante de la tabla suma todos los archivos del mismo día.</p>
            </div>
            <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-gray-50 z-10">
                  <tr>
                    {['Fecha', 'Archivo #', 'Declarado', 'Cobrado', 'Sobrante'].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide border-b">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sobrantes.length === 0 ? (
                    <tr><td colSpan={5} className="px-4 py-10 text-center text-gray-400">Sin sobrantes registrados</td></tr>
                  ) : sobrantes.map((s, i) => (
                    <tr key={i} className="border-b hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 font-medium">{fmtD(s.fecha)}</td>
                      <td className="px-4 py-3 text-center font-mono text-gray-500">{s.archivo}</td>
                      <td className="px-4 py-3 text-right font-mono text-blue-600">{ARS(s.declarado)}</td>
                      <td className="px-4 py-3 text-right font-mono text-gray-700">{ARS(s.cobrado)}</td>
                      <td className="px-4 py-3 text-right font-mono font-semibold text-amber-600">{ARS(s.sobrante)}</td>
                    </tr>
                  ))}
                  {sobrantes.length > 0 && (
                    <tr className="bg-gray-50 font-semibold border-t-2 border-gray-300">
                      <td className="px-4 py-3 text-gray-700" colSpan={2}>TOTAL</td>
                      <td className="px-4 py-3 text-right font-mono text-blue-600">{ARS(sobrantes.reduce((a, s) => a + s.declarado, 0))}</td>
                      <td className="px-4 py-3 text-right font-mono text-gray-700">{ARS(sobrantes.reduce((a, s) => a + s.cobrado, 0))}</td>
                      <td className="px-4 py-3 text-right font-mono text-amber-600">{ARS(sobrantes.reduce((a, s) => a + s.sobrante, 0))}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tab: Reversos */}
        {activeTab === 'reversos' && (
          <div className="bg-white border rounded-xl p-5 shadow-sm">
            <h3 className="font-semibold text-gray-800 mb-4">Reversos</h3>
            <div className="flex gap-2 mb-5 flex-wrap">
              <input type="date" value={revF} onChange={e => setRevF(e.target.value)} className="border rounded-lg px-3 py-2 text-sm" />
              <input type="number" value={revM} onChange={e => setRevM(e.target.value)} placeholder="Monto" className="border rounded-lg px-3 py-2 text-sm w-44" />
              <button onClick={addRev} disabled={!revF || !revM || saving} className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm hover:bg-gray-700 disabled:opacity-40 transition-all">
                + Agregar reverso
              </button>
            </div>
            {reversos.length === 0 ? (
              <p className="text-sm text-gray-400 py-4 text-center">Sin reversos registrados</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 text-xs text-gray-500 font-semibold uppercase tracking-wide">Fecha</th>
                    <th className="text-right py-2 text-xs text-gray-500 font-semibold uppercase tracking-wide">Monto</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {reversos.map((r, i) => (
                    <tr key={i} className="border-b hover:bg-gray-50">
                      <td className="py-2.5">{fmtDFull(r.fecha)}</td>
                      <td className="py-2.5 text-right font-mono text-red-600 font-semibold">{ARS(r.monto)}</td>
                      <td className="py-2.5 text-right">
                        <button onClick={() => deleteRev(i)} className="text-gray-300 hover:text-red-500 transition-colors text-lg leading-none px-1" title="Eliminar">×</button>
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-gray-200 font-semibold">
                    <td className="py-2.5 text-gray-600">Total reversos</td>
                    <td className="py-2.5 text-right font-mono text-red-600">{ARS(reversos.reduce((a, r) => a + r.monto, 0))}</td>
                    <td />
                  </tr>
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* Tab: Reintegros */}
        {activeTab === 'reintegros' && (
          <div className="bg-white border rounded-xl p-5 shadow-sm">
            <h3 className="font-semibold text-gray-800 mb-4">Reintegros</h3>
            <div className="flex gap-2 mb-5 flex-wrap">
              <input type="date" value={reiF} onChange={e => setReiF(e.target.value)} className="border rounded-lg px-3 py-2 text-sm" />
              <input type="number" value={reiM} onChange={e => setReiM(e.target.value)} placeholder="Monto" className="border rounded-lg px-3 py-2 text-sm w-44" />
              <button onClick={addRei} disabled={!reiF || !reiM || saving} className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm hover:bg-gray-700 disabled:opacity-40 transition-all">
                + Agregar reintegro
              </button>
            </div>
            {reintegros.length === 0 ? (
              <p className="text-sm text-gray-400 py-4 text-center">Sin reintegros registrados</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 text-xs text-gray-500 font-semibold uppercase tracking-wide">Fecha</th>
                    <th className="text-right py-2 text-xs text-gray-500 font-semibold uppercase tracking-wide">Monto</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {reintegros.map((r, i) => (
                    <tr key={i} className="border-b hover:bg-gray-50">
                      <td className="py-2.5">{fmtDFull(r.fecha)}</td>
                      <td className="py-2.5 text-right font-mono text-green-600 font-semibold">{ARS(r.monto)}</td>
                      <td className="py-2.5 text-right">
                        <button onClick={() => deleteRei(i)} className="text-gray-300 hover:text-red-500 transition-colors text-lg leading-none px-1" title="Eliminar">×</button>
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-gray-200 font-semibold">
                    <td className="py-2.5 text-gray-600">Total reintegros</td>
                    <td className="py-2.5 text-right font-mono text-green-600">{ARS(reintegros.reduce((a, r) => a + r.monto, 0))}</td>
                    <td />
                  </tr>
                </tbody>
              </table>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
