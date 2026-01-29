import React, { useState, useEffect, useMemo } from 'react';
import Sidebar from '../components/Sidebar';
import Notifications from '../components/Notifications';
import { supabase } from '../supabaseClient';
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { 
  BookOpen, Download, Search, ChevronLeft, ChevronRight, 
  ArrowRightLeft, AlertTriangle, FileText, Loader2, RefreshCw
} from 'lucide-react';

// --- UTILIDADES ---
const toNum = (val) => {
    if (val === null || val === undefined) return 0;
    if (typeof val === 'number') return isNaN(val) ? 0 : val;
    try {
        const clean = String(val).trim().replace(/\./g, '').replace(',', '.');
        const num = parseFloat(clean);
        return isNaN(num) ? 0 : num;
    } catch { return 0; }
};

const currency = (val) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(toNum(val));
const safeStr = (str) => (str || '').toString().trim();

const getAuxAccount = (name, prefix) => {
    const cleanName = safeStr(name).toUpperCase();
    if (!cleanName) return `${prefix}00000`;
    let hash = 0;
    for (let i = 0; i < cleanName.length; i++) hash = cleanName.charCodeAt(i) + ((hash << 5) - hash);
    const suffix = Math.abs(hash).toString().slice(0, 5).padEnd(5, '0');
    return `${prefix}${suffix}`;
};

const TREASURY_MAP = {
    'Tarjeta': '57200001', 'Transferencia': '57200000', 'Efectivo': '57000000', 'Domiciliación': '57200000', 'default': '57299999'
};

