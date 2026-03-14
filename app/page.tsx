'use client';
import { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';

const ARS = (v: number) => new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS',minimumFractionDigits:2}).format(v);
const fmtD = (s: string) => new Date(s+'T12:00:00').toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit'});

type TablaRow = { fecha:string; cobro:number; sobrante:number; reverso:number; reintegros:number; neto:number; };
type CobroRow = { fecha:string; monto:number; producto:string; forma:string; credito:number; mora:string; periodo:string; banco:string; tipo:string; };

export default function Dashboard() {
  const [tabla, setTabla] = useState<TablaRow[]>([]);
  const [cobros, setCobros] = useState<CobroRow[]>([]);
  const [reversos, setReversos] = useState<{fecha:string;monto:number}[]>([]);
  const [reintegros, setReintegros] = useState<{fecha:string;monto:number}[]>([]);
  const [activeTab, setActiveTab] = useState('tabla');
  const [fechaSel, setFechaSel] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState
@"
'use client';
import { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';

const ARS = (v: number) => new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS',minimumFractionDigits:2}).format(v);
const fmtD = (s: string) => new Date(s+'T12:00:00').toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit'});

type TablaRow = { fecha:string; cobro:number; sobrante:number; reverso:number; reintegros:number; neto:number; };
type CobroRow = { fecha:string; monto:number; producto:string; forma:string; credito:number; mora:string; periodo:string; banco:string; tipo:string; };

export default function Dashboard() {
  const [tabla, setTabla] = useState<TablaRow[]>([]);
  const [cobros, setCobros] = useState<CobroRow[]>([]);
  const [reversos, setReversos] = useState<{fecha:string;monto:number}[]>([]);
  const [reintegros, setReintegros] = useState<{fecha:string;monto:number}[]>([]);
  const [activeTab, setActiveTab] = useState('tabla');
  const [fechaSel, setFechaSel] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [revF, setRevF] = useState(''); const [revM, setRevM] = useState('');
  const [reiF, setReiF] = useState(''); const [reiM, setReiM] = useState('');
  const VTO = 232751387;

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    try {
      const r = await fetch('/api/sheets');
      const d = await r.json();
      if (d.tabla?.length > 1) {
        setTabla(d.tabla.slice(1).map((r: string[]) => ({
          fecha:r[0], cobro:+r[1]||0, sobrante:+r[2]||0, reverso:+r[3]||0, reintegros:+r[4]||0, neto:+r[5]||0
        })));
      }
      if (d.cobros?.length > 1) {
        setCobros(d.cobros.slice(1).map((r: string[]) => ({
          fecha:r[0], monto:+r[1]||0, producto:r[2]||'', forma:r[3]||'', credito:+r[4]||0,
          mora:r[5]||'', periodo:r[6]||'', banco:r[7]||'', tipo:r[8]||''
        })));
      }
      if (d.reversos?.length > 1) setReversos(d.reversos.slice(1).map((r:string[])=>({fecha:r[0],monto:+r[1]||0})));
      if (d.reintegros?.length > 1) setReintegros(d.reintegros.slice(1).map((r:string[])=>({fecha:r[0],monto:+r[1]||0})));
    } catch(e) { console.error(e); }
    setLoading(false);
  }

  async function saveTabla(t: TablaRow[]) {
    setSaving(true);
    await fetch('/api/sheets', { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ action:'clear_and_write', sheet:'Tabla',
        rows: [['Fecha','Cobro','Sobrante','Reverso','Reintegros','Neto'],
               ...t.map(r=>[r.fecha,r.cobro,r.sobrante,r.reverso,r.reintegros,r.neto])]
      })
    });
    setSaving(false);
  }

  async function saveCobros(c: CobroRow[], fecha: string) {
    const otros = cobros.filter(x=>x.fecha!==fecha);
    const todos = [...otros, ...c];
    setCobros(todos);
    await fetch('/api/sheets', { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ action:'clear_and_write', sheet:'Cobros',
        rows: [['Fecha','Monto','Producto','Forma','Credito','Mora','Periodo','Banco','Tipo'],
               ...todos.map(r=>[r.fecha,r.monto,r.producto,r.forma,r.credito,r.mora,r.periodo,r.banco,r.tipo])]
      })
    });
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    const dm = file.name.match(/(\d{1,2})-(\d{1,2})-(\d{4})/);
    const fecha = dm ? dm[3]+'-'+dm[2].padStart(2,'0')+'-'+dm[1].padStart(2,'0') : '';
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const wb = XLSX.read(new Uint8Array(ev.target!.result as ArrayBuffer),{type:'array'});
      const rows: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{header:1,defval:null});
      let declarado=0, totalReal=0; const newCobros: CobroRow[] = [];
      for (let i=0;i<rows.length;i++) {
        const row=rows[i]; if(!row) continue;
        if(row[5]==='por $'&&row[7]) declarado=+row[7]||0;
        if(i===rows.length-1) { for(let j=row.length-1;j>=0;j--) { if(row[j]&&typeof row[j]==='number'&&row[j]>100){totalReal=row[j];break;} } }
        if(row[12]&&typeof row[12]==='string'&&row[12].includes('réd')) {
          const m=row[12].match(/réd\.N[º°o]\s*(\d+)/i);
          const cred=m?+m[1]:0; const imp=+(row[19]||row[20]||0)||0;
          if(cred&&imp>0) newCobros.push({fecha,monto:imp,producto:'',forma:'COMERCIO',credito:cred,mora:'',periodo:'',banco:'',tipo:''});
        }
      }
      const sob = declarado>0?declarado-totalReal:0;
      const rev = reversos.filter(r=>r.fecha===fecha).reduce((a,r)=>a+r.monto,0);
      const rei = reintegros.filter(r=>r.fecha===fecha).reduce((a,r)=>a+r.monto,0);
      const newRow:TablaRow = {fecha,cobro:totalReal,sobrante:sob>0?sob:0,reverso:rev,reintegros:rei,neto:totalReal-rev+rei};
      const ti = tabla.findIndex(r=>r.fecha===fecha);
      const newTabla = ti>=0 ? tabla.map((r,i)=>i===ti?newRow:r) : [...tabla,newRow].sort((a,b)=>a.fecha.localeCompare(b.fecha));
      setTabla(newTabla);
      await saveCobros(newCobros, fecha);
      await saveTabla(newTabla);
      setActiveTab('detalle'); setFechaSel(fecha);
      alert('Cobros del '+fmtD(fecha)+' guardados en Google Sheets');
    };
    reader.readAsArrayBuffer(file);
  }

  async function addRev() {
    if(!revF||!revM) return;
    const nr = [...reversos,{fecha:revF,monto:+revM}];
    setReversos(nr); setRevF(''); setRevM('');
    await fetch('/api/sheets',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({action:'clear_and_write',sheet:'Reversos',
        rows:[['Fecha','Monto'],...nr.map(r=>[r.fecha,r.monto])]})});
    recalcTabla(nr, reintegros);
  }

  async function addRei() {
    if(!reiF||!reiM) return;
    const nr = [...reintegros,{fecha:reiF,monto:+reiM}];
    setReintegros(nr); setReiF(''); setReiM('');
    await fetch('/api/sheets',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({action:'clear_and_write',sheet:'Reintegros',
        rows:[['Fecha','Monto'],...nr.map(r=>[r.fecha,r.monto])]})});
    recalcTabla(reversos, nr);
  }

  async function recalcTabla(revs: typeof reversos, reis: typeof reintegros) {
    const nt = tabla.map(r=>({...r,
      reverso:revs.filter(x=>x.fecha===r.fecha).reduce((a,x)=>a+x.monto,0),
      reintegros:reis.filter(x=>x.fecha===r.fecha).reduce((a,x)=>a+x.monto,0),
      neto:r.cobro - revs.filter(x=>x.fecha===r.fecha).reduce((a,x)=>a+x.monto,0) + reis.filter(x=>x.fecha===r.fecha).reduce((a,x)=>a+x.monto,0)
    }));
    setTabla(nt); await saveTabla(nt);
  }

  const cobro=tabla.reduce((a,r)=>a+r.cobro,0);
  const sob=tabla.reduce((a,r)=>a+(r.sobrante||0),0);
  const rev=tabla.reduce((a,r)=>a+(r.reverso||0),0);
  const rei=tabla.reduce((a,r)=>a+(r.reintegros||0),0);
  const neto=tabla.reduce((a,r)=>a+(r.neto||0),0);
  const pct=Math.round(cobro/VTO*100);
  const detRows=cobros.filter(c=>c.fecha===fechaSel);
  const fechas=[...new Set(cobros.map(c=>c.fecha))].sort().reverse();
  const moraClass=(m:string)=>{
    if(m==='Cobrado al día'||m==='C1 al día') return 'bg-green-100 text-green-800';
    if(m==='0-31 días') return 'bg-blue-100 text-blue-800';
    if(m==='30-60 días') return 'bg-yellow-100 text-yellow-800';
    return 'bg-red-100 text-red-800';
  };

  if(loading) return <div className="flex items-center justify-center h-screen text-gray-400">Cargando datos...</div>;

  return (
    <div className="max-w-7xl mx-auto p-6 pb-16">
      <div className="flex justify-between items-center mb-6 flex-wrap gap-3">
        <div><h1 className="text-2xl font-semibold text-gray-900">Dashboard de Cobranza</h1>
          <p className="text-sm text-gray-500 mt-1">PROTECAP · {new Date().toLocaleDateString('es-AR',{day:'numeric',month:'long',year:'numeric'})}</p></div>
        <div className="flex gap-2 items-center flex-wrap">
          {saving && <span className="text-xs text-blue-600 animate-pulse">Guardando en Sheets...</span>}
          <button onClick={loadData} className="px-3 py-2 text-sm border rounded-lg hover:bg-gray-50">↻ Actualizar</button>
        </div>
      </div>

      <div className="grid grid-cols-5 gap-3 mb-4">
        {[['Cobro total',cobro,'text-blue-600'],['Sobrante',sob,'text-amber-600'],['Reversos',rev,'text-red-600'],['Reintegros',rei,'text-gray-700'],['Neto',neto,'text-green-600']].map(([l,v,c])=>(
          <div key={l as string} className="bg-white border rounded-xl p-4 shadow-sm">
            <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">{l}</div>
            <div className={'text-lg font-semibold font-mono '+c}>{ARS(v as number)}</div>
          </div>
        ))}
      </div>

      <div className="bg-white border rounded-xl p-4 shadow-sm mb-5">
        <div className="flex justify-between text-sm mb-2"><span className="text-gray-500">Avance sobre vencimiento</span><span className="font-semibold text-blue-600">{pct}%</span></div>
        <div className="h-2 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-blue-500 rounded-full transition-all" style={{width:Math.min(pct,100)+'%'}}></div></div>
        <div className="flex justify-between text-xs text-gray-400 mt-1"><span>Cobrado: {ARS(cobro)}</span><span>Vto: .751.387</span></div>
      </div>

      <div className="flex gap-2 mb-4 flex-wrap">
        {['tabla','carga','detalle','reversos','reintegros'].map(t=>(
          <button key={t} onClick={()=>setActiveTab(t)} className={'px-4 py-2 rounded-full text-sm font-medium transition-all '+(activeTab===t?'bg-white border border-gray-300 shadow-sm text-gray-900':'text-gray-500 hover:text-gray-700')}>
            {t==='tabla'?'Tabla diaria':t==='carga'?'Carga diaria':t==='detalle'?'Cobros del día':t==='reversos'?'Reversos':'Reintegros'}
          </button>
        ))}
      </div>

      {activeTab==='tabla' && (
        <div className="bg-white border rounded-xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto max-h-96 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-50"><tr>
                {['Fecha','Cobro','Sobrante','Reverso','Reintegros','Neto'].map(h=>(
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide border-b">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {tabla.map((r,i)=>(
                  <tr key={i} className="border-b hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium">{fmtD(r.fecha)}</td>
                    <td className="px-4 py-3 text-right font-mono">{ARS(r.cobro)}</td>
                    <td className="px-4 py-3 text-right font-mono text-amber-600">{r.sobrante?ARS(r.sobrante):'-'}</td>
                    <td className="px-4 py-3 text-right font-mono text-red-600">{r.reverso?ARS(r.reverso):'-'}</td>
                    <td className="px-4 py-3 text-right font-mono">{r.reintegros?ARS(r.reintegros):'-'}</td>
                    <td className={'px-4 py-3 text-right font-mono font-semibold '+(r.neto<0?'text-red-600':'text-green-600')}>{ARS(r.neto)}</td>
                  </tr>
                ))}
                <tr className="bg-gray-50 font-semibold border-t-2">
                  <td className="px-4 py-3">TOTAL</td>
                  <td className="px-4 py-3 text-right font-mono">{ARS(cobro)}</td>
                  <td className="px-4 py-3 text-right font-mono text-amber-600">{ARS(sob)}</td>
                  <td className="px-4 py-3 text-right font-mono text-red-600">{ARS(rev)}</td>
                  <td className="px-4 py-3 text-right font-mono">{ARS(rei)}</td>
                  <td className="px-4 py-3 text-right font-mono text-green-600">{ARS(neto)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab==='carga' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white border rounded-xl p-5 shadow-sm">
            <h3 className="font-semibold text-gray-800 mb-3">Cobro diario (xlsx)</h3>
            <label className="flex flex-col items-center justify-center border-2 border-dashed border-gray-300 rounded-xl p-8 cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-all">
              <span className="text-3xl mb-2">📂</span>
              <span className="text-sm text-gray-600">Arrastrá o elegí el archivo del día</span>
              <span className="text-xs text-gray-400 mt-1">ej: 14-03-2026.xlsx</span>
              <input type="file" accept=".xlsx" className="hidden" onChange={handleFile}/>
            </label>
          </div>
          <div className="bg-white border rounded-xl p-5 shadow-sm">
            <h3 className="font-semibold text-gray-800 mb-3">Estado de carga</h3>
            <div className="text-sm text-gray-500 space-y-2">
              <p>✅ Cobros cargados: <strong>{cobros.length}</strong> registros</p>
              <p>📅 Fechas: <strong>{fechas.length}</strong> días</p>
              <p>↩️ Reversos: <strong>{reversos.length}</strong> registros</p>
              <p>💰 Reintegros: <strong>{reintegros.length}</strong> registros</p>
            </div>
          </div>
        </div>
      )}

      {activeTab==='detalle' && (
        <div className="bg-white border rounded-xl shadow-sm overflow-hidden">
          <div className="p-4 border-b flex gap-3 items-center flex-wrap">
            <h3 className="font-semibold text-gray-800">Cobros del día</h3>
            <select value={fechaSel} onChange={e=>setFechaSel(e.target.value)} className="border rounded-lg px-3 py-1.5 text-sm">
              <option value="">— Elegir fecha —</option>
              {fechas.map(f=><option key={f} value={f}>{fmtD(f)}</option>)}
            </select>
            {fechaSel&&<span className="text-sm text-gray-500">{detRows.length} cobros · {ARS(detRows.reduce((a,r)=>a+r.monto,0))}</span>}
          </div>
          <div className="overflow-x-auto max-h-96 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-50"><tr>
                {['Crédito','Mora','Producto','Forma','Banco','Periodo','Tipo','Importe'].map(h=>(
                  <th key={h} className="px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide border-b">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {detRows.length===0?<tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">Seleccioná una fecha</td></tr>:
                detRows.map((r,i)=>(
                  <tr key={i} className="border-b hover:bg-gray-50">
                    <td className="px-3 py-2 font-mono font-semibold">{r.credito}</td>
                    <td className="px-3 py-2"><span className={'px-2 py-0.5 rounded-full text-xs font-medium '+moraClass(r.mora)}>{r.mora||'—'}</span></td>
                    <td className="px-3 py-2 text-xs">{r.producto||'—'}</td>
                    <td className="px-3 py-2 text-xs">{r.forma||'—'}</td>
                    <td className="px-3 py-2 text-xs max-w-32 truncate">{r.banco||'—'}</td>
                    <td className="px-3 py-2 text-xs">{r.periodo||'—'}</td>
                    <td className="px-3 py-2 text-xs">{r.tipo||'—'}</td>
                    <td className="px-3 py-2 text-right font-mono font-semibold">{ARS(r.monto)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab==='reversos' && (
        <div className="bg-white border rounded-xl p-5 shadow-sm">
          <h3 className="font-semibold text-gray-800 mb-4">Reversos</h3>
          <div className="flex gap-2 mb-4 flex-wrap">
            <input type="date" value={revF} onChange={e=>setRevF(e.target.value)} className="border rounded-lg px-3 py-2 text-sm"/>
            <input type="number" value={revM} onChange={e=>setRevM(e.target.value)} placeholder="Monto" className="border rounded-lg px-3 py-2 text-sm w-40"/>
            <button onClick={addRev} className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm hover:bg-gray-700">+ Agregar</button>
          </div>
          <table className="w-full text-sm"><thead><tr className="border-b">
            <th className="text-left py-2 text-xs text-gray-500">Fecha</th>
            <th className="text-right py-2 text-xs text-gray-500">Monto</th>
          </tr></thead><tbody>
            {reversos.map((r,i)=><tr key={i} className="border-b hover:bg-gray-50">
              <td className="py-2">{new Date(r.fecha+'T12:00:00').toLocaleDateString('es-AR',{day:'2-digit',month:'long',year:'numeric'})}</td>
              <td className="py-2 text-right font-mono text-red-600">{ARS(r.monto)}</td>
            </tr>)}
          </tbody></table>
        </div>
      )}

      {activeTab==='reintegros' && (
        <div className="bg-white border rounded-xl p-5 shadow-sm">
          <h3 className="font-semibold text-gray-800 mb-4">Reintegros</h3>
          <div className="flex gap-2 mb-4 flex-wrap">
            <input type="date" value={reiF} onChange={e=>setReiF(e.target.value)} className="border rounded-lg px-3 py-2 text-sm"/>
            <input type="number" value={reiM} onChange={e=>setReiM(e.target.value)} placeholder="Monto" className="border rounded-lg px-3 py-2 text-sm w-40"/>
            <button onClick={addRei} className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm hover:bg-gray-700">+ Agregar</button>
          </div>
          <table className="w-full text-sm"><thead><tr className="border-b">
            <th className="text-left py-2 text-xs text-gray-500">Fecha</th>
            <th className="text-right py-2 text-xs text-gray-500">Monto</th>
          </tr></thead><tbody>
            {reintegros.map((r,i)=><tr key={i} className="border-b hover:bg-gray-50">
              <td className="py-2">{new Date(r.fecha+'T12:00:00').toLocaleDateString('es-AR',{day:'2-digit',month:'long',year:'numeric'})}</td>
              <td className="py-2 text-right font-mono text-green-600">{ARS(r.monto)}</td>
            </tr>)}
          </tbody></table>
        </div>
      )}
    </div>
  );
}
