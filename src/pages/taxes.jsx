import React, { useState, useEffect, useMemo } from 'react';
import Sidebar from '../components/Sidebar';
import Notifications from '../components/Notifications';
import { supabase } from '../supabaseClient';
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { 
  Clock, Percent, BadgeEuro, Building2, 
  FileSpreadsheet, Landmark, Briefcase, FileCheck, ArrowRight, Calendar, Lock
} from 'lucide-react';

export default function Taxes() {
  const [loading, setLoading] = useState(true);
  const [fiscalData, setFiscalData] = useState({ incomes: [], expenses: [] });
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear());
  
  // LÓGICA DE TIEMPO
  const today = new Date();
  const currentMonth = today.getMonth(); 
  const realCurrentQuarter = Math.floor(currentMonth / 3) + 1; 
  
  const [selectedQuarter, setSelectedQuarter] = useState(realCurrentQuarter);

  // --- 1. CARGA DE DATOS ---
  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      try {
        const [inc, exp] = await Promise.all([
          supabase.from('incomes').select('*').gte('issue_date', `${currentYear}-01-01`).lte('issue_date', `${currentYear}-12-31`),
          supabase.from('expenses').select('*').gte('issue_date', `${currentYear}-01-01`).lte('issue_date', `${currentYear}-12-31`)
        ]);
        setFiscalData({ incomes: inc.data || [], expenses: exp.data || [] });
      } catch (err) {
        console.error("Error cargando datos fiscales:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [currentYear]);

  // --- 2. CONFIGURACIÓN DEL TRIMESTRE ---
  const quarterInfo = useMemo(() => {
      let name, startMonth, endMonth, deadlineDay, deadlineMonth;
      
      switch(selectedQuarter) {
          case 1: name = "1T (Ene - Mar)"; startMonth=0; endMonth=2; deadlineDay=20; deadlineMonth=3; break;
          case 2: name = "2T (Abr - Jun)"; startMonth=3; endMonth=5; deadlineDay=20; deadlineMonth=6; break;
          case 3: name = "3T (Jul - Sep)"; startMonth=6; endMonth=8; deadlineDay=20; deadlineMonth=9; break;
          case 4: name = "4T (Oct - Dic)"; startMonth=9; endMonth=11; deadlineDay=30; deadlineMonth=0; break;
          default: name="1T"; startMonth=0; endMonth=2;
      }

      const deadlineYear = selectedQuarter === 4 ? currentYear + 1 : currentYear;
      const deadlineDate = new Date(deadlineYear, deadlineMonth, deadlineDay);
      const qEndDate = new Date(currentYear, endMonth + 1, 0); 

      let statusLabel = "Pendiente";
      let statusColor = "orange";

      if (today < qEndDate) {
          statusLabel = "En curso (Borrador)"; 
          statusColor = "blue";
      } else if (today > deadlineDate) {
          statusLabel = "Vencido";
          statusColor = "red";
      }

      const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
      const deadlineStr = `${deadlineDay} de ${monthNames[deadlineMonth]}`;

      return { name, startMonth, endMonth, deadlineDate, deadlineStr, statusLabel, statusColor };
  }, [selectedQuarter, currentYear]);


  // --- 3. CÁLCULO DE MODELOS (CORREGIDO VAT_QUOTA) ---
  const models = useMemo(() => {
    const { incomes, expenses } = fiscalData;
    const { startMonth, endMonth } = quarterInfo;

    const filterByQ = (dateStr) => {
        if(!dateStr) return false;
        const m = new Date(dateStr).getMonth();
        return m >= startMonth && m <= endMonth;
    };

    const qIncomes = incomes.filter(i => filterByQ(i.issue_date));
    const qExpenses = expenses.filter(e => filterByQ(e.issue_date));

    // --- MODELO 303 (IVA) ---
    // CORRECCIÓN: Leemos 'vat_quota' (la columna real de Supabase)
    const ivaDevengado = qIncomes.reduce((acc, i) => acc + (i.vat_quota || 0), 0);
    const ivaSoportado = qExpenses.reduce((acc, e) => acc + (e.vat_quota || 0), 0);
    const result303 = ivaDevengado - ivaSoportado;

    // --- MODELO 130 (IRPF - PAGO FRACCIONADO) ---
    // CORRECCIÓN: Base Imponible = Total - vat_quota
    const baseIngresos = qIncomes.reduce((acc, i) => acc + (i.total_amount - (i.vat_quota || 0)), 0);
    const baseGastos = qExpenses.reduce((acc, e) => acc + (e.total_payment - (e.vat_quota || 0)), 0);
    
    const rendimientoNeto = baseIngresos - baseGastos;
    const result130 = rendimientoNeto > 0 ? rendimientoNeto * 0.20 : 0;

    // --- MODELO 111 (RETENCIONES) ---
    const retentionExpenses = qExpenses.filter(e => Number(e.retention_amount) > 0);
    const result111 = retentionExpenses.reduce((acc, e) => acc + Number(e.retention_amount || 0), 0);

    return {
        m303: { val: result303, devengado: ivaDevengado, deducible: ivaSoportado },
        m130: { val: result130, ingresos: baseIngresos, gastos: baseGastos, rendimiento: rendimientoNeto },
        m111: { val: result111, count: retentionExpenses.length }
    };
  }, [fiscalData, quarterInfo]);


  // --- 4. GENERACIÓN PDF ---
  const generatePDF = (modelType) => {
    const doc = new jsPDF();
    const currency = (val) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(val);
    
    doc.setFillColor(255, 255, 255);
    doc.rect(0, 0, 210, 297, 'F'); 

    doc.setFontSize(22);
    doc.setTextColor(40, 40, 40);
    doc.text(`Modelo ${modelType}`, 14, 20);
    doc.setFontSize(12);
    doc.setTextColor(100);
    doc.text(`${quarterInfo.statusLabel.includes('curso') ? 'SIMULACIÓN PRELIMINAR' : 'BORRADOR INFORMATIVO'}`, 14, 28);
    
    doc.setFontSize(10);
    doc.setTextColor(60);
    doc.text(`Periodo Liquidación: ${quarterInfo.name} ${currentYear}`, 14, 38);
    doc.text(`Fecha Emisión: ${new Date().toLocaleDateString()}`, 14, 43);

    let bodyData = [];
    let footData = [];

    if (modelType === '303') {
        bodyData = [
            ['IVA Repercutido (Ventas)', '', currency(models.m303.devengado)],
            ['IVA Soportado (Compras)', '', currency(models.m303.deducible)],
        ];
        footData = [['RESULTADO LIQUIDACIÓN', '', currency(models.m303.val)]];
    } else if (modelType === '130') {
        bodyData = [
            ['Ingresos Computables (Base)', '', currency(models.m130.ingresos)],
            ['Gastos Deducibles (Base)', '', currency(models.m130.gastos)],
            ['Rendimiento Neto', '', currency(models.m130.rendimiento)],
            ['Tipo Impositivo', '', '20%'],
        ];
        footData = [['CUOTA A INGRESAR', '', currency(models.m130.val)]];
    }

    autoTable(doc, {
        startY: 50,
        head: [['Concepto', 'Detalle', 'Importe']],
        body: bodyData,
        foot: footData,
        theme: 'grid',
        headStyles: { fillColor: [50, 50, 50], textColor: [255, 255, 255], fontStyle: 'bold' },
        footStyles: { fillColor: [240, 240, 240], textColor: [0,0,0], fontStyle: 'bold' },
        columnStyles: { 2: { halign: 'right' } }
    });

    doc.setFontSize(9);
    doc.setTextColor(150);
    doc.text("Este documento es meramente informativo y no sustituye la presentación oficial ante la AEAT.", 14, 280);

    doc.save(`modelo_${modelType}_${selectedQuarter}T_${currentYear}.pdf`);
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background font-sans text-[#161313]">
      <Sidebar />
      <main className="flex-1 flex flex-col h-screen overflow-y-auto bg-background relative">
        
        {/* HEADER */}
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-border/20 bg-background/95 backdrop-blur-md px-8 py-4">
          <div className="flex items-center gap-4">
            <div className="p-2 bg-primary/10 rounded-lg text-primary"><Landmark size={28} /></div>
            <h2 className="text-text text-xl font-bold font-serif">Gestión Fiscal</h2>
          </div>
          <div className="flex items-center gap-6">
            <Notifications />
            <div className="size-10 rounded-full bg-cover bg-center border-2 border-white shadow-sm" style={{backgroundImage: "url('https://images.unsplash.com/photo-1559839734-2b71ea197ec2?q=80&w=2070&auto=format&fit=crop')"}}></div>
          </div>
        </header>

        <div className="flex-1 p-8 max-w-[1400px] mx-auto w-full flex flex-col gap-8">
          
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div>
                <h1 className="text-3xl font-black text-text font-serif">Obligaciones Fiscales</h1>
                <p className="text-text/60">Ejercicio Fiscal {currentYear}</p>
            </div>
          </div>

          {/* SELECTOR DE TRIMESTRES */}
          <div className="bg-white p-2 rounded-xl border border-border/20 shadow-sm inline-flex gap-1 w-fit">
              {[1, 2, 3, 4].map(q => {
                  const isFuture = q > realCurrentQuarter; 
                  return (
                    <button 
                        key={q}
                        onClick={() => !isFuture && setSelectedQuarter(q)}
                        disabled={isFuture}
                        className={`
                            px-6 py-2.5 rounded-lg text-sm font-bold transition-all flex items-center gap-2
                            ${selectedQuarter === q 
                                ? 'bg-primary text-white shadow-md' 
                                : isFuture 
                                    ? 'bg-gray-50 text-gray-300 cursor-not-allowed' 
                                    : 'bg-transparent text-text/60 hover:bg-gray-100'}
                        `}
                    >
                        {q}T {isFuture && <Lock size={12}/>}
                    </button>
                  );
              })}
          </div>

          {/* INFO VENCIMIENTO */}
          <div className="flex items-center gap-4 p-4 bg-orange-50 border border-orange-100 rounded-xl text-orange-800 w-fit">
             <Clock size={20} />
             <div>
                 <p className="text-xs font-bold uppercase opacity-70">Fecha límite presentación {quarterInfo.name}</p>
                 <p className="text-lg font-bold">{quarterInfo.deadlineStr} {currentYear + (selectedQuarter === 4 ? 1 : 0)}</p>
             </div>
          </div>

          {/* MODELOS TRIMESTRALES */}
          <div className="flex flex-col gap-6">
            <h2 className="text-text text-xl font-bold tracking-tight">Liquidaciones {quarterInfo.name}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <TaxCard 
                model="303" 
                desc="IVA Autoliquidación" 
                icon={<Percent size={24} />} 
                status={quarterInfo.statusLabel} 
                statusColor={quarterInfo.statusColor} 
                value={models.m303.val}
                action="Generar PDF" 
                onClick={() => generatePDF('303')}
                isPrimary 
              />
              <TaxCard 
                model="130" 
                desc="Pago Frac. IRPF" 
                icon={<Landmark size={24} />} 
                status={quarterInfo.statusLabel}
                statusColor={quarterInfo.statusColor} 
                value={models.m130.val}
                action={models.m130.val > 0 ? "Generar PDF" : "Sin actividad"}
                onClick={() => models.m130.val > 0 && generatePDF('130')}
                disabled={models.m130.val === 0}
              />
              <TaxCard 
                model="111" 
                desc="Retenciones IRPF" 
                icon={<BadgeEuro size={24} />} 
                status={quarterInfo.statusLabel}
                statusColor={quarterInfo.statusColor}
                value={models.m111.val}
                action="Ver Detalle" 
                disabled={models.m111.val === 0}
              />
              <TaxCard 
                model="115" 
                desc="Ret. Alquileres" 
                icon={<Building2 size={24} />} 
                status="No Aplica" 
                statusColor="gray" 
                value={0}
                action="-" 
                disabled 
              />
            </div>
          </div>

          {/* MODELOS ANUALES (Solo informativos) */}
          <div className="flex flex-col gap-6 pt-4 opacity-60">
            <h2 className="text-text text-xl font-bold tracking-tight">Resúmenes Anuales (Informativo)</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <TaxCard model="390" desc="Resumen Anual IVA" icon={<FileSpreadsheet size={24} />} status="Enero 2027" statusColor="gray" action="-" disabled />
              <TaxCard model="190" desc="Resumen Retenciones" icon={<Briefcase size={24} />} status="Enero 2027" statusColor="gray" action="-" disabled />
              <TaxCard model="200" desc="Impuesto Sociedades" icon={<Landmark size={24} />} status="Julio 2027" statusColor="gray" action="-" disabled />
              <TaxCard model="347" desc="Operaciones > 3k" icon={<FileCheck size={24} />} status="Feb 2027" statusColor="gray" action="-" disabled />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

// --- SUBCOMPONENTES ---

function TaxCard({ model, desc, icon, status, statusColor, value, action, isPrimary, disabled, onClick }) {
  const styles = { 
      green: "bg-green-50 text-green-700", 
      orange: "bg-orange-50 text-orange-700", 
      blue: "bg-blue-50 text-blue-700",
      red: "bg-red-50 text-red-700",
      gray: "bg-gray-100 text-gray-500" 
  };
  
  const formatVal = (v) => v !== undefined ? new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(v) : '-';

  return (
    <div className={`bg-white rounded-xl border border-border/20 p-5 flex flex-col gap-4 transition-all duration-300 ${disabled ? 'opacity-60 grayscale cursor-not-allowed' : 'hover:shadow-lg hover:border-primary/30 cursor-pointer group'}`} onClick={!disabled ? onClick : undefined}>
      <div className="flex justify-between items-start">
          <div className={`p-2 rounded-lg ${disabled ? 'bg-gray-100 text-gray-400' : 'bg-blue-50 text-primary'}`}>{icon}</div>
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${styles[statusColor]}`}>
              {status}
          </span>
      </div>
      <div>
          <p className="text-4xl font-black tracking-tight mb-1 text-text">{model}</p>
          <p className="text-sm font-medium text-text/60">{desc}</p>
      </div>
      <div className="mt-auto pt-4 border-t border-border/10 flex justify-between items-center">
          <span className="text-sm font-bold text-text">{formatVal(value)}</span>
          <span className={`text-sm font-bold flex items-center gap-1 transition-colors ${disabled ? 'text-gray-400' : isPrimary ? 'text-primary group-hover:underline' : 'text-text/60 group-hover:text-text'}`}>
              {action} {!disabled && isPrimary && <ArrowRight size={14}/>}
          </span>
      </div>
    </div>
  );
}