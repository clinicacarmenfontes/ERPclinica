import React, { useState, useEffect, useMemo } from 'react';
import Sidebar from '../components/Sidebar';
import Notifications from '../components/Notifications';
import { supabase } from '../supabaseClient';
import { 
  Search, ChevronDown, ChevronRight, FileSpreadsheet, 
  AlertCircle, User, FileText, AlertTriangle, Loader2, CheckCircle2, Phone,
  TrendingUp, TrendingDown, Wallet, ArrowRightLeft
} from 'lucide-react';

// --- UTILIDADES ---
const currency = (val) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(val || 0);

// Función de limpieza numérica "Todoterreno"
const parseBalance = (val) => {
    if (!val) return 0;
    if (typeof val === 'number') return val;
    
    let str = String(val).trim();
    // Si el string está vacío o es nulo
    if (!str) return 0;

    // Detectamos formato europeo (1.000,00) vs formato inglés (1,000.00) vs formato científico
    // Estrategia: Reemplazar comas por puntos si parece ser el separador decimal
    if (str.includes(',') && !str.includes('.')) {
        str = str.replace(',', '.');
    } else if (str.includes('.') && str.includes(',')) {
        // Asumimos que el último separador es el decimal
        if (str.lastIndexOf(',') > str.lastIndexOf('.')) {
            str = str.replace(/\./g, '').replace(',', '.'); // Europeo 1.000,00 -> 1000.00
        } else {
            str = str.replace(/,/g, ''); // Inglés 1,000.00 -> 1000.00
        }
    }
    
    const num = parseFloat(str);
    return isNaN(num) ? 0 : num;
};

