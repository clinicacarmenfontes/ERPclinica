import React, { useState, useEffect, useMemo } from 'react';
import Sidebar from '../components/Sidebar';
import Notifications from '../components/Notifications';
import { supabase } from '../supabaseClient';
import { 
  Search, TrendingUp, Filter, Loader2, FileText, Calendar, 
  ChevronLeft, ChevronRight, ChevronDown, Download
} from 'lucide-react';

export default function Incomes() {
  const [loading, setLoading] = useState(true);
  const [invoices, setInvoices] = useState([]);
  
  // ESTADO DE PERIODO (Igual que en Dashboard)
  const [period, setPeriod] = useState({
    year: new Date().getFullYear(),
    month: new Date().getMonth() // Por defecto: Mes actual (0-11)
  });
  const [isMonthSelectorOpen, setIsMonthSelectorOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

  // 1. CARGA INICIAL (Traemos todo el año para filtrar en cliente rápido)
  useEffect(() => {
    fetchIncomes();
  }, []);

  const fetchIncomes = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('incomes')
        .select('*')
        .order('issue_date', { ascending: false });

      if (error) throw error;
      setInvoices(data || []);
    } catch (err) {
      console.error("Error cargando ingresos:", err);
    } finally {
      setLoading(false);
    }
  };

  // 2. FILTRADO Y CÁLCULOS (Memoizado)
  const { filteredInvoices, stats } = useMemo(() => {
    let result = invoices;

    // A. Filtro de Periodo
    result = result.filter(inv => {
        const d = new Date(inv.issue_date);
        const matchYear = d.getFullYear() === period.year;
        const matchMonth = period.month === 'all' || d.getMonth() === period.month;
        return matchYear && matchMonth;
    });

    // B. Filtro de Búsqueda
    if (searchTerm) {
        const lower = searchTerm.toLowerCase();
        result = result.filter(inv => 
            (inv.client_name && inv.client_name.toLowerCase().includes(lower)) ||
            (inv.invoice_number && inv.invoice_number.toLowerCase().includes(lower))
        );
    }

    // C. KPIs
    const total = result.reduce((sum, item) => sum + (item.total_amount || 0), 0);
    const count = result.length;
    const average = count > 0 ? total / count : 0;

    // Proyección (Si es mes actual, proyectamos. Si es pasado, es el total real)
    let projection = total;
    const now = new Date();
    const isCurrentMonth = period.year === now.getFullYear() && period.month === now.getMonth();
    
    if (isCurrentMonth) {
        const daysInMonth = new Date(period.year, period.month + 1, 0).getDate();
        const currentDay = now.getDate();
        if (currentDay > 0) projection = (total / currentDay) * daysInMonth;
    } else if (period.month === 'all' && period.year === now.getFullYear()) {
        // Proyección anual basada en meses transcurridos
        const currentMonthIdx = now.getMonth(); // 0-11
        if (currentMonthIdx > 0) projection = (total / (currentMonthIdx + 1)) * 12;
    }

    return { 
        filteredInvoices: result, 
        stats: { total, count, average, projection } 
    };
  }, [invoices, period, searchTerm]);


  // HANDLERS
  const changeYear = (delta) => setPeriod(p => ({ ...p, year: p.year + delta }));
  const selectMonth = (m) => { setPeriod(p => ({ ...p, month: m })); setIsMonthSelectorOpen(false); };
  
  const formatCurrency = (val) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(val);
  const formatDate = (dateStr) => new Date(dateStr).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
  const currentLabel = period.month === 'all' ? `Todo el año ${period.year}` : `${monthNames[period.month]} ${period.year}`;

  return (
    <div className="flex h-screen overflow-hidden bg-background font-sans text-[#161313]">
      <Sidebar />
      <main className="flex-1 flex flex-col relative overflow-hidden h-full bg-background">
        
        {/* HEADER */}
        <header className="h-20 bg-background/95 backdrop-blur-md border-b border-border/20 px-8 flex items-center justify-between sticky top-0 z-20 shrink-0">
          <div className="flex items-center gap-2 text-sm text-text/60">
            <span>Finanzas</span><span className="mx-2">/</span><span className="font-medium text-text">Ingresos</span>
          </div>
          <div className="flex items-center gap-6">
            <div className="relative hidden md:block group">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text/40 pointer-events-none"><Search size={18} /></span>
              <input className="bg-white border border-border/50 pl-10 pr-4 py-2 rounded-xl text-sm focus:outline-none focus:border-primary/50 w-64 placeholder:text-text/30 transition-all shadow-sm" placeholder="Buscar factura..." type="text" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
            </div>
            <Notifications />
            <div className="size-9 rounded-full bg-cover bg-center border-2 border-white shadow-sm" style={{backgroundImage: "url('https://images.unsplash.com/photo-1612349317150-e413f6a5b16d?q=80&w=2070&auto=format&fit=crop')"}}></div>
          </div>
        </header>

        {/* CONTENIDO */}
        <div className="flex-1 overflow-hidden p-8 flex flex-col gap-8">
          <div className="max-w-[1600px] mx-auto w-full flex flex-col gap-8 h-full">
            
            {/* Título y Selector */}
            <div className="flex flex-col md:flex-row justify-between items-end gap-4 shrink-0">
              <div>
                <h1 className="text-3xl font-black text-text font-serif">Ingresos Clínicos</h1>
                <p className="text-text/60 mt-1">Mostrando datos de: <span className="font-bold text-primary">{currentLabel}</span></p>
              </div>
              
              {/* SELECTOR DE FECHAS MEJORADO */}
              <div className="flex items-center gap-2 bg-white p-1 rounded-xl shadow-sm border border-border/10 relative">
                <div className="flex items-center border-r border-border/10 pr-2">
                    <button onClick={() => changeYear(-1)} className="p-2 hover:bg-gray-100 rounded-lg text-text/60"><ChevronLeft size={16}/></button>
                    <span className="font-bold text-text px-2">{period.year}</span>
                    <button onClick={() => changeYear(1)} className="p-2 hover:bg-gray-100 rounded-lg text-text/60"><ChevronRight size={16}/></button>
                </div>
                <div className="relative">
                    <button onClick={() => setIsMonthSelectorOpen(!isMonthSelectorOpen)} className="flex items-center gap-2 px-4 py-2 hover:bg-gray-50 rounded-lg transition-colors text-sm font-medium text-text min-w-[140px] justify-between">
                        <span className="flex items-center gap-2"><Calendar size={16} className="text-primary"/> {period.month === 'all' ? 'Todo el Año' : monthNames[period.month]}</span>
                        <ChevronDown size={14} className="text-text/40"/>
                    </button>
                    {isMonthSelectorOpen && (
                        <div className="absolute top-full right-0 mt-2 w-64 bg-white border border-border/10 shadow-xl rounded-xl p-2 z-50 animate-in fade-in zoom-in-95 duration-200">
                            <button onClick={() => selectMonth('all')} className={`w-full text-left px-3 py-2 rounded-lg text-sm mb-2 font-bold ${period.month === 'all' ? 'bg-primary/10 text-primary' : 'hover:bg-gray-50 text-text'}`}>Todo el Año</button>
                            <div className="grid grid-cols-3 gap-1">
                                {monthNames.map((m, i) => (
                                    <button key={i} onClick={() => selectMonth(i)} className={`px-2 py-2 rounded-md text-xs text-center transition-colors ${period.month === i ? 'bg-primary text-white shadow-md' : 'hover:bg-gray-50 text-text/70'}`}>{m.substring(0,3)}</button>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
              </div>
            </div>

            {/* KPIs */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 shrink-0">
              <SummaryCard title="Total Facturado" value={formatCurrency(stats.total)} pill={`${stats.count} facturas`} color="green" />
              <SummaryCard title="Ticket Medio" value={formatCurrency(stats.average)} pill="Por paciente" color="blue" />
              <SummaryCard title="Proyección Periodo" value={formatCurrency(stats.projection)} pill={period.month === 'all' ? "Anual Estimado" : "Mensual Estimado"} color="orange" />
            </div>

            {/* TABLA */}
            <div className="bg-white rounded-2xl border border-border/20 shadow-sm flex flex-col flex-1 overflow-hidden">
              <div className="px-6 py-4 border-b border-border/10 flex justify-between items-center bg-white shrink-0 z-10">
                  <h3 className="font-bold text-text flex items-center gap-2"><FileText size={18} className="text-gray-400"/> Listado de Facturas</h3>
                  <span className="text-xs text-text/40 font-mono bg-gray-50 px-2 py-1 rounded">{filteredInvoices.length} registros</span>
              </div>
              <div className="overflow-y-auto flex-1 relative">
                {loading ? (
                    <div className="absolute inset-0 flex items-center justify-center bg-white/80 z-20"><Loader2 size={40} className="animate-spin text-green-600"/></div>
                ) : (
                    <table className="w-full text-left border-collapse">
                        <thead className="sticky top-0 z-10 bg-[#f9f8f6] shadow-sm">
                            <tr>
                                <th className="py-3 px-6 text-xs font-bold text-text/50 uppercase tracking-wider w-32">Fecha</th>
                                <th className="py-3 px-6 text-xs font-bold text-text/50 uppercase tracking-wider w-32">Nº Factura</th>
                                <th className="py-3 px-6 text-xs font-bold text-text/50 uppercase tracking-wider">Paciente</th>
                                <th className="py-3 px-6 text-xs font-bold text-text/50 uppercase tracking-wider w-40">Método</th>
                                <th className="py-3 px-6 text-xs font-bold text-text/50 uppercase tracking-wider text-right w-32">Importe</th>
                                <th className="py-3 px-6 text-xs font-bold text-text/50 uppercase tracking-wider text-center w-24">Estado</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border/5">
                            {filteredInvoices.length === 0 ? (
                                <tr><td colSpan="6" className="p-16 text-center"><div className="flex flex-col items-center justify-center text-gray-300"><Filter size={48} className="mb-4 opacity-50"/><p className="text-lg font-medium text-gray-400">Sin facturas en este periodo</p></div></td></tr>
                            ) : (
                                filteredInvoices.map((inv) => (
                                    <tr key={inv.invoice_number} className="hover:bg-gray-50 transition-colors group">
                                        <td className="py-3 px-6 text-sm text-text/70">{formatDate(inv.issue_date)}</td>
                                        <td className="py-3 px-6 text-sm font-mono text-text/60">{inv.invoice_number}</td>
                                        <td className="py-3 px-6 text-sm font-bold text-text">{inv.client_name}</td>
                                        <td className="py-3 px-6 text-sm text-text/60"><span className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-600 border border-gray-200">{inv.payment_method || 'General'}</span></td>
                                        <td className="py-3 px-6 text-sm font-bold text-text text-right">{formatCurrency(inv.total_amount)}</td>
                                        <td className="py-3 px-6 text-center"><span className="inline-flex size-2 rounded-full bg-green-500" title="Cobrado"></span></td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
      
      {/* Click outside to close selector */}
      {isMonthSelectorOpen && <div className="fixed inset-0 z-40" onClick={() => setIsMonthSelectorOpen(false)}></div>}
    </div>
  );
}

function SummaryCard({ title, value, pill, color }) {
  const colors = { green: "text-green-700 bg-green-50 border-green-100", blue: "text-blue-700 bg-blue-50 border-blue-100", orange: "text-orange-700 bg-orange-50 border-orange-100" };
  return (
    <div className="bg-white p-6 rounded-2xl border border-border/20 shadow-sm hover:shadow-md transition-shadow">
      <p className="text-sm text-text/60 mb-1 font-medium">{title}</p>
      <h3 className="text-2xl font-black text-text tracking-tight mb-3">{value}</h3>
      <div className={`text-xs px-2.5 py-1 rounded-md inline-block font-bold border ${colors[color]}`}>{pill}</div>
    </div>
  );
}