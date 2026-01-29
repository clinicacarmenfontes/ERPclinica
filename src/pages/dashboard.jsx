import React, { useEffect, useState, useMemo } from 'react';
import Sidebar from '../components/Sidebar';
import Notifications from '../components/Notifications';
import { supabase } from '../supabaseClient';
import { 
  Search, Download, TrendingUp, ArrowRight, Wallet, Receipt, Package, User, MoreVertical, 
  ChevronLeft, ChevronRight, Calendar, ChevronDown, Check
} from 'lucide-react';

export default function Dashboard() {
  const [loading, setLoading] = useState(true);
  
  // ESTADO: PERIODO SELECCIONADO
  // month: 'all' para todo el año, o 0-11 para meses específicos
  const [period, setPeriod] = useState({
    year: new Date().getFullYear(),
    month: 'all' 
  });

  const [isMonthSelectorOpen, setIsMonthSelectorOpen] = useState(false);

  // DATOS
  const [rawIncomes, setRawIncomes] = useState([]);
  const [rawExpenses, setRawExpenses] = useState([]);

  // ESTADOS VISUALES
  const [kpis, setKpis] = useState({
    totalInvoiced: 0, totalExpense: 0, netProfit: 0, estimatedTax: 0,
    invoicedChange: 0, expenseChange: 0, profitChange: 0
  });
  const [chartData, setChartData] = useState([]);
  const [chartScale, setChartScale] = useState([]);
  const [transactions, setTransactions] = useState([]);

  // UTILIDADES
  const formatCurrency = (val) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(val);
  const formatCompact = (val) => val >= 1000 ? (val / 1000).toFixed(1) + 'k' : val;
  const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

  // 1. CARGA INICIAL
  useEffect(() => {
    async function loadData() {
      setLoading(true);
      try {
        const [inc, exp] = await Promise.all([
          supabase.from('incomes').select('issue_date, total_amount, client_name, invoice_number').order('issue_date', { ascending: false }),
          supabase.from('expenses').select('issue_date, total_payment, provider_name, expense_type_label').order('issue_date', { ascending: false })
        ]);
        setRawIncomes(inc.data || []);
        setRawExpenses(exp.data || []);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  // 2. MOTOR DE CÁLCULO (Se activa al cambiar PERIODO)
  useEffect(() => {
    if (rawIncomes.length === 0 && rawExpenses.length === 0 && !loading) return;
    calculateData();
  }, [period, rawIncomes, rawExpenses]);

  const calculateData = () => {
    const { year, month } = period;
    const isYearlyView = month === 'all';

    // --- A. FILTRADO ---
    const filterByPeriod = (data, targetYear, targetMonth) => {
        return data.filter(item => {
            const d = new Date(item.issue_date);
            const matchYear = d.getFullYear() === targetYear;
            const matchMonth = targetMonth === 'all' || d.getMonth() === targetMonth;
            return matchYear && matchMonth;
        });
    };

    const currentIncomes = filterByPeriod(rawIncomes, year, month);
    const currentExpenses = filterByPeriod(rawExpenses, year, month);

    // --- B. COMPARATIVA (Periodo Anterior) ---
    let prevYear = year;
    let prevMonth = month;

    if (isYearlyView) {
        prevYear = year - 1; // Comparar 2026 con 2025
    } else {
        if (month === 0) { // Si es Enero, comparamos con Diciembre del año pasado
            prevMonth = 11;
            prevYear = year - 1;
        } else {
            prevMonth = month - 1; // Si es Marzo, comparamos con Febrero
        }
    }

    const prevIncomes = filterByPeriod(rawIncomes, prevYear, prevMonth);
    const prevExpenses = filterByPeriod(rawExpenses, prevYear, prevMonth);

    // --- C. CÁLCULO KPIs ---
    const sum = (arr, key) => arr.reduce((acc, item) => acc + (item[key] || 0), 0);
    
    const curInv = sum(currentIncomes, 'total_amount');
    const curExp = sum(currentExpenses, 'total_payment');
    const prvInv = sum(prevIncomes, 'total_amount');
    const prvExp = sum(prevExpenses, 'total_payment');

    const calcChange = (curr, prev) => prev === 0 ? 0 : ((curr - prev) / Math.abs(prev)) * 100;

    setKpis({
        totalInvoiced: curInv,
        totalExpense: curExp,
        netProfit: curInv - curExp,
        estimatedTax: (curInv - curExp) > 0 ? (curInv - curExp) * 0.20 : 0,
        invoicedChange: calcChange(curInv, prvInv),
        expenseChange: calcChange(curExp, prvExp),
        profitChange: calcChange(curInv - curExp, prvInv - prvExp)
    });

    // --- D. GRÁFICO (Agrupación Dinámica) ---
    const chartMap = new Map();
    
    if (isYearlyView) {
        // VISTA ANUAL: 12 Barras (Meses)
        monthNames.forEach((m, idx) => chartMap.set(idx, { label: m.substring(0,3), fullLabel: m, ingresos: 0, gastos: 0 }));
        
        currentIncomes.forEach(i => { const d = new Date(i.issue_date); chartMap.get(d.getMonth()).ingresos += i.total_amount; });
        currentExpenses.forEach(e => { const d = new Date(e.issue_date); chartMap.get(d.getMonth()).gastos += e.total_payment; });

    } else {
        // VISTA MENSUAL: Días del mes (1 - 31)
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        for(let i = 1; i <= daysInMonth; i++) {
            chartMap.set(i, { label: `${i}`, fullLabel: `${i} ${monthNames[month]}`, ingresos: 0, gastos: 0 });
        }

        currentIncomes.forEach(i => { const d = new Date(i.issue_date); chartMap.get(d.getDate()).ingresos += i.total_amount; });
        currentExpenses.forEach(e => { const d = new Date(e.issue_date); chartMap.get(d.getDate()).gastos += e.total_payment; });
    }

    const chartArr = Array.from(chartMap.values());
    
    // Escala Y
    const maxVal = Math.max(...chartArr.map(m => Math.max(m.ingresos, m.gastos))) || 1000;
    const ceiling = Math.ceil(maxVal / 1000) * 1000;
    setChartScale([ceiling, ceiling * 0.75, ceiling * 0.5, ceiling * 0.25, 0]);

    setChartData(chartArr.map(m => ({
        ...m,
        incH: `${(m.ingresos / ceiling) * 100}%`,
        expH: `${(m.gastos / ceiling) * 100}%`
    })));

    // --- E. TRANSACCIONES ---
    const mix = [
        ...currentIncomes.map(i => ({ id: i.invoice_number, date: i.issue_date, title: i.client_name, cat: 'Ingreso', amount: i.total_amount, type: 'income', status: 'Cobrado' })),
        ...currentExpenses.map(e => ({ id: e.id || Math.random(), date: e.issue_date, title: e.provider_name, cat: e.expense_type_label, amount: e.total_payment, type: 'expense', status: 'Pagado' }))
    ].sort((a,b) => new Date(b.date) - new Date(a.date));
    
    setTransactions(mix);
  };

  // HANDLERS SELECTOR
  const changeYear = (delta) => setPeriod(p => ({ ...p, year: p.year + delta }));
  const selectMonth = (m) => { setPeriod(p => ({ ...p, month: m })); setIsMonthSelectorOpen(false); };
  
  const formatDate = (d) => new Date(d).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
  const currentLabel = period.month === 'all' ? `Todo el año ${period.year}` : `${monthNames[period.month]} ${period.year}`;

  return (
    <div className="flex h-screen overflow-hidden bg-background font-sans text-[#161313]">
      <Sidebar />
      <main className="flex-1 flex flex-col min-w-0 bg-background overflow-hidden">
        
        {/* HEADER */}
        <header className="h-20 px-8 flex items-center justify-between shrink-0 bg-background/95 backdrop-blur-sm z-10 sticky top-0 border-b border-border/20">
          <div className="flex-1 max-w-md">
            <div className="relative group">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-text/50 pointer-events-none"><Search size={20} /></span>
              <input className="w-full h-12 pl-11 pr-4 rounded-xl bg-white border border-transparent focus:border-border focus:ring-0 text-sm text-text placeholder:text-text/40 shadow-sm transition-all outline-none" placeholder="Buscar..." type="text"/>
            </div>
          </div>
          <div className="flex items-center gap-6 ml-4">
            <Notifications />
            <div className="size-10 rounded-full bg-cover bg-center ring-2 ring-white shadow-sm" style={{backgroundImage: "url('https://images.unsplash.com/photo-1612349317150-e413f6a5b16d?q=80&w=2070&auto=format&fit=crop')"}}></div>
          </div>
        </header>

        {/* CONTENIDO */}
        <div className="flex-1 overflow-y-auto px-8 pb-8 pt-6">
          <div className="max-w-[1200px] mx-auto flex flex-col gap-8">
            
            {/* BARRA DE TÍTULO Y SELECTOR DE FECHAS NUEVO */}
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h2 className="text-3xl font-bold text-text tracking-tight font-serif">Panel de Control</h2>
                <p className="text-text/60 mt-1">Resumen financiero</p>
              </div>
              
              {/* SELECTOR DE PERIODO PERSONALIZADO */}
              <div className="flex items-center gap-2 bg-white p-1 rounded-xl shadow-sm border border-border/10 relative">
                {/* Año */}
                <div className="flex items-center border-r border-border/10 pr-2">
                    <button onClick={() => changeYear(-1)} className="p-2 hover:bg-gray-100 rounded-lg text-text/60"><ChevronLeft size={16}/></button>
                    <span className="font-bold text-text px-2">{period.year}</span>
                    <button onClick={() => changeYear(1)} className="p-2 hover:bg-gray-100 rounded-lg text-text/60"><ChevronRight size={16}/></button>
                </div>
                
                {/* Mes / Todo el Año */}
                <div className="relative">
                    <button onClick={() => setIsMonthSelectorOpen(!isMonthSelectorOpen)} className="flex items-center gap-2 px-4 py-2 hover:bg-gray-50 rounded-lg transition-colors text-sm font-medium text-text min-w-[140px] justify-between">
                        <span className="flex items-center gap-2"><Calendar size={16} className="text-primary"/> {period.month === 'all' ? 'Todo el Año' : monthNames[period.month]}</span>
                        <ChevronDown size={14} className="text-text/40"/>
                    </button>

                    {/* Dropdown de Meses */}
                    {isMonthSelectorOpen && (
                        <div className="absolute top-full right-0 mt-2 w-64 bg-white border border-border/10 shadow-xl rounded-xl p-2 z-50 animate-in fade-in zoom-in-95 duration-200">
                            <button onClick={() => selectMonth('all')} className={`w-full text-left px-3 py-2 rounded-lg text-sm mb-2 font-bold ${period.month === 'all' ? 'bg-primary/10 text-primary' : 'hover:bg-gray-50 text-text'}`}>
                                Todo el Año
                            </button>
                            <div className="grid grid-cols-3 gap-1">
                                {monthNames.map((m, i) => (
                                    <button key={i} onClick={() => selectMonth(i)} className={`px-2 py-2 rounded-md text-xs text-center transition-colors ${period.month === i ? 'bg-primary text-white shadow-md' : 'hover:bg-gray-50 text-text/70'}`}>
                                        {m.substring(0,3)}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
                
                <div className="w-px h-6 bg-border/10 mx-1"></div>
                <button className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-bold shadow-md hover:bg-primary/90 transition-all">
                  <Download size={16} /><span>Exportar</span>
                </button>
              </div>
            </div>

            {/* KPIs */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <KpiCard title="Facturación" value={formatCurrency(kpis.totalInvoiced)} change={kpis.invoicedChange} icon={<TrendingUp size={20} />} color="green" label="vs periodo anterior"/>
              <KpiCard title="Gastos" value={formatCurrency(kpis.totalExpense)} change={kpis.expenseChange} icon={<ArrowRight size={20} />} color="orange" label="vs periodo anterior" inverse={true}/>
              <KpiCard title="Beneficio Neto" value={formatCurrency(kpis.netProfit)} change={kpis.profitChange} icon={<Wallet size={20} />} color="primary" label="Margen operativo"/>
              <KpiCard title="Impuestos (Est.)" value={formatCurrency(kpis.estimatedTax)} change={0} icon={<Receipt size={20} />} color="gray" label="20% Estimado"/>
            </div>

            {/* GRÁFICO DINÁMICO */}
            <div className="bg-white p-8 rounded-xl border border-border/20 shadow-sm">
              <div className="flex flex-wrap justify-between items-center mb-8">
                <div><h3 className="text-lg font-bold text-text">Evolución: <span className="text-primary">{currentLabel}</span></h3></div>
                <div className="flex items-center gap-6"><LegendItem color="bg-primary" label="Ingresos" /><LegendItem color="bg-secondary" label="Gastos" /></div>
              </div>
              <div className="w-full h-[320px] flex flex-col justify-end relative pl-12 pb-8">
                {/* Eje Y */}
                <div className="absolute inset-0 flex flex-col justify-between pointer-events-none pb-8 pl-12">
                  {chartScale.map((val, idx) => (
                    <div key={idx} className="w-full border-t border-dashed border-gray-200 h-0 relative">
                        <span className="absolute -left-12 -top-2.5 text-xs text-text/40 w-10 text-right">{formatCompact(val)}</span>
                    </div>
                  ))}
                </div>
                {/* Barras (Con scroll horizontal si es necesario) */}
                <div className="w-full h-full overflow-x-auto overflow-y-hidden z-10 relative">
                    <div className="flex items-end h-full px-2 gap-2 min-w-full w-max justify-around">
                      {chartData.map((d, i) => (
                          <ChartBarGroup 
                            key={i} 
                            label={d.label} 
                            fullLabel={d.fullLabel}
                            incomeHeight={d.incH} 
                            expenseHeight={d.expH} 
                            incomeVal={formatCurrency(d.ingresos)} 
                            expenseVal={formatCurrency(d.gastos)}
                          />
                      ))}
                      {chartData.every(d => d.ingresos === 0 && d.gastos === 0) && <p className="text-gray-400 text-sm w-full text-center absolute bottom-1/2">Sin datos en este periodo</p>}
                    </div>
                </div>
              </div>
            </div>
            
            {/* TABLA DE MOVIMIENTOS */}
            <div className="bg-white rounded-xl border border-border/20 shadow-sm overflow-hidden flex flex-col max-h-[500px]">
              <div className="p-6 border-b border-border/10 flex justify-between items-center shrink-0 bg-white z-10">
                  <h3 className="text-lg font-bold text-text">Movimientos ({transactions.length})</h3>
                  <span className="text-xs text-text/40 italic">Scroll para ver más</span>
              </div>
              <div className="overflow-auto flex-1">
                <table className="w-full">
                  <thead className="bg-[#fcfbf9] sticky top-0 z-10 shadow-sm">
                    <tr><Th>Fecha</Th><Th>Concepto</Th><Th>Categoría</Th><Th align="right">Importe</Th><Th align="center">Estado</Th><th className="py-4 px-6"></th></tr>
                  </thead>
                  <tbody className="divide-y divide-border/10">
                    {transactions.map((tx, idx) => (
                        <TableRow key={idx} date={formatDate(tx.date)} icon={tx.type === 'income' ? <User size={16} /> : <Package size={16} />} iconColor={tx.type === 'income' ? "text-primary bg-primary/10" : "text-blue-600 bg-blue-50"} title={tx.title || 'Desconocido'} category={tx.cat || 'General'} amount={(tx.type === 'income' ? '+' : '-') + formatCurrency(tx.amount)} isPositive={tx.type === 'income'} status={tx.status} statusColor="green" />
                    ))}
                    {transactions.length === 0 && <tr><td colSpan="6" className="p-12 text-center text-text/40">No hay movimientos en este periodo</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </main>
      
      {/* Click fuera para cerrar selector */}
      {isMonthSelectorOpen && <div className="fixed inset-0 z-40" onClick={() => setIsMonthSelectorOpen(false)}></div>}
    </div>
  );
}

// --- SUBCOMPONENTES ---

function KpiCard({ title, value, change, icon, color, label, inverse }) {
  const colorClasses = { green: "bg-green-50 text-green-600", orange: "bg-orange-50 text-orange-600", primary: "bg-primary/10 text-primary", gray: "bg-gray-100 text-text/60" };
  const isPositive = change >= 0;
  let badgeColor = "bg-gray-100 text-gray-500";
  if (change !== 0) {
      if (!inverse) badgeColor = isPositive ? "bg-green-50 text-green-600" : "bg-red-50 text-red-600";
      else badgeColor = isPositive ? "bg-red-50 text-red-600" : "bg-green-50 text-green-600";
  }
  return (
    <div className="bg-white p-6 rounded-xl border border-border/20 shadow-sm flex flex-col justify-between h-[160px] relative hover:shadow-md transition-all">
      <div className="flex justify-between items-start">
          <div><p className="text-text/60 text-sm font-medium mb-1">{title}</p><h3 className="text-2xl font-bold text-text tracking-tight">{value}</h3></div>
          <div className={`p-2 rounded-lg ${colorClasses[color]}`}>{icon}</div>
      </div>
      <div className="flex items-center gap-2 mt-auto">
          {change !== 0 && <span className={`text-xs font-bold px-2 py-0.5 rounded-full flex items-center gap-1 ${badgeColor}`}>
            {change > 0 && <TrendingUp size={10}/>} {change < 0 && <TrendingDown size={10}/>} {Math.abs(change).toFixed(1)}%
          </span>}
          <span className="text-xs text-text/40">{label}</span>
      </div>
    </div>
  );
}

function LegendItem({ color, label }) { return (<div className="flex items-center gap-2"><span className={`w-3 h-3 rounded-full ${color}`}></span><span className="text-sm font-medium text-text/60">{label}</span></div>); }

function ChartBarGroup({ label, fullLabel, incomeHeight, expenseHeight, incomeVal, expenseVal }) { 
    return (
        <div className="flex flex-col items-center h-full justify-end group relative min-w-[30px] flex-1 max-w-[80px]">
            <div className="flex gap-1 items-end h-full justify-center w-full px-0.5">
                <div style={{height: incomeHeight}} className="w-full bg-primary rounded-t-sm transition-all hover:opacity-80 relative group/bar cursor-pointer">
                    <div className="hidden group-hover/bar:block absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-gray-800 text-white text-[10px] py-1 px-2 rounded z-50 whitespace-nowrap shadow-lg pointer-events-none">
                        {incomeVal}
                        <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1 border-4 border-transparent border-t-gray-800"></div>
                    </div>
                </div>
                <div style={{height: expenseHeight}} className="w-full bg-secondary rounded-t-sm transition-all hover:opacity-80 relative group/bar cursor-pointer">
                     <div className="hidden group-hover/bar:block absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-gray-800 text-white text-[10px] py-1 px-2 rounded z-50 whitespace-nowrap shadow-lg pointer-events-none">
                        {expenseVal}
                        <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1 border-4 border-transparent border-t-gray-800"></div>
                    </div>
                </div>
            </div>
            <span className="text-[10px] font-bold text-text/50 mt-2 uppercase tracking-wider truncate w-full text-center" title={fullLabel}>{label}</span>
        </div>
    ); 
}

function Th({ children, align = "left" }) { return (<th className={`text-${align} py-4 px-6 text-xs font-semibold text-text/50 uppercase tracking-wider sticky top-0 bg-[#fcfbf9]`}>{children}</th>); }

function TableRow({ date, icon, iconColor, title, category, amount, isPositive, status, statusColor }) { 
    return (
        <tr className="hover:bg-[#fcfbf9] transition-colors group cursor-pointer">
            <td className="py-4 px-6 text-sm text-text/80 whitespace-nowrap">{date}</td>
            <td className="py-4 px-6"><div className="flex items-center gap-3"><div className={`size-8 rounded-full flex items-center justify-center shrink-0 ${iconColor}`}>{icon}</div><span className="text-sm font-medium text-text truncate max-w-[200px]">{title}</span></div></td>
            <td className="py-4 px-6 text-sm text-text/60">{category}</td>
            <td className={`py-4 px-6 text-sm font-bold text-right whitespace-nowrap ${isPositive ? 'text-green-600' : 'text-text'}`}>{amount}</td>
            <td className="py-4 px-6 text-center"><span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border ${statusColor === 'green' ? 'bg-green-50 text-green-700 border-green-100' : 'bg-yellow-50 text-yellow-700 border-yellow-100'}`}><span className={`size-1.5 rounded-full ${statusColor === 'green' ? 'bg-green-500' : 'bg-yellow-500'}`}></span>{status}</span></td>
            <td className="py-4 px-6 text-right"><button className="text-text/40 hover:text-primary transition-colors opacity-0 group-hover:opacity-100"><MoreVertical size={16} /></button></td>
        </tr>
    ); 
}