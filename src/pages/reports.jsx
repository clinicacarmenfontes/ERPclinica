import React, { useState, useEffect, useMemo } from 'react';
import Sidebar from '../components/Sidebar';
import Notifications from '../components/Notifications';
import { supabase } from '../supabaseClient';
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { 
  TrendingUp, Download, ChevronLeft, ChevronRight, ChevronDown,
  Calendar, Wallet, PieChart, Activity, ArrowUpRight, Scale, 
  BadgeEuro, CircleDollarSign, Loader2, AlertCircle, FileText, Landmark, Info
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

const currency = (val) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(toNum(val));

const safePercent = (val, total) => {
    const v = toNum(val);
    const t = toNum(total);
    if (t === 0) return '0.0';
    return ((v / t) * 100).toFixed(1);
};

export default function Reports() {
  const [activeView, setActiveView] = useState('pnl');
  const [loading, setLoading] = useState(true);
  
  // DATOS
  const [incomes, setIncomes] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [openingBalances, setOpeningBalances] = useState([]);
  const [patientBalances, setPatientBalances] = useState([]); 
  const [expenseCatalog, setExpenseCatalog] = useState({});
  
  const [period, setPeriod] = useState({ year: new Date().getFullYear(), month: 'all' });
  const [isMonthSelectorOpen, setIsMonthSelectorOpen] = useState(false);
  
  const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

  useEffect(() => {
    let mounted = true;
    async function loadData() {
      setLoading(true);
      try {
        const [inc, exp, expCat, opening, patBal] = await Promise.all([
            supabase.from('incomes').select('*').gte('issue_date', `${period.year}-01-01`).lte('issue_date', `${period.year}-12-31`),
            supabase.from('expenses').select('*').gte('issue_date', `${period.year}-01-01`).lte('issue_date', `${period.year}-12-31`),
            supabase.from('expense_catalog').select('name, account_code'),
            supabase.from('opening_balances').select('*').eq('fiscal_year', period.year),
            supabase.from('patient_period_balances').select('*').gte('period_date', `${period.year}-01-01`).lte('period_date', `${period.year}-12-31`)
        ]);
        
        if (mounted) {
            setIncomes(inc.data || []);
            setExpenses(exp.data || []);
            setOpeningBalances(opening.data || []);
            setPatientBalances(patBal.data || []);
            
            const eMap = {}; 
            (expCat.data || []).forEach(e => {
                if(e.name) eMap[e.name.toLowerCase().trim()] = e.account_code;
            });
            setExpenseCatalog(eMap);
        }
      } catch (err) {
        console.error("Error cargando reportes:", err);
      } finally {
        if (mounted) setLoading(false);
      }
    }
    loadData();
    return () => { mounted = false; };
  }, [period.year]);

  // --- MOTOR DE CÁLCULOS ---
  const reportData = useMemo(() => {
    const data = {
        pnl: { revenue: 0, cogs: 0, grossMargin: 0, personnel: 0, services: 0, ebitda: 0, amortization: 0, ebit: 0 },
        balance: { 
            nonCurrentAssets: 0, 
            currentAssets: 0, treasury: 0, debtors: 0, 
            equity: 0, equityCapital: 0, equityResult: 0, equityGap: 0,
            nonCurrentLiabilities: 0, 
            currentLiabilities: 0, creditors: 0, providers: 0 
        },
        cashflow: { in: 0, out: 0, net: 0 },
        graph: Array(12).fill(0).map((_, i) => ({ month: monthNames[i].substring(0,3), income: 0, expense: 0, cashFlow: 0 }))
    };

    if (loading) return data;

    try {
        // 1. SALDOS INICIALES
        let iniNCAssets = 0, iniTreasury = 0, iniEquity = 0, iniLiabilities = 0;
        openingBalances.forEach(row => {
            const acc = String(row.account_code || '');
            const val = toNum(row.debit_balance) - toNum(row.credit_balance);
            if (acc.startsWith('2')) iniNCAssets += val;
            else if (acc.startsWith('57')) iniTreasury += val;
            else if (acc.startsWith('1')) iniEquity += (val * -1); 
            else if (acc.startsWith('4') || acc.startsWith('5')) iniLiabilities += (val * -1);
        });

        // 2. MOVIMIENTOS AÑO
        const filterFn = (item) => {
            if (period.month === 'all') return true;
            if (!item.issue_date) return false;
            return new Date(item.issue_date).getMonth() === period.month;
        };
        const pIncomes = incomes.filter(filterFn);
        const pExpenses = expenses.filter(filterFn);

        // P&L
        data.pnl.revenue = pIncomes.reduce((s, i) => s + toNum(i.tax_base), 0);
        let currentAmortization = 0;
        let currentInvestments = 0;

        pExpenses.forEach(e => {
            const val = toNum(e.tax_base);
            const typeName = (e.expense_type_label || '').toLowerCase().trim();
            const account = expenseCatalog[typeName] || '62900000';
            const accStr = String(account);

            if (accStr.startsWith('60')) data.pnl.cogs += val;
            else if (accStr.startsWith('64')) data.pnl.personnel += val;
            else if (accStr.startsWith('68')) { data.pnl.amortization += val; currentAmortization += val; }
            else if (accStr.startsWith('2')) currentInvestments += val;
            else data.pnl.services += val;
        });

        data.pnl.grossMargin = data.pnl.revenue - data.pnl.cogs;
        data.pnl.ebitda = data.pnl.grossMargin - (data.pnl.personnel + data.pnl.services);
        data.pnl.ebit = data.pnl.ebitda - data.pnl.amortization;

        // 3. SALDOS DE PACIENTES
        let targetBalances = [];
        if (patientBalances.length > 0) {
            const availableDates = [...new Set(patientBalances.map(p => p.period_date))].sort();
            if (availableDates.length > 0) {
                let targetDate = null;
                if (period.month === 'all') {
                    targetDate = availableDates[availableDates.length - 1];
                } else {
                    const targetMonth = period.month;
                    const validDates = availableDates.filter(d => new Date(d).getMonth() <= targetMonth);
                    targetDate = validDates.length > 0 ? validDates[validDates.length - 1] : null;
                }
                if (targetDate) targetBalances = patientBalances.filter(p => p.period_date === targetDate);
            }
        }

        const totalPatientDebtors = targetBalances.filter(p => p.balance_type === 'Deudor').reduce((sum, p) => sum + toNum(p.balance_amount), 0);
        const totalPatientCreditors = targetBalances.filter(p => p.balance_type === 'Acreedor').reduce((sum, p) => sum + toNum(p.balance_amount), 0);

        // --- CONSTRUCCIÓN DEL BALANCE ---
        
        // A) ACTIVO
        data.balance.nonCurrentAssets = iniNCAssets + currentInvestments - currentAmortization;
        
        const totalCashIn = incomes.reduce((s, i) => s + toNum(i.total_amount), 0);
        const totalCashOut = expenses.reduce((s, e) => s + toNum(e.total_payment), 0);
        data.balance.treasury = iniTreasury + (totalCashIn - totalCashOut);
        data.balance.debtors = totalPatientDebtors; 

        data.balance.currentAssets = data.balance.treasury + data.balance.debtors;

        // B) PASIVO
        data.balance.providers = iniLiabilities;
        data.balance.creditors = totalPatientCreditors;
        data.balance.currentLiabilities = data.balance.providers + data.balance.creditors;

        // C) PATRIMONIO NETO (Cuadre)
        const totalAssets = data.balance.nonCurrentAssets + data.balance.currentAssets;
        const totalLiabilities = data.balance.currentLiabilities;
        const totalEquityForced = totalAssets - totalLiabilities;

        data.balance.equityCapital = iniEquity; 
        data.balance.equityResult = data.pnl.ebit; 
        data.balance.equityGap = totalEquityForced - (iniEquity + data.pnl.ebit);
        data.balance.equity = totalEquityForced; 

        // CASHFLOW
        data.cashflow.in = pIncomes.reduce((s, i) => s + toNum(i.total_amount), 0);
        data.cashflow.out = pExpenses.reduce((s, e) => s + toNum(e.total_payment), 0);
        data.cashflow.net = data.cashflow.in - data.cashflow.out;

        data.graph = data.graph.map((g, idx) => {
            const mInc = incomes.filter(i => new Date(i.issue_date).getMonth() === idx);
            const mExp = expenses.filter(e => new Date(e.issue_date).getMonth() === idx);
            const iVal = mInc.reduce((s, i) => s + toNum(i.total_amount), 0);
            const eVal = mExp.reduce((s, e) => s + toNum(e.total_payment), 0);
            return { ...g, income: iVal, expense: eVal, cashFlow: iVal - eVal };
        });

    } catch (error) { console.error("Error cálculo:", error); }
    return data;
  }, [incomes, expenses, period, loading, expenseCatalog, openingBalances, patientBalances]);

  // --- HANDLER PDF DETALLADO ---
  const handleExportPDF = (type) => {
    const doc = new jsPDF();
    
    if (type === 'pnl') {
        doc.text("CUENTA DE RESULTADOS (P&L)", 14, 20);
        doc.setFontSize(10); doc.text(`Ejercicio: ${period.year}`, 14, 26);
        autoTable(doc, {
            startY: 35, 
            head: [['CONCEPTO', 'IMPORTE', '%']],
            body: [
                ['(+) INGRESOS DE EXPLOTACIÓN', currency(reportData.pnl.revenue), '100%'],
                ['(-) Aprovisionamientos', currency(reportData.pnl.cogs), `${safePercent(reportData.pnl.cogs, reportData.pnl.revenue)}%`],
                ['(=) MARGEN BRUTO', currency(reportData.pnl.grossMargin), `${safePercent(reportData.pnl.grossMargin, reportData.pnl.revenue)}%`],
                ['(-) Gastos de Personal', currency(reportData.pnl.personnel), `${safePercent(reportData.pnl.personnel, reportData.pnl.revenue)}%`],
                ['(-) Servicios Exteriores', currency(reportData.pnl.services), `${safePercent(reportData.pnl.services, reportData.pnl.revenue)}%`],
                ['(=) EBITDA', currency(reportData.pnl.ebitda), `${safePercent(reportData.pnl.ebitda, reportData.pnl.revenue)}%`],
                ['(-) Amortizaciones', currency(reportData.pnl.amortization), `${safePercent(reportData.pnl.amortization, reportData.pnl.revenue)}%`],
                ['(=) EBIT (Rtdo. Explotación)', currency(reportData.pnl.ebit), `${safePercent(reportData.pnl.ebit, reportData.pnl.revenue)}%`]
            ],
            theme: 'grid', headStyles: { fillColor: [138, 90, 98] }
        });
    } else {
        // PDF BALANCE DETALLADO
        doc.text("BALANCE DE SITUACIÓN", 14, 20);
        doc.setFontSize(10); doc.text(`Ejercicio: ${period.year} | Foto a fecha cierre`, 14, 26);

        const { nonCurrentAssets, currentAssets, treasury, debtors, equity, equityCapital, equityResult, currentLiabilities, providers, creditors } = reportData.balance;
        const totalActivo = nonCurrentAssets + currentAssets;
        const totalPasivo = equity + currentLiabilities;

        autoTable(doc, {
            startY: 35,
            head: [['ACTIVO', 'IMPORTE', 'PATRIMONIO Y PASIVO', 'IMPORTE']],
            body: [
                // Fila 1: Títulos Principales
                [{ content: 'A) ACTIVO NO CORRIENTE', styles: { fontStyle: 'bold' } }, currency(nonCurrentAssets), { content: 'A) PATRIMONIO NETO', styles: { fontStyle: 'bold' } }, currency(equity)],
                // Fila 2: Detalles
                ['   Inmovilizado Material', currency(nonCurrentAssets), '   Fondos Propios (Capital)', currency(equityCapital)],
                // Fila 3: Detalles Extra
                ['', '', '   Resultado Ejercicio', currency(equityResult)],
                
                // Espaciador
                ['', '', '', ''],

                // Fila 4: Títulos Corrientes
                [{ content: 'B) ACTIVO CORRIENTE', styles: { fontStyle: 'bold' } }, currency(currentAssets), { content: 'B) PASIVO CORRIENTE', styles: { fontStyle: 'bold' } }, currency(currentLiabilities)],
                // Fila 5: Detalles
                ['   Tesorería (Caja/Bancos)', currency(treasury), '   Proveedores / Acreedores', currency(providers)],
                // Fila 6: Detalles
                ['   Deudores (Pacientes)', currency(debtors), '   Anticipos Pacientes', currency(creditors)],

                // Fila Final: Totales
                [{ content: 'TOTAL ACTIVO', styles: { fontStyle: 'bold', fillColor: [240, 240, 240] } }, { content: currency(totalActivo), styles: { fontStyle: 'bold', fillColor: [240, 240, 240] } }, { content: 'TOTAL PATRIMONIO Y PASIVO', styles: { fontStyle: 'bold', fillColor: [240, 240, 240] } }, { content: currency(totalPasivo), styles: { fontStyle: 'bold', fillColor: [240, 240, 240] } }]
            ],
            theme: 'grid',
            styles: { fontSize: 9, cellPadding: 4 },
            headStyles: { fillColor: [138, 90, 98], textColor: 255, fontStyle: 'bold', halign: 'center' },
            columnStyles: { 0: { cellWidth: 70 }, 1: { cellWidth: 35, halign: 'right' }, 2: { cellWidth: 70 }, 3: { cellWidth: 35, halign: 'right' } }
        });
    }
    doc.save(`${type}_${period.year}.pdf`);
  };

  const changeYear = (d) => setPeriod(p => ({ ...p, year: p.year + d }));
  const selectMonth = (m) => { setPeriod(p => ({ ...p, month: m })); setIsMonthSelectorOpen(false); };
  const availableMonths = useMemo(() => { const s = new Set(); [...incomes, ...expenses].forEach(i => { if(i.issue_date) s.add(new Date(i.issue_date).getMonth()); }); return s; }, [incomes, expenses]);

  return (
    <div className="flex h-screen overflow-hidden bg-background font-sans text-[#161313]">
      <Sidebar />
      <main className="flex-1 flex flex-col h-screen overflow-y-auto bg-background relative">
        <div className="absolute top-0 left-0 w-full h-64 bg-gradient-to-b from-primary/5 to-transparent pointer-events-none z-0"></div>
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-border/20 bg-background/80 backdrop-blur-xl px-8 py-4">
          <div className="flex items-center gap-4">
            <div className="p-2 bg-white rounded-xl shadow-sm border border-border/20 text-primary"><TrendingUp size={24} /></div>
            <div><h2 className="text-text text-xl font-bold tracking-tight font-serif">Reportes Financieros</h2><p className="text-xs text-text/50 font-medium uppercase tracking-wider">{activeView === 'pnl' ? 'Cuenta de Resultados' : activeView === 'balance' ? 'Balance Situación' : 'Flujo de Caja'}</p></div>
          </div>
          <div className="flex items-center gap-6"><Notifications /><div className="size-10 rounded-full bg-cover bg-center border-2 border-white shadow-md" style={{backgroundImage: "url('https://images.unsplash.com/photo-1559839734-2b71ea197ec2?q=80&w=2070&auto=format&fit=crop')"}}></div></div>
        </header>

        <div className="relative z-10 flex-1 p-8 max-w-[1400px] mx-auto w-full flex flex-col gap-8">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="bg-white/60 p-1.5 rounded-xl border border-border/20 backdrop-blur-sm flex gap-1 shadow-sm w-fit">
              {['pnl', 'balance', 'cashflow'].map(view => (
                <button key={view} onClick={() => setActiveView(view)} className={`px-5 py-2 text-sm font-bold rounded-lg transition-all capitalize ${activeView === view ? 'bg-white text-primary shadow-sm border border-border/10' : 'text-text/60 hover:text-text hover:bg-white/50'}`}>
                  {view === 'pnl' ? 'P&L' : view === 'cashflow' ? 'Flujo de Caja' : view}
                </button>
              ))}
            </div>
            <div className="flex gap-3 items-center">
                <div className="flex items-center gap-2 bg-white p-1 rounded-xl shadow-sm border border-border/10 relative">
                    <div className="flex items-center border-r border-border/10 pr-2"><button onClick={() => changeYear(-1)} className="p-2 hover:bg-gray-100 rounded-lg text-text/60"><ChevronLeft size={16}/></button><span className="font-bold text-text px-2">{period.year}</span><button onClick={() => changeYear(1)} className="p-2 hover:bg-gray-100 rounded-lg text-text/60"><ChevronRight size={16}/></button></div>
                    <div className="relative"><button onClick={() => setIsMonthSelectorOpen(!isMonthSelectorOpen)} className="flex items-center gap-2 px-4 py-2 hover:bg-gray-50 rounded-lg transition-colors text-sm font-medium text-text min-w-[140px] justify-between"><span className="flex items-center gap-2"><Calendar size={16} className="text-primary"/> {period.month === 'all' ? 'Todo el Año' : monthNames[period.month]}</span><ChevronDown size={14} className="text-text/40"/></button>
                        {isMonthSelectorOpen && (<div className="absolute top-full right-0 mt-2 w-64 bg-white border border-border/10 shadow-xl rounded-xl p-2 z-50 animate-in fade-in zoom-in-95 duration-200"><button onClick={() => selectMonth('all')} className={`w-full text-left px-3 py-2 rounded-lg text-sm mb-2 font-bold ${period.month === 'all' ? 'bg-primary/10 text-primary' : 'hover:bg-gray-50 text-text'}`}>Todo el Año</button><div className="grid grid-cols-3 gap-1">{monthNames.map((m, i) => (<button key={i} onClick={() => availableMonths.has(i) && selectMonth(i)} disabled={!availableMonths.has(i)} className={`px-2 py-2 rounded-md text-xs text-center transition-colors ${period.month === i ? 'bg-primary text-white shadow-md' : availableMonths.has(i) ? 'hover:bg-gray-50 text-text/70' : 'text-gray-300 cursor-not-allowed'}`}>{m.substring(0,3)}</button>))}</div></div>)}
                    </div>
                </div>
                <button onClick={() => handleExportPDF(activeView)} className="flex items-center gap-2 bg-primary text-white px-6 py-2.5 rounded-xl text-sm font-bold shadow-lg shadow-primary/20 hover:bg-primary/90 transition-all"><Download size={18} /><span>PDF Detallado</span></button>
            </div>
          </div>

          {loading ? <div className="h-96 flex items-center justify-center text-primary"><Loader2 size={40} className="animate-spin"/></div> : (
             <>
                {activeView === 'pnl' && <PnLView data={reportData} periodLabel={period.month === 'all' ? `Todo el año ${period.year}` : `${monthNames[period.month]} ${period.year}`} />}
                {activeView === 'balance' && <BalanceView data={reportData.balance} />}
                {activeView === 'cashflow' && <CashFlowView data={reportData} />}
             </>
          )}
        </div>
      </main>
      {isMonthSelectorOpen && <div className="fixed inset-0 z-40" onClick={() => setIsMonthSelectorOpen(false)}></div>}
    </div>
  );
}

// --- VISTAS ---
function PnLView({ data, periodLabel }) {
  const { revenue, cogs, grossMargin, personnel, services, ebitda, amortization, ebit } = data.pnl;
  return (
    <div className="flex flex-col gap-8 animate-in fade-in duration-500">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <MetricCard title="EBITDA" amount={currency(ebitda)} change={`${safePercent(ebitda, revenue)}%`} trend="up" icon={<Wallet size={24} />} color="primary" />
        <MetricCard title="Margen Bruto" amount={currency(grossMargin)} change={`${safePercent(grossMargin, revenue)}%`} trend="up" icon={<PieChart size={24} />} color="secondary" />
        <MetricCard title="Rtdo. Explotación" amount={currency(ebit)} change="Neto" trend="up" icon={<Activity size={24} />} color="orange" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-3 bg-white rounded-3xl p-8 shadow-sm border border-border/10">
          <div className="flex items-center justify-between mb-8"><h3 className="text-xl font-bold text-text">Evolución P&L</h3><div className="flex gap-4"><span className="flex items-center gap-2 text-xs font-bold"><span className="size-2 bg-secondary rounded-full"></span>Ingresos</span><span className="flex items-center gap-2 text-xs font-bold"><span className="size-2 bg-primary rounded-full"></span>Gastos</span></div></div>
          <div className="w-full h-[280px] flex items-end justify-between gap-2 px-2 border-b border-border/10 pb-4 relative">
              {data.graph.map((m, i) => { const maxVal = Math.max(...data.graph.map(d => Math.max(d.income, d.expense))); const max = maxVal > 0 ? maxVal : 1; return <Bar key={i} month={m.month} income={`${(m.income/max)*100}%`} expense={`${(m.expense/max)*100}%`} incomeVal={currency(m.income)} expenseVal={currency(m.expense)} color1="bg-secondary" color2="bg-primary" /> })}
          </div>
        </div>
        <div className="lg:col-span-3 bg-white rounded-3xl shadow-sm border border-border/10 overflow-hidden">
          <div className="p-8 border-b border-border/10 bg-white"><h3 className="text-xl font-bold text-text">Cuenta de Resultados (Detallada)</h3></div>
          <table className="w-full text-left"><thead className="bg-gray-50 text-xs uppercase text-text/50"><tr><th className="py-3 px-6">Concepto</th><th className="py-3 px-6 text-right">Importe</th><th className="py-3 px-6 text-right">%</th></tr></thead><tbody className="text-sm divide-y divide-border/5">
                <TableRow label="(+) Ingresos" val={currency(revenue)} change="100%" changeColor="green" isBold />
                <TableRow label="(-) Aprovisionamientos" val={`(${currency(cogs)})`} change={`${safePercent(cogs, revenue)}%`} changeColor="orange" indent />
                <TableRow label="(=) MARGEN BRUTO" val={currency(grossMargin)} change={`${safePercent(grossMargin, revenue)}%`} changeColor="green" isBold bg />
                <TableRow label="(-) Personal" val={`(${currency(personnel)})`} change={`${safePercent(personnel, revenue)}%`} changeColor="gray" indent />
                <TableRow label="(-) Servicios Ext." val={`(${currency(services)})`} change={`${safePercent(services, revenue)}%`} changeColor="gray" indent />
                <TableRow label="(=) EBITDA" val={currency(ebitda)} change={`${safePercent(ebitda, revenue)}%`} changeColor="green" isBold isHighlight />
                <TableRow label="(-) Amortizaciones" val={`(${currency(amortization)})`} change={`${safePercent(amortization, revenue)}%`} changeColor="gray" indent />
                <TableRow label="(=) EBIT" val={currency(ebit)} change={`${safePercent(ebit, revenue)}%`} changeColor="green" isBold isHighlight />
          </tbody></table>
        </div>
      </div>
    </div>
  );
}

function BalanceView({ data }) {
  const { nonCurrentAssets = 0, currentAssets = 0, treasury = 0, debtors = 0, equity = 0, currentLiabilities = 0, providers = 0, creditors = 0, equityCapital = 0, equityResult = 0, equityGap = 0 } = data || {};
  const totalAssets = nonCurrentAssets + currentAssets;
  const totalLiabilities = equity + currentLiabilities;

  return (
    <div className="flex flex-col gap-8 animate-in fade-in duration-500">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <MetricCard title="Total Activo" amount={currency(totalAssets)} change="100%" trend="up" icon={<BadgeEuro size={24} />} color="secondary" />
        <MetricCard title="Patrimonio Neto" amount={currency(equity)} change={`${safePercent(equity, totalLiabilities)}%`} trend="up" icon={<Landmark size={24} />} color="primary" />
        <MetricCard title="Pasivo Corriente" amount={currency(currentLiabilities)} change={`${safePercent(currentLiabilities, totalLiabilities)}%`} trend="down" isPositive={true} icon={<Scale size={24} />} color="orange" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="bg-white rounded-3xl shadow-sm border border-border/10 overflow-hidden">
              <div className="p-6 bg-green-50/50"><h3 className="text-lg font-bold text-green-900">ACTIVO (Destino de Fondos)</h3></div>
              <table className="w-full text-left text-sm"><tbody className="divide-y divide-border/5">
                  <TableRow label="A) ACTIVO NO CORRIENTE" val={currency(nonCurrentAssets)} isBold />
                  <TableRow label="   Inmovilizado Material" val={currency(nonCurrentAssets)} indent />
                  <TableRow label="B) ACTIVO CORRIENTE" val={currency(currentAssets)} isBold />
                  <TableRow label="   Tesorería (Caja/Bancos)" val={currency(treasury)} indent />
                  <TableRow label="   Deudores (Pacientes)" val={currency(debtors)} indent />
                  <tr className="bg-gray-50 font-bold"><td className="py-4 px-8">TOTAL ACTIVO</td><td className="py-4 px-8 text-right text-green-700">{currency(totalAssets)}</td></tr>
              </tbody></table>
          </div>
          <div className="bg-white rounded-3xl shadow-sm border border-border/10 overflow-hidden">
              <div className="p-6 bg-red-50/50"><h3 className="text-lg font-bold text-red-900">PATRIMONIO Y PASIVO (Origen Fondos)</h3></div>
              <table className="w-full text-left text-sm"><tbody className="divide-y divide-border/5">
                  <TableRow label="A) PATRIMONIO NETO" val={currency(equity)} isBold />
                  <TableRow label="   Fondos Propios (Inicio)" val={currency(equityCapital)} indent />
                  <TableRow label="   Rtdo. Ejercicio (P&L)" val={currency(equityResult)} indent isHighlight />
                  <tr><td colSpan="2" className="px-8 py-2 text-xs text-blue-600 bg-blue-50/50 italic"><Info size={12} className="inline mr-1"/> Nota: Beneficio ({currency(equityResult)}) pendiente de cierre contable. Diferencia de cuadre ({currency(equityGap)}) por ajustes de tesorería/IVA.</td></tr>
                  
                  <TableRow label="B) PASIVO CORRIENTE" val={currency(currentLiabilities)} isBold />
                  <TableRow label="   Acreedores / Proveedores" val={currency(providers)} indent />
                  <TableRow label="   Anticipos Pacientes" val={currency(creditors)} indent />
                  <tr className="bg-gray-50 font-bold"><td className="py-4 px-8">TOTAL PATRIMONIO Y PASIVO</td><td className="py-4 px-8 text-right text-red-700">{currency(totalLiabilities)}</td></tr>
              </tbody></table>
          </div>
      </div>
    </div>
  );
}

function CashFlowView({ data }) {
  const { in: cashIn, out: cashOut, net: netCash } = data.cashflow;
  return (
    <div className="flex flex-col gap-8 animate-in fade-in duration-500">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <MetricCard title="Cobros" amount={currency(cashIn)} change="Entradas" trend="up" icon={<Activity size={24} />} color="secondary" />
        <MetricCard title="Pagos" amount={`(${currency(cashOut)})`} change="Salidas" trend="down" icon={<ArrowUpRight size={24} />} color="primary" />
        <MetricCard title="Flujo Neto" amount={currency(netCash)} change={netCash > 0 ? "+" : "-"} trend="up" icon={<CircleDollarSign size={24} />} color={netCash >= 0 ? "green" : "red"} />
      </div>
      <div className="bg-white rounded-3xl p-8 shadow-sm border border-border/10">
        <h3 className="text-xl font-bold text-text mb-6">Evolución Tesorería</h3>
        <div className="w-full h-[350px] px-4 pb-4"><LineChart data={data.graph} /></div>
      </div>
    </div>
  );
}

function LineChart({ data, width = 1000, height = 300 }) {
    if (!data || data.length < 2) return <div className="h-full flex items-center justify-center text-gray-300">Sin datos suficientes</div>;
    const values = data.map(d => d.cashFlow);
    const min = Math.min(...values, 0); const max = Math.max(...values, 100); const range = (max - min) || 1;
    const padding = 40; const color = "#9E6B73"; 
    const points = data.map((d, i) => ({ x: (i / (data.length - 1)) * width, y: height - padding - ((d.cashFlow - min) / range) * (height - padding*2), value: d.cashFlow, label: d.month }));
    const pathD = points.reduce((acc, p, i, a) => { if(i===0) return `M ${p.x},${p.y}`; const prev=a[i-1]; const cp1x=prev.x+(p.x-prev.x)/2; const cp2x=prev.x+(p.x-prev.x)/2; return `${acc} C ${cp1x},${prev.y} ${cp2x},${p.y} ${p.x},${p.y}`; }, "");
    const zeroY = height - padding - ((0 - min) / range) * (height - padding*2);
    return (
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full overflow-visible">
            <line x1="0" y1={zeroY} x2={width} y2={zeroY} stroke="#e5e7eb" strokeWidth="2" strokeDasharray="5" />
            <path d={pathD} fill="none" stroke={color} strokeWidth="4" className="drop-shadow-md" strokeLinecap="round" />
            {points.map((p, i) => (
                <g key={i} className="group cursor-pointer">
                    <circle cx={p.x} cy={p.y} r="14" fill={color} opacity="0.15" className="group-hover:opacity-30 transition-all duration-300" />
                    <circle cx={p.x} cy={p.y} r="6" fill="white" stroke={color} strokeWidth="3" className="transition-all duration-300 group-hover:r-7" />
                    <foreignObject x={p.x - 40} y={p.y - 55} width="80" height="45" className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none">
                        <div className="bg-gray-800/90 text-white text-xs font-bold rounded-lg py-1.5 px-3 text-center shadow-xl backdrop-blur-sm">{currency(p.value)}</div>
                    </foreignObject>
                    <text x={p.x} y={height + 25} textAnchor="middle" className="text-xs fill-gray-400 font-bold uppercase tracking-widest">{p.label}</text>
                </g>
            ))}
        </svg>
    );
}

function MetricCard({ title, amount, change, trend, icon, color }) {
  const colors = { primary: "bg-primary text-white", secondary: "bg-secondary text-white", orange: "bg-orange-500 text-white", green: "bg-green-600 text-white", red: "bg-red-500 text-white" };
  const trendColor = "text-text/60 bg-gray-100";
  return (
    <div className="bg-white p-6 rounded-3xl shadow-[0_2px_15px_-3px_rgba(0,0,0,0.05)] border border-border/10 flex flex-col justify-between h-40 relative overflow-hidden">
      <div className={`absolute top-0 right-0 p-3 rounded-bl-2xl opacity-10 ${colors[color]}`}>{icon}</div>
      <div><p className="text-text/50 text-sm font-bold uppercase tracking-wide mb-2">{title}</p><h3 className="text-3xl font-black text-text tracking-tight">{amount}</h3></div>
      <div className="flex items-center gap-3"><span className={`flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-lg ${trendColor}`}>{change}</span></div>
    </div>
  );
}
function Bar({ month, income, expense, incomeVal, expenseVal, color1, color2 }) {
  return (
    <div className="flex flex-col items-center gap-3 flex-1 group cursor-pointer h-full justify-end">
      <div className="w-full max-w-[48px] flex items-end gap-1 h-full relative">
        <div className={`w-1/2 rounded-t-lg transition-all duration-500 ${color1} opacity-80 group-hover:opacity-100 relative`} style={{ height: income }}><span className="absolute bottom-full left-1/2 -translate-x-1/2 text-[10px] bg-gray-800 text-white px-1 rounded opacity-0 group-hover:opacity-100 mb-1 pointer-events-none">{incomeVal}</span></div>
        <div className={`w-1/2 rounded-t-lg transition-all duration-500 ${color2} opacity-80 group-hover:opacity-100 relative`} style={{ height: expense }}><span className="absolute bottom-full left-1/2 -translate-x-1/2 text-[10px] bg-gray-800 text-white px-1 rounded opacity-0 group-hover:opacity-100 mb-1 pointer-events-none">{expenseVal}</span></div>
      </div><span className="text-xs font-bold text-text/40 group-hover:text-primary transition-colors">{month}</span>
    </div>
  );
}
function TableRow({ label, val, change, changeColor, isBold, bg, indent, isHighlight }) {
  const styles = { green: "text-green-600 bg-green-50", orange: "text-orange-600 bg-orange-50", gray: "text-text/40" };
  return (
    <tr className={`group hover:bg-surface/30 transition-colors ${bg ? 'bg-surface/20' : ''} ${isHighlight ? 'bg-primary/5 border-l-4 border-primary' : ''}`}>
      <td className={`py-4 px-8 ${indent ? 'pl-12 text-text/70' : 'pl-8 text-text'} ${isBold ? 'font-bold' : 'font-medium'}`}>{label}</td>
      <td className={`py-4 px-8 text-right font-mono ${isBold ? 'font-bold text-text' : 'text-text/70'}`}>{val}</td>
      <td className="py-4 px-8 text-right">{change && <span className={`text-xs font-bold px-2 py-1 rounded ${styles[changeColor] || 'text-text/60'}`}>{change}</span>}</td>
    </tr>
  );
}