import React, { useState, useEffect, useMemo } from 'react';
import Sidebar from '../components/Sidebar';
import Notifications from '../components/Notifications';
import { supabase } from '../supabaseClient';
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { 
  Search, FileText, Calendar, TrendingUp, AlertCircle, 
  FlaskConical, Stethoscope, Megaphone, ChevronRight, ChevronLeft, ChevronDown, 
  Zap, Building, Truck, Loader2, Lock
} from 'lucide-react';

export default function Expenses() {
  const [loading, setLoading] = useState(true);
  const [expenses, setExpenses] = useState([]);
  
  // ESTADO DE PERIODO
  const [period, setPeriod] = useState({
    year: new Date().getFullYear(),
    month: 'all' 
  });
  const [isMonthSelectorOpen, setIsMonthSelectorOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

  // 1. CARGA INICIAL
  useEffect(() => {
    fetchExpenses();
  }, []);

  const fetchExpenses = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('expenses')
        .select('*')
        .order('issue_date', { ascending: false });

      if (error) throw error;
      
      const loadedData = data || [];
      setExpenses(loadedData);

      // Auto-ajuste de año inicial
      if (loadedData.length > 0) {
          const years = [...new Set(loadedData.map(d => new Date(d.issue_date).getFullYear()))];
          const maxYear = Math.max(...years);
          // Si estamos en un año sin datos, saltamos al más reciente
          const currentHasData = years.includes(period.year);
          if (!currentHasData && maxYear) {
             setPeriod({ year: maxYear, month: 'all' });
          }
      }

    } catch (err) {
      console.error("Error cargando gastos:", err);
    } finally {
      setLoading(false);
    }
  };

  // 2. CÁLCULO DE AÑOS Y MESES DISPONIBLES (Para bloquear navegación)
  const availableYears = useMemo(() => {
      if (expenses.length === 0) return [new Date().getFullYear()];
      const years = new Set(expenses.map(e => new Date(e.issue_date).getFullYear()));
      return Array.from(years).sort((a,b) => a - b);
  }, [expenses]);

  const availableMonths = useMemo(() => {
      // Filtramos gastos del año seleccionado
      const currentYearExpenses = expenses.filter(e => new Date(e.issue_date).getFullYear() === period.year);
      // Obtenemos los índices de los meses (0-11) que tienen datos
      const months = new Set(currentYearExpenses.map(e => new Date(e.issue_date).getMonth()));
      return months;
  }, [expenses, period.year]);

  // AUTO-CORRECCIÓN: Si cambiamos de año y el mes seleccionado no tiene datos, volver a "Todo el año"
  useEffect(() => {
      if (period.month !== 'all' && !availableMonths.has(period.month)) {
          setPeriod(p => ({ ...p, month: 'all' }));
      }
  }, [period.year, availableMonths]);


  // 3. FILTRADO Y AGRUPACIÓN
  const { filteredExpenses, groups, stats, chartData } = useMemo(() => {
    if (!expenses || expenses.length === 0) {
        return { 
            filteredExpenses: [], groups: [], chartData: [],
            stats: { total: 0, maxCategory: { title: '---', total: 0 }, pendingInvoices: 0 }
        };
    }

    let result = expenses;

    // A. Filtros
    result = result.filter(exp => {
        if (!exp.issue_date) return false;
        const d = new Date(exp.issue_date);
        const matchYear = d.getFullYear() === period.year;
        const matchMonth = period.month === 'all' || d.getMonth() === period.month;
        return matchYear && matchMonth;
    });

    if (searchTerm) {
        const lower = searchTerm.toLowerCase();
        result = result.filter(exp => 
            (exp.provider_name && exp.provider_name.toLowerCase().includes(lower)) ||
            (exp.expense_type_label && exp.expense_type_label.toLowerCase().includes(lower))
        );
    }

    // B. Agrupación
    const grouped = {};
    let totalAmount = 0;

    result.forEach(exp => {
        let catRaw = exp.expense_type_label || 'Otros Gastos';
        const cat = catRaw.charAt(0).toUpperCase() + catRaw.slice(1).toLowerCase();

        if (!grouped[cat]) {
            grouped[cat] = {
                title: cat,
                total: 0,
                items: [],
                icon: getCategoryIcon(cat), 
                color: getCategoryColor(cat) 
            };
        }
        grouped[cat].items.push(exp);
        const amount = Number(exp.total_payment) || 0;
        grouped[cat].total += amount;
        totalAmount += amount;
    });

    const groupsArray = Object.values(grouped).sort((a, b) => b.total - a.total);

    // C. Datos Gráfico
    let cumulativePercent = 0;
    const chartSegments = groupsArray.map((g) => {
        const percent = totalAmount > 0 ? (g.total / totalAmount) * 100 : 0;
        const segment = {
            ...g,
            percent: isNaN(percent) ? 0 : percent,
            offset: cumulativePercent,
            strokeColor: g.color.hex 
        };
        cumulativePercent += percent; 
        return segment;
    });

    const maxCategory = groupsArray[0] || { title: '---', total: 0 };
    const pendingInvoices = result.filter(e => !e.payment_date || e.payment_method === 'Pendiente').length;

    return { 
        filteredExpenses: result, 
        groups: groupsArray, 
        stats: { total: totalAmount, maxCategory, pendingInvoices },
        chartData: chartSegments
    };
  }, [expenses, period, searchTerm]);


  // --- EXPORTAR PDF ---
  const handleExportPDF = () => {
    try {
        if (groups.length === 0) {
            alert("No hay datos para exportar en este periodo.");
            return;
        }

        const doc = new jsPDF();
        const currentLabel = period.month === 'all' ? `Ejercicio ${period.year}` : `${monthNames[period.month]} ${period.year}`;

        doc.setFontSize(18);
        doc.setTextColor(40, 40, 40);
        doc.text("Reporte de Gastos Clínicos", 14, 20);
        
        doc.setFontSize(11);
        doc.setTextColor(100);
        doc.text(`Periodo: ${currentLabel}`, 14, 28);
        doc.text(`Total Gastos: ${formatCurrency(stats.total)}`, 14, 34);

        let lastY = 40;

        groups.forEach(group => {
            if (lastY > 250) { doc.addPage(); lastY = 20; }

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text(`${group.title} (${formatCurrency(group.total)})`, 14, lastY + 10);

            const tableBody = group.items.map(item => [
                formatDate(item.issue_date),
                item.provider_name || 'Desconocido',
                item.provider_invoice_number || 'S/N',
                item.payment_method || 'General',
                formatCurrency(item.total_payment)
            ]);

            autoTable(doc, {
                startY: lastY + 15,
                head: [['Fecha', 'Proveedor', 'Nº Factura', 'Método', 'Importe']],
                body: tableBody,
                theme: 'grid',
                headStyles: { fillColor: [240, 240, 240], textColor: [50, 50, 50], fontStyle: 'bold' },
                styles: { fontSize: 9 },
                columnStyles: { 4: { halign: 'right' } }
            });

            lastY = doc.lastAutoTable.finalY + 5;
        });

        const pageCount = doc.internal.getNumberOfPages();
        for(let i = 1; i <= pageCount; i++) {
            doc.setPage(i);
            doc.setFontSize(8);
            doc.setTextColor(150);
            doc.text(`Página ${i} de ${pageCount}`, 190, 285, { align: 'right' });
        }

        doc.save(`gastos_${period.year}_${period.month}.pdf`);

    } catch (error) {
        console.error("Error generando PDF:", error);
    }
  };


  // HANDLERS
  const changeYear = (delta) => {
      const newYear = period.year + delta;
      if (availableYears.includes(newYear)) {
          setPeriod(p => ({ ...p, year: newYear }));
      }
  };
  
  const selectMonth = (m) => { setPeriod(p => ({ ...p, month: m })); setIsMonthSelectorOpen(false); };
  
  const formatCurrency = (val) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(val || 0);
  const formatCompact = (val) => val >= 1000 ? (val / 1000).toFixed(1) + 'k' : (val || 0);
  const formatDate = (dateStr) => {
      if(!dateStr) return "-";
      return new Date(dateStr).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
  }
  
  const currentLabel = period.month === 'all' ? `Todo el año ${period.year}` : `${monthNames[period.month]} ${period.year}`;
  const canGoPrev = availableYears.includes(period.year - 1);
  const canGoNext = availableYears.includes(period.year + 1);

  return (
    <div className="flex h-screen overflow-hidden bg-background font-sans text-[#161313]">
      <Sidebar />
      <main className="flex-1 flex flex-col relative overflow-hidden h-full bg-background">
        
        {/* HEADER */}
        <header className="h-20 bg-background/95 backdrop-blur-md border-b border-border/20 px-8 flex items-center justify-between sticky top-0 z-20 shrink-0">
          <div className="flex items-center gap-2 text-sm text-text/60">
            <span>Finanzas</span><ChevronRight size={14} /><span className="font-medium text-text">Gastos</span>
          </div>
          <div className="flex items-center gap-6">
            <div className="relative hidden md:block group">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text/40 pointer-events-none"><Search size={18} /></span>
              <input className="bg-white border border-border/50 pl-10 pr-4 py-2 rounded-xl text-sm focus:outline-none focus:border-primary/50 w-64 placeholder:text-text/30 transition-all shadow-sm" placeholder="Buscar proveedor..." type="text" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
            </div>
            <Notifications />
            <div className="size-9 rounded-full bg-cover bg-center border-2 border-white shadow-sm" style={{backgroundImage: "url('https://images.unsplash.com/photo-1559839734-2b71ea197ec2?q=80&w=2070&auto=format&fit=crop')"}}></div>
          </div>
        </header>

        {/* CONTENIDO */}
        <div className="flex-1 overflow-y-auto p-8 scroll-smooth">
          <div className="max-w-7xl mx-auto flex flex-col gap-8">
            
            {/* TÍTULO Y SELECTOR */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
              <div>
                <h1 className="text-3xl font-black text-text font-serif">Control de Gastos</h1>
                <p className="text-text/60 mt-1 flex items-center gap-2">
                    <Calendar size={18} /> Resumen financiero - <span className="font-bold text-primary">{currentLabel}</span>
                </p>
              </div>
              
              {/* SELECTOR DE PERIODO BLINDADO */}
              <div className="flex gap-3 items-center">
                <div className="flex items-center gap-2 bg-white p-1 rounded-xl shadow-sm border border-border/10 relative">
                    <div className="flex items-center border-r border-border/10 pr-2">
                        <button 
                            onClick={() => changeYear(-1)} 
                            disabled={!canGoPrev}
                            className={`p-2 rounded-lg ${canGoPrev ? 'hover:bg-gray-100 text-text/60' : 'text-gray-200 cursor-not-allowed'}`}
                        >
                            <ChevronLeft size={16}/>
                        </button>
                        <span className="font-bold text-text px-2">{period.year}</span>
                        <button 
                            onClick={() => changeYear(1)} 
                            disabled={!canGoNext}
                            className={`p-2 rounded-lg ${canGoNext ? 'hover:bg-gray-100 text-text/60' : 'text-gray-200 cursor-not-allowed'}`}
                        >
                            <ChevronRight size={16}/>
                        </button>
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
                                    {monthNames.map((m, i) => {
                                        const isAvailable = availableMonths.has(i);
                                        return (
                                            <button 
                                                key={i} 
                                                onClick={() => isAvailable && selectMonth(i)} 
                                                disabled={!isAvailable}
                                                className={`px-2 py-2 rounded-md text-xs text-center transition-colors ${
                                                    period.month === i ? 'bg-primary text-white shadow-md' : 
                                                    isAvailable ? 'hover:bg-gray-50 text-text/70' : 'text-gray-300 cursor-not-allowed'
                                                }`}
                                            >
                                                {m.substring(0,3)}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
                
                <button onClick={handleExportPDF} className="flex items-center gap-2 px-5 py-2.5 bg-primary text-white rounded-xl text-sm font-bold hover:bg-primary/90 shadow-sm transition-all active:scale-95">
                    <FileText size={18} /> Exportar PDF
                </button>
              </div>
            </div>

            {/* TARJETAS RESUMEN */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <SummaryCard label={`Total Gastos`} value={formatCurrency(stats.total)} subtext="en el periodo seleccionado" isAlert={false} />
              <SummaryCard 
                label="Mayor Categoría" 
                value={stats.maxCategory.title} 
                subtext={stats.total > 0 ? `${((stats.maxCategory.total / stats.total) * 100).toFixed(1)}% del total` : 'Sin datos'} 
              />
              <SummaryCard label="Facturas Pendientes" value={stats.pendingInvoices} action="Ver listado" />
            </div>

            {/* CONTENIDO PRINCIPAL */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
              
              {/* LISTA DE GRUPOS */}
              <div className="lg:col-span-2 flex flex-col gap-6">
                {loading ? (
                    <div className="h-64 flex items-center justify-center text-primary"><Loader2 size={40} className="animate-spin"/></div>
                ) : groups.length === 0 ? (
                    <div className="p-16 text-center bg-white rounded-2xl border border-dashed border-border/30">
                        <Filter size={48} className="mx-auto text-gray-300 mb-4"/>
                        <p className="text-gray-400 text-lg font-medium">No hay gastos registrados</p>
                        <p className="text-gray-300 text-sm mt-1">Prueba a seleccionar "Todo el Año" o cambiar de año.</p>
                    </div>
                ) : (
                    groups.map((group, idx) => (
                        <ExpenseGroup 
                            key={idx} 
                            title={group.title} 
                            count={`${group.items.length} facturas`} 
                            icon={group.icon} 
                            color={group.color.text} 
                            bgColor={group.color.bg} 
                            total={formatCurrency(group.total)}
                        >
                            {group.items.map((item, i) => (
                                <ExpenseItem 
                                    key={i} 
                                    title={item.provider_name} 
                                    date={`${formatDate(item.issue_date)} • ${item.provider_invoice_number || 'S/N'}`} 
                                    amount={formatCurrency(item.total_payment)} 
                                    status={item.payment_date || 'Registrado'} 
                                    statusColor={item.payment_date ? 'text-green-600 bg-green-50' : 'text-gray-500 bg-gray-50'} 
                                />
                            ))}
                        </ExpenseGroup>
                    ))
                )}
              </div>

              {/* GRÁFICO DINÁMICO */}
              <div className="lg:col-span-1">
                <div className="bg-white rounded-2xl shadow-sm border border-border/20 p-6 sticky top-24">
                  <h2 className="text-lg font-bold text-text mb-6">Distribución de Gastos</h2>
                  
                  {stats.total > 0 && chartData.length > 0 ? (
                      <div className="relative aspect-square max-w-[220px] mx-auto mb-8 animate-in fade-in zoom-in duration-500">
                        <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                            <circle cx="50" cy="50" r="40" fill="transparent" stroke="#f3f4f6" strokeWidth="20" />
                            {chartData.map((seg, i) => {
                                const circ = 251.3;
                                const pct = isNaN(seg.percent) ? 0 : seg.percent;
                                const offsetVal = isNaN(seg.offset) ? 0 : seg.offset;
                                
                                const strokeLen = (pct / 100) * circ;
                                const strokeGap = circ - strokeLen;
                                const offset = (offsetVal / 100) * circ;

                                return (
                                    <circle key={i} cx="50" cy="50" r="40" fill="transparent" stroke={seg.strokeColor} strokeWidth="20" strokeDasharray={`${strokeLen} ${strokeGap}`} strokeDashoffset={-offset} className="transition-all duration-500 ease-out hover:opacity-80"/>
                                );
                            })}
                        </svg>
                        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                            <span className="text-xs text-text/40 font-bold uppercase tracking-wider">Total</span>
                            <span className="text-xl font-black text-text">{formatCompact(stats.total)}€</span>
                        </div>
                      </div>
                  ) : (
                      <div className="aspect-square max-w-[200px] mx-auto mb-8 flex items-center justify-center rounded-full bg-gray-50 border-2 border-dashed border-gray-200"><p className="text-xs text-gray-400">Sin datos</p></div>
                  )}

                  <div className="flex flex-col gap-3 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                    {chartData.map((seg, i) => (
                        <LegendItem key={i} color={seg.color.bg.replace('/10', '')} styleColor={seg.strokeColor} label={seg.title} pct={`${seg.percent.toFixed(1)}%`} value={formatCompact(seg.total)} />
                    ))}
                  </div>
                </div>
              </div>

            </div>
          </div>
        </div>
      </main>
      
      {isMonthSelectorOpen && <div className="fixed inset-0 z-40" onClick={() => setIsMonthSelectorOpen(false)}></div>}
    </div>
  );
}

// --- UTILIDADES ---
function getCategoryIcon(cat) {
    const c = cat.toLowerCase();
    if (c.includes('lab')) return <FlaskConical size={20} />;
    if (c.includes('mat') || c.includes('clín') || c.includes('medic')) return <Stethoscope size={20} />;
    if (c.includes('publi') || c.includes('mark')) return <Megaphone size={20} />;
    if (c.includes('sumin') || c.includes('luz') || c.includes('agua') || c.includes('elect')) return <Zap size={20} />;
    if (c.includes('alq') || c.includes('local') || c.includes('rent')) return <Building size={20} />;
    return <Truck size={20} />; 
}

function getCategoryColor(cat) {
    const c = cat.toLowerCase();
    if (c.includes('lab')) return { text: 'text-blue-600', bg: 'bg-blue-50', hex: '#2563EB' };
    if (c.includes('mat')) return { text: 'text-teal-600', bg: 'bg-teal-50', hex: '#0D9488' };
    if (c.includes('publi')) return { text: 'text-purple-600', bg: 'bg-purple-50', hex: '#9333EA' };
    if (c.includes('sumin')) return { text: 'text-yellow-600', bg: 'bg-yellow-50', hex: '#CA8A04' };
    if (c.includes('alq')) return { text: 'text-rose-600', bg: 'bg-rose-50', hex: '#E11D48' };
    return { text: 'text-gray-600', bg: 'bg-slate-100', hex: '#64748B' }; 
}

// --- SUBCOMPONENTES ---
function SummaryCard({ label, value, trend, subtext, action, isAlert }) { return (<div className="bg-white p-5 rounded-2xl border border-border/20 flex flex-col gap-1 shadow-sm"><span className="text-text/60 text-sm">{label}</span><div className="flex items-baseline gap-2"><span className="text-2xl font-bold text-text">{value}</span>{trend && <span className={`text-xs px-1.5 rounded flex items-center ${isAlert ? 'text-red-500 bg-red-50' : 'text-green-500 bg-green-50'}`}><TrendingUp size={12} /> {trend}</span>}</div>{subtext && <span className="text-xs text-text/60">{subtext}</span>}</div>); }

function ExpenseGroup({ title, count, icon, color, bgColor, total, children }) { 
    return (
        <div className="bg-white rounded-2xl border border-border/20 overflow-hidden shadow-sm transition-all hover:shadow-md">
            <div className="px-6 py-4 bg-[#faf9f6] border-b border-border/10 flex justify-between items-center">
                <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${bgColor} ${color}`}>{icon}</div>
                    <h3 className="font-bold text-text">{title}</h3>
                </div>
                <span className="text-xs font-mono bg-white px-2 py-1 rounded border border-border/10 text-text/60">{count}</span>
            </div>
            <div className="flex flex-col max-h-[300px] overflow-y-auto custom-scrollbar">
                {children}
            </div>
            <div className="px-6 py-3 bg-[#faf9f6] flex justify-between border-t border-border/10">
                <span className="text-xs font-bold text-text/60 uppercase tracking-wider">Subtotal Categoría</span>
                <span className="font-bold text-text">{total}</span>
            </div>
        </div>
    ); 
}

function ExpenseItem({ title, date, amount, status, statusColor }) { 
    return (
        <div className="flex justify-between p-5 border-b border-border/10 hover:bg-gray-50 transition-colors cursor-pointer group last:border-b-0 shrink-0">
            <div className="flex flex-col">
                <span className="font-bold text-text text-sm group-hover:text-primary transition-colors">{title}</span>
                <span className="text-xs text-text/60">{date}</span>
            </div>
            <div className="text-right">
                <span className="font-bold text-text block">{amount}</span>
                <span className={`text-[10px] px-2 py-0.5 rounded-full inline-block font-medium mt-1 ${statusColor}`}>{status}</span>
            </div>
        </div>
    ); 
}

function LegendItem({ styleColor, label, pct, value }) { 
    return (
        <div className="flex justify-between items-center p-2 hover:bg-gray-50 rounded transition-colors cursor-default">
            <div className="flex items-center gap-2 overflow-hidden">
                <div className="w-3 h-3 rounded-full shadow-sm shrink-0" style={{backgroundColor: styleColor}}></div>
                <span className="text-sm text-text font-medium truncate" title={label}>{label}</span>
            </div>
            <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400">{value}€</span>
                <span className="text-xs font-bold text-text/60 bg-gray-100 px-1.5 py-0.5 rounded min-w-[40px] text-center">{pct}</span>
            </div>
        </div>
    ); 
}