export default function Journal() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('journal');
  const [year, setYear] = useState(new Date().getFullYear());
  const [searchTerm, setSearchTerm] = useState('');
  
  const [journalEntries, setJournalEntries] = useState([]);
  const [ledger, setLedger] = useState({});
  const [mappingErrors, setMappingErrors] = useState([]);

  // 1. CARGA Y MOTOR CONTABLE
  useEffect(() => {
    let isMounted = true;
    async function processAccounting() {
      setLoading(true); setError(null);
      try {
        const [treatmentRes, expenseRes, mapRes, incRes, expRes] = await Promise.all([
            supabase.from('treatment_catalog').select('*').throwOnError(),
            supabase.from('expense_catalog').select('*').throwOnError(),
            supabase.from('accounting_map').select('*').throwOnError(),
            supabase.from('incomes').select('*').gte('issue_date', `${year}-01-01`).lte('issue_date', `${year}-12-31`).throwOnError(),
            supabase.from('expenses').select('*').gte('issue_date', `${year}-01-01`).lte('issue_date', `${year}-12-31`).throwOnError()
        ]);

        if (!isMounted) return;

        const treatments = {}; (treatmentRes.data || []).forEach(t => { if(t.name) treatments[t.name.toLowerCase().trim()] = t.account_code; });
        const expenseTypes = {}; (expenseRes.data || []).forEach(e => { if(e.name) expenseTypes[e.name.toLowerCase().trim()] = e.account_code; });
        const accountNames = {}; (mapRes.data || []).forEach(a => { if(a.account_code) accountNames[a.account_code] = a.concept_name; });

        const entries = []; const errors = []; let asientoId = 1;

        // INGRESOS
        (incRes.data || []).forEach(inc => {
            const date = inc.issue_date; const doc = safeStr(inc.invoice_number || 'S/N');
            const client = safeStr(inc.client_name || 'Cliente Varios');
            const total = toNum(inc.total_amount); const base = toNum(inc.tax_base); const vat = toNum(inc.vat_quota);
            
            let accRev = treatments[safeStr(inc.treatment_name).toLowerCase()] || '70500000';
            const accCli = getAuxAccount(client, '430');
            const accTreasury = TREASURY_MAP[safeStr(inc.payment_method)] || TREASURY_MAP['default'];

            entries.push({ id: asientoId, date, type: 'FACTURA', doc, account: accCli, name: client, desc: `Fra. ${doc}`, debe: total, haber: 0 });
            entries.push({ id: asientoId, date, type: 'FACTURA', doc, account: accRev, name: accountNames[accRev] || 'Ventas', desc: `Base ${doc}`, debe: 0, haber: base });
            if (vat > 0) entries.push({ id: asientoId, date, type: 'FACTURA', doc, account: '47700000', name: 'H.P. IVA Repercutido', desc: `IVA ${doc}`, debe: 0, haber: vat });
            asientoId++;

            entries.push({ id: asientoId, date, type: 'COBRO', doc, account: accTreasury, name: accountNames[accTreasury] || 'Tesorería', desc: `Cobro ${doc}`, debe: total, haber: 0 });
            entries.push({ id: asientoId, date, type: 'COBRO', doc, account: accCli, name: client, desc: `Cobro ${doc}`, debe: 0, haber: total });
            asientoId++;
        });

        // GASTOS
        (expRes.data || []).forEach(exp => {
            const date = exp.issue_date; const doc = safeStr(exp.provider_invoice_number || 'S/N');
            const prov = safeStr(exp.provider_name || 'Proveedor'); const type = safeStr(exp.expense_type_label);
            const total = toNum(exp.total_payment); const base = toNum(exp.tax_base); const vat = toNum(exp.vat_quota);

            let accExp = expenseTypes[type.toLowerCase()] || '62900000';
            if(!expenseTypes[type.toLowerCase()]) errors.push({ date, doc, concept: type, amount: total });

            const accProv = getAuxAccount(prov, '410');
            const accTreasury = TREASURY_MAP[safeStr(exp.payment_method)] || TREASURY_MAP['default'];

            entries.push({ id: asientoId, date, type: 'FACTURA', doc, account: accExp, name: accountNames[accExp] || type, desc: `Gasto ${doc}`, debe: base, haber: 0 });
            if (vat > 0) entries.push({ id: asientoId, date, type: 'FACTURA', doc, account: '47200000', name: 'H.P. IVA Soportado', desc: `IVA ${doc}`, debe: vat, haber: 0 });
            entries.push({ id: asientoId, date, type: 'FACTURA', doc, account: accProv, name: prov, desc: `Fra. ${doc}`, debe: 0, haber: total });
            asientoId++;

            entries.push({ id: asientoId, date, type: 'PAGO', doc, account: accProv, name: prov, desc: `Pago ${doc}`, debe: total, haber: 0 });
            entries.push({ id: asientoId, date, type: 'PAGO', doc, account: accTreasury, name: accountNames[accTreasury] || 'Tesorería', desc: `Pago ${doc}`, debe: 0, haber: total });
            asientoId++;
        });

        // MAYOR
        const ledgerMap = {};
        entries.forEach(e => {
            if (!ledgerMap[e.account]) ledgerMap[e.account] = { code: e.account, name: e.name, debe: 0, haber: 0, saldo: 0 };
            ledgerMap[e.account].debe += e.debe;
            ledgerMap[e.account].haber += e.haber;
            ledgerMap[e.account].saldo = ledgerMap[e.account].debe - ledgerMap[e.account].haber;
        });

        setJournalEntries(entries.sort((a, b) => new Date(b.date) - new Date(a.date) || b.id - a.id));
        setLedger(ledgerMap);
        setMappingErrors(errors);
        setLoading(false);

      } catch (err) { setError(err.message); setLoading(false); }
    }
    processAccounting();
    return () => { isMounted = false; };
  }, [year]);

  // 2. FILTRADO
  const filteredData = useMemo(() => {
      const term = searchTerm.toLowerCase();
      if (activeTab === 'ledger') {
          return Object.values(ledger).filter(a => a.code.includes(term) || a.name.toLowerCase().includes(term));
      }
      return journalEntries.filter(e => safeStr(e.account).includes(term) || safeStr(e.name).toLowerCase().includes(term) || safeStr(e.doc).toLowerCase().includes(term));
  }, [journalEntries, ledger, searchTerm, activeTab]);

  // 3. EXPORTAR PDF INTELIGENTE
  const handleExportPDF = () => {
    const doc = new jsPDF();
    
    if (activeTab === 'ledger') {
        // --- PDF LIBRO MAYOR ---
        doc.setFontSize(16); doc.text(`LIBRO MAYOR (SALDOS) - ${year}`, 14, 15);
        doc.setFontSize(10); doc.text(`Fecha: ${new Date().toLocaleDateString()}`, 14, 22);

        const rows = filteredData.sort((a,b) => a.code.localeCompare(b.code)).map(acc => [
            acc.code, acc.name.substring(0, 40), currency(acc.debe), currency(acc.haber), currency(acc.saldo)
        ]);

        // Totales
        const tDebe = filteredData.reduce((s, a) => s + a.debe, 0);
        const tHaber = filteredData.reduce((s, a) => s + a.haber, 0);

        autoTable(doc, {
            startY: 30,
            head: [['CUENTA', 'NOMBRE', 'SUMA DEBE', 'SUMA HABER', 'SALDO FINAL']],
            body: rows,
            foot: [['', 'TOTALES:', currency(tDebe), currency(tHaber), currency(tDebe - tHaber)]],
            theme: 'grid',
            headStyles: { fillColor: [138, 90, 98] },
            columnStyles: { 2: {halign:'right'}, 3: {halign:'right'}, 4: {halign:'right'} }
        });
        doc.save(`Libro_Mayor_${year}.pdf`);

    } else {
        // --- PDF LIBRO DIARIO ---
        doc.setFontSize(16); doc.text(`LIBRO DIARIO - ${year}`, 14, 15);
        doc.setFontSize(10); doc.text("Asientos ordenados cronológicamente.", 14, 22);

        const rows = filteredData.map(e => [
            new Date(e.date).toLocaleDateString(), e.id, e.account, e.name.substring(0, 20), e.desc.substring(0, 25), currency(e.debe), currency(e.haber)
        ]);

        autoTable(doc, {
            startY: 30,
            head: [['FECHA', 'ASIENTO', 'CUENTA', 'NOMBRE', 'CONCEPTO', 'DEBE', 'HABER']],
            body: rows,
            theme: 'grid',
            headStyles: { fillColor: [138, 90, 98] },
            columnStyles: { 5: {halign:'right'}, 6: {halign:'right'} },
            styles: { fontSize: 8 }
        });
        doc.save(`Libro_Diario_${year}.pdf`);
    }
  };

  if (error) return <div className="flex h-screen items-center justify-center bg-[#fbf9f6] flex-col gap-4"><AlertTriangle size={48} className="text-red-500"/><p className="text-gray-600">{error}</p><button onClick={()=>window.location.reload()} className="px-4 py-2 bg-gray-800 text-white rounded">Reintentar</button></div>;

  return (
    <div className="flex h-screen overflow-hidden bg-[#fbf9f6] font-sans text-[#161313]">
      <Sidebar />
      <main className="flex-1 flex flex-col h-screen overflow-hidden relative">
        <header className="shrink-0 z-20 flex items-center justify-between border-b border-gray-200 bg-white/80 backdrop-blur-xl px-8 py-4">
          <div className="flex items-center gap-4"><div className="p-2 bg-[#8a5a62]/10 rounded-lg text-[#8a5a62]"><BookOpen size={24} /></div><div><h2 className="text-xl font-bold font-serif text-[#161313]">Contabilidad Analítica</h2><p className="text-xs text-gray-500">Motor de Partida Doble {year}</p></div></div>
          <div className="flex items-center gap-6"><Notifications /><div className="size-10 rounded-full bg-gray-200 border-2 border-white shadow-sm overflow-hidden"><img src="https://images.unsplash.com/photo-1559839734-2b71ea197ec2?q=80&w=2070&auto=format&fit=crop" alt="User" className="w-full h-full object-cover"/></div></div>
        </header>

        <div className="flex-1 overflow-y-auto p-8">
          <div className="max-w-[1400px] mx-auto w-full flex flex-col gap-6 h-full">
            <div className="flex flex-col md:flex-row justify-between items-center gap-4">
                <div className="bg-white/60 p-1.5 rounded-xl border border-gray-200 flex gap-1">
                    <button onClick={() => setActiveTab('journal')} className={`px-4 py-2 text-sm font-bold rounded-lg transition-all ${activeTab === 'journal' ? 'bg-white shadow text-[#8a5a62]' : 'text-gray-500 hover:bg-white/50'}`}>Libro Diario</button>
                    <button onClick={() => setActiveTab('ledger')} className={`px-4 py-2 text-sm font-bold rounded-lg transition-all ${activeTab === 'ledger' ? 'bg-white shadow text-[#8a5a62]' : 'text-gray-500 hover:bg-white/50'}`}>Libro Mayor</button>
                    {mappingErrors.length > 0 && <button onClick={() => setActiveTab('errors')} className={`px-4 py-2 text-sm font-bold rounded-lg transition-all flex items-center gap-2 ${activeTab === 'errors' ? 'bg-red-50 text-red-600' : 'text-red-400'}`}><AlertTriangle size={14}/> {mappingErrors.length}</button>}
                </div>
                <div className="flex gap-3">
                    <div className="flex items-center bg-white rounded-lg border border-gray-200 p-1">
                        <button onClick={() => setYear(y=>y-1)} className="p-2 hover:bg-gray-50 rounded-md"><ChevronLeft size={16}/></button><span className="px-3 font-bold text-sm text-gray-700">{year}</span><button onClick={() => setYear(y=>y+1)} className="p-2 hover:bg-gray-50 rounded-md"><ChevronRight size={16}/></button>
                    </div>
                    <div className="relative"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/><input value={searchTerm} onChange={e=>setSearchTerm(e.target.value)} placeholder="Filtrar..." className="pl-9 pr-3 py-2 bg-white border border-gray-200 rounded-lg text-sm w-64 focus:outline-none focus:border-[#8a5a62]"/></div>
                    <button onClick={handleExportPDF} className="flex items-center gap-2 bg-[#8a5a62] text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-[#754a52] transition-colors"><Download size={16}/> {activeTab === 'ledger' ? 'PDF Mayor' : 'PDF Diario'}</button>
                </div>
            </div>

            {activeTab === 'journal' && (
                <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden flex-1 flex flex-col">
                    <div className="overflow-auto flex-1">
                        <table className="w-full text-left border-collapse text-sm">
                            <thead className="bg-[#faf9f6] sticky top-0 z-10 text-xs font-bold text-gray-500 uppercase tracking-wider border-b border-gray-200">
                                <tr><th className="px-6 py-3 w-32">Fecha</th><th className="px-4 py-3 w-20 text-center">Asiento</th><th className="px-4 py-3 w-24">Cuenta</th><th className="px-6 py-3">Nombre</th><th className="px-6 py-3">Concepto</th><th className="px-6 py-3 text-right">Debe</th><th className="px-6 py-3 text-right">Haber</th></tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {loading ? <tr><td colSpan="7" className="p-12 text-center"><Loader2 className="animate-spin mx-auto"/></td></tr> : filteredData.map((e, i) => (
                                    <tr key={i} className={`hover:bg-gray-50 ${e.id % 2 === 0 ? 'bg-white' : 'bg-[#faf9f6]/30'}`}>
                                        <td className="px-6 py-2 text-gray-500 font-mono text-xs">{new Date(e.date).toLocaleDateString()}</td>
                                        <td className="px-4 py-2 text-center font-bold text-[#8a5a62]">{e.id}</td>
                                        <td className="px-4 py-2 font-mono text-xs text-gray-600 font-bold">{e.account}</td>
                                        <td className="px-6 py-2 text-gray-800 font-medium">{e.name}</td>
                                        <td className="px-6 py-2 text-gray-500 text-xs truncate max-w-xs">{e.desc}</td>
                                        <td className={`px-6 py-2 text-right font-mono ${e.debe > 0 ? 'text-gray-900 font-bold' : 'text-gray-300'}`}>{e.debe > 0 ? currency(e.debe) : '-'}</td>
                                        <td className={`px-6 py-2 text-right font-mono ${e.haber > 0 ? 'text-gray-900 font-bold' : 'text-gray-300'}`}>{e.haber > 0 ? currency(e.haber) : '-'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {activeTab === 'ledger' && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {loading ? <div className="col-span-3 text-center p-12 text-gray-400"><Loader2 className="animate-spin mx-auto"/></div> :
                    filteredData.sort((a,b) => a.code.localeCompare(b.code)).map((acc) => (
                        <div key={acc.code} className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
                            <div className="flex justify-between items-start mb-4">
                                <div><span className="text-xs font-bold bg-gray-100 text-gray-600 px-2 py-1 rounded font-mono">{acc.code}</span><h4 className="font-bold text-gray-800 mt-2 truncate max-w-[200px]" title={acc.name}>{acc.name}</h4></div>
                                <div className={`p-2 rounded-full ${acc.saldo >= 0 ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}`}><ArrowRightLeft size={18}/></div>
                            </div>
                            <div className="space-y-2 text-sm border-t pt-3">
                                <div className="flex justify-between text-gray-500"><span>Debe:</span> <span className="font-mono text-gray-700">{currency(acc.debe)}</span></div>
                                <div className="flex justify-between text-gray-500"><span>Haber:</span> <span className="font-mono text-gray-700">{currency(acc.haber)}</span></div>
                                <div className="border-t pt-2 mt-2 flex justify-between font-bold text-base"><span>Saldo:</span> <span className={acc.saldo >= 0 ? 'text-green-700' : 'text-red-600'}>{currency(acc.saldo)}</span></div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {activeTab === 'errors' && (
                <div className="bg-red-50 border border-red-100 rounded-2xl p-8">
                    <h3 className="text-red-800 font-bold text-lg mb-4 flex items-center gap-2"><AlertTriangle/> Movimientos sin Mapeo</h3>
                    <div className="bg-white rounded-xl overflow-hidden border border-red-100"><table className="w-full text-sm"><thead className="bg-red-100/50 text-red-900"><tr><th className="p-4 text-left">Fecha</th><th className="p-4 text-left">Concepto</th><th className="p-4 text-right">Importe</th></tr></thead><tbody>{mappingErrors.map((err, i) => (<tr key={i} className="border-b border-red-50"><td className="p-4 text-gray-600">{new Date(err.date).toLocaleDateString()}</td><td className="p-4 font-bold text-gray-800">{err.concept}</td><td className="p-4 text-right font-mono">{currency(err.amount)}</td></tr>))}</tbody></table></div>
                </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}