export default function Patients() {
  const [activeTab, setActiveTab] = useState('list');
  const [expandedRows, setExpandedRows] = useState({});
  const [loading, setLoading] = useState(true);
  
  // Estado para datos
  const [patients, setPatients] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    fetchPatientsData();
  }, []);

  const fetchPatientsData = async () => {
    try {
      setLoading(true);
      
      // 1. Traer Facturas (Ingresos)
      const { data: incomesData } = await supabase
        .from('incomes')
        .select('*')
        .order('issue_date', { ascending: false });

      // 2. Traer Datos de Saldos
      const { data: balanceData } = await supabase
        .from('patient_period_balances')
        .select('*')
        .order('period_date', { ascending: true }); // El último sobrescribe al anterior

      const grouped = {};

      // 3. Procesar Saldos
      balanceData?.forEach(b => {
          const rawName = b.patient_name || 'Paciente Desconocido';
          const nameKey = rawName.toUpperCase().trim();

          if (!grouped[nameKey]) {
              grouped[nameKey] = {
                  id: nameKey,
                  name: rawName,
                  dni: b.document_id,
                  phone: b.phone,
                  totalInvoicedRaw: 0,
                  invoices: [],
                  missingData: [],
                  balanceAmount: 0,
                  balanceType: null
              };
          }
          // Actualizar datos contacto (la última fecha manda)
          if (b.phone) grouped[nameKey].phone = b.phone;
          if (b.document_id) grouped[nameKey].dni = b.document_id;
          
          // --- LÓGICA CORREGIDA ---
          const amount = parseBalance(b.balance_amount);
          
          // Limpieza agresiva del tipo (quitar espacios, saltos de línea invisibles)
          const rawType = b.balance_type ? String(b.balance_type).toLowerCase().trim() : '';
          
          let type = null;
          if (rawType.includes('deudor')) type = 'Deudor';
          else if (rawType.includes('acreedor')) type = 'Acreedor';

          if (amount !== 0) {
              grouped[nameKey].balanceAmount = amount;
              grouped[nameKey].balanceType = type;
          }
      });

      // 4. Procesar Facturas
      incomesData?.forEach(inv => {
        const rawName = inv.client_name || 'Paciente Desconocido';
        const nameKey = rawName.toUpperCase().trim();

        if (!grouped[nameKey]) {
          grouped[nameKey] = {
            id: nameKey, 
            name: rawName,
            dni: inv.client_nif || null,
            phone: null, 
            totalInvoicedRaw: 0,
            invoices: [],
            missingData: [],
            balanceAmount: 0,
            balanceType: null
          };
        }

        grouped[nameKey].totalInvoicedRaw += (inv.total_amount || 0);

        grouped[nameKey].invoices.push({
          id: inv.invoice_number,
          date: inv.issue_date,
          concept: 'Tratamiento / Factura', 
          amount: inv.total_amount,
          status: 'Emitida'
        });

        if (!grouped[nameKey].dni && inv.client_nif) {
          grouped[nameKey].dni = inv.client_nif;
        }
      });

      // 5. Array Final
      const patientsArray = Object.values(grouped).map(p => {
        p.totalInvoiced = currency(p.totalInvoicedRaw);
        p.invoices.forEach(i => { i.amountFormatted = currency(i.amount); });

        // Control de Calidad
        if (!p.dni || p.dni === 'null' || p.dni.trim() === '') p.missingData.push('Falta DNI');
        
        return p;
      });

      setPatients(patientsArray.sort((a, b) => a.name.localeCompare(b.name)));

    } catch (error) {
      console.error("Error cargando pacientes:", error);
    } finally {
      setLoading(false);
    }
  };

  const toggleRow = (id) => { setExpandedRows(prev => ({ ...prev, [id]: !prev[id] })); };

  // Filtrados
  const filteredPatients = useMemo(() => {
      return patients.filter(p => 
        p.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
        (p.dni && p.dni.toLowerCase().includes(searchTerm.toLowerCase()))
      );
  }, [patients, searchTerm]);

  const errorPatients = useMemo(() => filteredPatients.filter(p => p.missingData.length > 0), [filteredPatients]);
  
  // FILTRO SALDOS: Solo mostrar si el importe es significativo (> 0.01)
  const balancePatients = useMemo(() => {
      return filteredPatients.filter(p => Math.abs(p.balanceAmount) > 0.01).sort((a,b) => b.balanceAmount - a.balanceAmount);
  }, [filteredPatients]);

  // Totales para gráfico
  const totalDeudores = balancePatients
    .filter(p => p.balanceType === 'Deudor')
    .reduce((sum, p) => sum + p.balanceAmount, 0);

  const totalAcreedores = balancePatients
    .filter(p => p.balanceType === 'Acreedor')
    .reduce((sum, p) => sum + p.balanceAmount, 0);

  const handleExport = () => {
    const headers = ["Paciente", "DNI", "Teléfono", "Total Facturado", "Saldo Pendiente", "Tipo Saldo"];
    const csvContent = [
      headers.join(";"), 
      ...patients.map(p => [
        `"${p.name}"`, p.dni || "", p.phone || "", 
        p.totalInvoicedRaw.toFixed(2).replace('.', ','),
        p.balanceAmount.toFixed(2).replace('.', ','),
        p.balanceType || "-"
      ].join(";"))
    ].join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `pacientes.csv`; document.body.appendChild(link); link.click(); document.body.removeChild(link);
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background font-sans text-[#161313]">
      <Sidebar />
      <main className="flex-1 flex flex-col h-screen overflow-y-auto bg-background relative">
        
        {/* HEADER */}
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-border/20 bg-background/95 backdrop-blur-md px-8 py-4 shrink-0">
          <div className="flex items-center gap-4">
            <div className="p-2 bg-primary/10 rounded-lg text-primary"><User size={28} /></div>
            <div><h2 className="text-text text-xl font-bold tracking-tight font-serif">Pacientes</h2><p className="text-xs text-text/50 font-medium uppercase tracking-wider">Directorio y Facturación</p></div>
          </div>
          <div className="flex items-center gap-6">
            <div className="relative hidden md:block group">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text/40 pointer-events-none"><Search size={18} /></span>
                <input className="bg-white border border-border/50 pl-10 pr-4 py-2 rounded-xl text-sm focus:outline-none focus:border-primary/50 w-64 transition-all shadow-sm" placeholder="Buscar..." type="text" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
            </div>
            <Notifications />
            <img 
            src="/icon.svg" 
            alt="Perfil" 
          className="size-10 rounded-full border-2 border-white shadow-md bg-white p-1 object-contain"
/>
        </header>

        <div className="flex-1 p-8 max-w-[1400px] mx-auto w-full flex flex-col gap-6 h-full overflow-hidden">
          
          {/* TABS */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 shrink-0">
            <div className="bg-white/60 p-1.5 rounded-xl border border-border/20 backdrop-blur-sm flex gap-1 shadow-sm w-fit">
              <button onClick={() => setActiveTab('list')} className={`px-5 py-2 text-sm font-bold rounded-lg transition-all ${activeTab === 'list' ? 'bg-white text-primary shadow-sm border border-border/10' : 'text-text/60 hover:text-text'}`}>Listado General</button>
              <button onClick={() => setActiveTab('errors')} className={`px-5 py-2 text-sm font-bold rounded-lg transition-all flex items-center gap-2 ${activeTab === 'errors' ? 'bg-white text-orange-600 shadow-sm border border-border/10' : 'text-text/60 hover:text-text'}`}>
                  Calidad {errorPatients.length > 0 ? <span className="bg-orange-100 text-orange-600 text-[10px] px-2 py-0.5 rounded-full">{errorPatients.length}</span> : <CheckCircle2 size={14} className="text-green-500"/>}
              </button>
              <button onClick={() => setActiveTab('balances')} className={`px-5 py-2 text-sm font-bold rounded-lg transition-all flex items-center gap-2 ${activeTab === 'balances' ? 'bg-white text-blue-600 shadow-sm border border-border/10' : 'text-text/60 hover:text-text'}`}>
                  Saldos y Deudas {balancePatients.length > 0 && <span className="bg-blue-100 text-blue-600 text-[10px] px-2 py-0.5 rounded-full">{balancePatients.length}</span>}
              </button>
            </div>
            <div>
                <button onClick={handleExport} className="flex items-center gap-2 bg-white px-4 py-2.5 rounded-xl border border-border/20 text-sm font-medium text-text shadow-sm hover:border-green-600/30 hover:text-green-700 transition-all group">
                    <FileSpreadsheet size={18} className="text-green-600 group-hover:scale-110 transition-transform" /><span>Exportar</span>
                </button>
            </div>
          </div>

          {loading && <div className="flex items-center justify-center h-full text-primary"><Loader2 size={40} className="animate-spin"/></div>}

          {/* VISTA 1: LISTADO GENERAL */}
          {!loading && activeTab === 'list' && (
            <div className="bg-white rounded-3xl shadow-[0_2px_20px_-5px_rgba(0,0,0,0.05)] border border-border/10 flex flex-col flex-1 overflow-hidden">
              <div className="overflow-y-auto flex-1">
                <table className="w-full text-left border-collapse">
                  <thead className="sticky top-0 z-10 bg-[#f9f8f6] shadow-sm"><tr className="border-b border-border/10"><th className="py-4 px-6 w-10"></th><th className="py-4 px-6 text-xs font-bold text-text/50 uppercase">Paciente</th><th className="py-4 px-6 text-xs font-bold text-text/50 uppercase">DNI / NIF</th><th className="py-4 px-6 text-xs font-bold text-text/50 uppercase text-right">Facturado Histórico</th><th className="py-4 px-6 text-xs font-bold text-text/50 uppercase text-center">Estado</th></tr></thead>
                  <tbody className="divide-y divide-border/5">
                    {filteredPatients.map((patient) => (
                      <React.Fragment key={patient.id}>
                        <tr className={`group hover:bg-surface/30 transition-colors cursor-pointer ${expandedRows[patient.id] ? 'bg-surface/50' : ''}`} onClick={() => toggleRow(patient.id)}>
                          <td className="py-4 px-6 text-center">{expandedRows[patient.id] ? <ChevronDown size={20} className="text-primary" /> : <ChevronRight size={20} className="text-text/40 group-hover:text-primary" />}</td>
                          <td className="py-4 px-6"><div className="font-bold text-text">{patient.name}</div>{patient.phone && <div className="text-xs text-text/50 flex items-center gap-1 mt-1"><Phone size={10}/> {patient.phone}</div>}</td>
                          <td className="py-4 px-6 font-mono text-sm text-text/70">{patient.dni || '--'}</td>
                          <td className="py-4 px-6 text-right font-bold text-text">{patient.totalInvoiced}</td>
                          <td className="py-4 px-6 text-center"><span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-bold ${patient.missingData.length > 0 ? 'bg-orange-50 text-orange-600 border border-orange-100' : 'bg-green-50 text-green-700 border border-green-100'}`}>{patient.missingData.length > 0 ? 'Revisar' : 'Ok'}</span></td>
                        </tr>
                        {expandedRows[patient.id] && (
                            <tr className="bg-surface/30 shadow-inner"><td colSpan="6" className="p-0"><div className="px-16 py-6 border-b border-border/10">
                                <h4 className="text-xs font-bold text-text/50 uppercase mb-4 flex gap-2 items-center tracking-widest"><FileText size={14}/> Facturas</h4>
                                {patient.invoices.length > 0 ? <table className="w-full text-sm bg-white rounded-lg border border-border/10 overflow-hidden"><thead><tr className="bg-gray-50 text-text/40 border-b border-border/10"><th className="py-2 px-4 text-left">Fecha</th><th className="py-2 px-4 text-left">Nº</th><th className="py-2 px-4 text-left">Concepto</th><th className="py-2 px-4 text-right">Importe</th></tr></thead><tbody className="divide-y divide-border/5">{patient.invoices.map((inv, i) => (<tr key={i} className="hover:bg-gray-50"><td className="py-2 px-4 text-text/70">{inv.date ? new Date(inv.date).toLocaleDateString() : '-'}</td><td className="py-2 px-4 font-mono text-xs">{inv.id}</td><td className="py-2 px-4">{inv.concept}</td><td className="py-2 px-4 text-right font-medium">{inv.amountFormatted}</td></tr>))}</tbody></table> : <p className="text-sm italic text-gray-400">Sin facturas.</p>}
                            </div></td></tr>
                        )}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* VISTA 2: CONTROL CALIDAD */}
          {!loading && activeTab === 'errors' && (
            <div className="flex flex-col gap-6 overflow-y-auto pb-4">
              {errorPatients.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {errorPatients.map(patient => (
                        <div key={patient.id} className="bg-white p-6 rounded-2xl border border-border/20 shadow-sm relative overflow-hidden group hover:border-orange-300 transition-all">
                            <div className="absolute top-0 left-0 w-1.5 h-full bg-orange-500"></div>
                            <h4 className="font-bold text-text text-lg mb-1 truncate" title={patient.name}>{patient.name}</h4>
                            <div className="flex flex-col gap-2 mt-4">{patient.missingData.map((err, i) => (<div key={i} className="flex items-center gap-2 text-xs text-red-700 bg-red-50 px-3 py-2 rounded-lg font-medium border border-red-100"><AlertCircle size={14} /> {err}</div>))}</div>
                        </div>
                        ))}
                  </div>
              ) : <div className="flex flex-col items-center justify-center h-full py-20 text-center"><div className="bg-green-100 p-6 rounded-full text-green-600 mb-6"><CheckCircle2 size={64} /></div><h3 className="text-2xl font-bold text-text">Datos Perfectos</h3></div>}
            </div>
          )}

          {/* VISTA 3: SALDOS Y DEUDAS */}
          {!loading && activeTab === 'balances' && (
            <div className="flex flex-col gap-6 h-full overflow-hidden">
                {/* GRÁFICO SUPERIOR */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 shrink-0">
                    <div className="bg-white p-6 rounded-2xl border border-border/20 shadow-sm flex items-center justify-between relative overflow-hidden">
                        <div className="absolute right-0 top-0 p-4 opacity-10"><TrendingDown size={100} className="text-red-500"/></div>
                        <div>
                            <p className="text-sm font-bold text-red-600 uppercase tracking-wider mb-1 flex items-center gap-2"><ArrowRightLeft size={16}/> A favor de la Clínica</p>
                            <h3 className="text-3xl font-black text-text">{currency(totalDeudores)}</h3>
                            <p className="text-xs text-text/50 mt-2">Pacientes deudores (Activo)</p>
                        </div>
                    </div>
                    <div className="bg-white p-6 rounded-2xl border border-border/20 shadow-sm flex items-center justify-between relative overflow-hidden">
                        <div className="absolute right-0 top-0 p-4 opacity-10"><TrendingUp size={100} className="text-green-500"/></div>
                        <div>
                            <p className="text-sm font-bold text-green-600 uppercase tracking-wider mb-1 flex items-center gap-2"><Wallet size={16}/> A favor del Paciente</p>
                            <h3 className="text-3xl font-black text-text">{currency(totalAcreedores)}</h3>
                            <p className="text-xs text-text/50 mt-2">Anticipos no consumidos (Pasivo)</p>
                        </div>
                    </div>
                </div>

                {/* TABLA DE SALDOS */}
                <div className="bg-white rounded-3xl shadow-sm border border-border/10 flex flex-col flex-1 overflow-hidden">
                    <div className="px-6 py-4 border-b border-border/10 bg-[#f9f8f6] flex justify-between items-center">
                        <h3 className="font-bold text-text flex items-center gap-2"><ArrowRightLeft size={18} className="text-blue-500"/> Detalle de Saldos Vivos</h3>
                    </div>
                    <div className="overflow-y-auto flex-1">
                        <table className="w-full text-left border-collapse text-sm">
                            <thead className="sticky top-0 z-10 bg-white shadow-sm">
                                <tr className="text-text/50 border-b border-border/10">
                                    <th className="py-3 px-6 font-bold uppercase">Paciente</th>
                                    <th className="py-3 px-6 font-bold uppercase">Teléfono</th>
                                    <th className="py-3 px-6 font-bold uppercase text-right">Saldo</th>
                                    <th className="py-3 px-6 font-bold uppercase text-center">Estado</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border/5">
                                {balancePatients.length === 0 ? (
                                    <tr><td colSpan="4" className="p-8 text-center text-gray-400">No hay saldos pendientes registrados.</td></tr>
                                ) : (
                                    balancePatients.map(p => (
                                        <tr key={p.id} className="hover:bg-gray-50 transition-colors">
                                            <td className="py-3 px-6 font-medium text-text">{p.name}</td>
                                            <td className="py-3 px-6 text-text/60">{p.phone || '-'}</td>
                                            <td className={`py-3 px-6 text-right font-bold font-mono ${p.balanceType === 'Deudor' ? 'text-red-600' : 'text-green-600'}`}>
                                                {currency(p.balanceAmount)}
                                            </td>
                                            <td className="py-3 px-6 text-center">
                                                {p.balanceType === 'Deudor' ? (
                                                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-red-50 text-red-700 text-xs font-bold border border-red-100">
                                                        <TrendingDown size={12}/> Debe
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-green-50 text-green-700 text-xs font-bold border border-green-100">
                                                        <TrendingUp size={12}/> Haber
                                                    </span>
                                                )}
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
          )}

        </div>
      </main>
    </div>
  );
}