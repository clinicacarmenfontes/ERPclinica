import React, { useState, useEffect } from 'react';
import Sidebar from '../components/Sidebar';
import { supabase } from '../supabaseClient';
import readXlsxFile from 'read-excel-file';
import Papa from 'papaparse';
import { 
  Settings as SettingsIcon, UploadCloud, FileSpreadsheet, 
  Download, CheckCircle, Loader2, Trash2, Users, AlertTriangle, 
  XCircle, Hash, Terminal, Pencil, X, Save
} from 'lucide-react';

export default function Settings() {
  const [activeTab, setActiveTab] = useState('dictionaries');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);
  
  // ESTADO PARA EDICIÓN (MODAL)
  const [editingItem, setEditingItem] = useState(null); // El objeto que se está editando
  const [editingTable, setEditingTable] = useState(null); // La tabla a la que pertenece
  const [editingFields, setEditingFields] = useState([]); // Los campos editables (configuración)

  const [lastUploads, setLastUploads] = useState(() => {
    const saved = localStorage.getItem('lastUploads');
    return saved ? JSON.parse(saved) : {
      ingresos: null, gastos: null, deudores: null, acreedores: null
    };
  });

  const [treatmentData, setTreatmentData] = useState([]);
  const [expenseTypeData, setExpenseTypeData] = useState([]);
  const [mapIncomeData, setMapIncomeData] = useState([]);
  const [mapExpenseData, setMapExpenseData] = useState([]);
  const [treasuryData, setTreasuryData] = useState([]);
  const [amortizationData, setAmortizationData] = useState([]);
  const [openingData, setOpeningData] = useState([]);

  useEffect(() => { refreshAllTables(); }, [activeTab]);

  useEffect(() => {
    localStorage.setItem('lastUploads', JSON.stringify(lastUploads));
  }, [lastUploads]);

  const refreshAllTables = async () => {
    Promise.all([
      fetchTable('treatment_catalog', setTreatmentData),
      fetchTable('expense_catalog', setExpenseTypeData),
      fetchTableWhere('accounting_map', setMapIncomeData, 'category_type', 'Ingreso'),
      fetchTableWhere('accounting_map', setMapExpenseData, 'category_type', 'Gasto'),
      fetchTable('treasury_accounts', setTreasuryData),
      fetchTable('assets_amortization', setAmortizationData),
      fetchTable('opening_balances', setOpeningData)
    ]);
  };

  const fetchTable = async (table, setter) => {
    const { data } = await supabase.from(table).select('*').order('created_at', { ascending: false });
    if (data) setter(data);
  };

  const fetchTableWhere = async (table, setter, col, val) => {
    const { data } = await supabase.from(table).select('*').eq(col, val).order('created_at', { ascending: false });
    if (data) setter(data);
  };

  // --- LÓGICA DE EDICIÓN ---
  const handleEditClick = (item, tableName, cols, labels) => {
      // Preparamos la configuración del modal
      const fields = cols.map((key, index) => ({
          key: key,
          label: labels[index],
          value: item[key]
      }));
      
      setEditingTable(tableName);
      setEditingFields(fields);
      setEditingItem(item); // Abre el modal
  };

  const handleSaveEdit = async (formData) => {
      if (!editingItem || !editingTable) return;
      setLoading(true);
      try {
          const { error } = await supabase
              .from(editingTable)
              .update(formData)
              .eq('id', editingItem.id);

          if (error) throw error;

          setMessage({ type: 'success', text: 'Registro actualizado correctamente' });
          setEditingItem(null); // Cerrar modal
          refreshAllTables(); // Recargar datos visuales
      } catch (err) {
          console.error(err);
          setMessage({ type: 'error', text: `Error al actualizar: ${err.message}` });
      } finally {
          setLoading(false);
      }
  };

  // --- FIN LÓGICA EDICIÓN ---

  const handleDeleteAll = async (tableName) => {
    if (!window.confirm(`⛔ ¡PELIGRO!\n\nSe borrarán TODOS los datos de la tabla '${tableName}'.\n¿Estás seguro de que quieres continuar?`)) return;
    setLoading(true);
    try {
        const { error } = await supabase.from(tableName).delete().not('id', 'is', null);
        
        if (error) throw error;
        
        if (tableName === 'incomes') setLastUploads(p => ({...p, ingresos: null}));
        if (tableName === 'expenses') setLastUploads(p => ({...p, gastos: null}));
        if (tableName === 'patient_period_balances') setLastUploads(p => ({...p, deudores: null, acreedores: null}));

        setMessage({ type: 'success', text: `🗑️ Tabla '${tableName}' vaciada correctamente.` });
        refreshAllTables();
    } catch (err) {
        console.error(err);
        setMessage({ type: 'error', text: `Error al borrar: ${err.message}` });
    } finally {
        setLoading(false);
    }
  };

  const handleDeleteRow = async (table, id) => {
    if(!window.confirm("¿Eliminar registro?")) return;
    const { error } = await supabase.from(table).delete().eq('id', id);
    if (error) setMessage({ type: 'error', text: error.message });
    else refreshAllTables();
  };

  const normalizeKey = (key) => key ? String(key).toLowerCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "") : '';

  const readFileAsText = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const buffer = e.target.result;
        let decoder = new TextDecoder('windows-1252');
        let text = decoder.decode(buffer);
        if (text.includes('Ã±') || text.includes('Ã¡') || text.startsWith('ï»¿')) {
            decoder = new TextDecoder('utf-8');
            text = decoder.decode(buffer);
        }
        if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
        resolve(text);
      };
      reader.onerror = () => reject(new Error("Error lectura archivo."));
      reader.readAsArrayBuffer(file);
    });
  };

  const parseAmount = (val) => {
      if (!val) return 0;
      let str = String(val).trim();
      if (str.includes('.') && str.includes(',')) {
          str = str.replace(/\./g, '').replace(',', '.');
      } else if (str.includes(',')) {
          str = str.replace(',', '.');
      }
      return parseFloat(str.replace(/[^\d.-]/g, '')) || 0;
  };

  const safeString = (val, defaultVal = '') => {
      if (!val || val === 'undefined' || val === 'null') return defaultVal;
      const str = String(val).trim();
      return str === '' ? defaultVal : str;
  };

  const removeDuplicates = (data, type) => {
      const seen = new Set();
      return data.filter(item => {
          let key = '';
          if (type === 'import_ingresos') {
              key = item.invoice_number; 
          } 
          else if (type === 'import_gastos') {
              key = `${item.provider_invoice_number}-${item.provider_name}`.toLowerCase(); 
          }
          else if (type === 'patient_balances') {
              key = `${item.document_id}-${item.period_date}-${item.balance_type}`;
          }
          else {
              return true;
          }

          if (seen.has(key)) return false;
          seen.add(key);
          return true;
      });
  };

  const handleFileUpload = async (e, type, extraParam = null) => {
    const file = e.target.files[0];
    if (!file) return;
    setLoading(true);
    setMessage(null);

    try {
      let rawRows = [];
      if (file.name.toLowerCase().endsWith('.csv')) {
        const textContent = await readFileAsText(file);
        await new Promise((resolve, reject) => {
            Papa.parse(textContent, {
                header: true, skipEmptyLines: true, delimiter: ";",
                complete: (results) => { rawRows = results.data; resolve(); },
                error: (err) => reject(new Error("Error parsing CSV."))
            });
        });
      } else {
        const rows = await readXlsxFile(file);
        const headers = rows[0];
        rawRows = rows.slice(1).map(row => {
          let obj = {}; headers.forEach((h, i) => { obj[h] = row[i]; }); return obj;
        });
      }

      const data = rawRows.map(row => {
        let n = {}; Object.keys(row).forEach(k => n[normalizeKey(k)] = row[k]); return n;
      });

      let tableName = ''; let formattedData = []; let conflictTarget = 'id';
      let warningCount = 0;

      if (type === 'treatment_catalog') {
        tableName = 'treatment_catalog'; conflictTarget = 'name';
        formattedData = data.map(r => ({ name: safeString(r.nombre), account_code: safeString(r.asientocontable || r.cuentafinanciera), specialty: r.especialidad, price: parseAmount(r.precio) }));
      } 
      else if (type === 'expense_catalog') {
        tableName = 'expense_catalog'; conflictTarget = 'name';
        formattedData = data.map(r => ({ name: safeString(r.nombre), account_code: safeString(r.asientocontable), expense_type: r.fijovariable }));
      }
      else if (type === 'accounting_map') {
        tableName = 'accounting_map'; conflictTarget = 'concept_name';
        formattedData = data.map(r => ({ concept_name: safeString(r.nombre || r.concepto), account_code: safeString(r.asientocontable), category_type: extraParam, parent_group: r.tiposuperior || '' }));
      }
      else if (type === 'treasury') {
        tableName = 'treasury_accounts'; conflictTarget = 'account_code';
        formattedData = data.map(r => ({ internal_name: safeString(r.nombre), account_code: safeString(r.asientocontable), description: r.explicacion || '' }));
      }
      else if (type === 'amortization') {
        tableName = 'assets_amortization'; conflictTarget = 'asset_name';
        formattedData = data.map(r => ({
            asset_name: safeString(r.nombre || r.activo),
            asset_account: safeString(r.cuentaactivo || r.cuenta),
            expense_account: safeString(r.cuentagasto || r.amortizacion),
            accumulated_account: safeString(r.cuentaacumulada || r.acumulada),
            initial_value: parseAmount(r.valor || r.precio),
            annual_rate: parseAmount(r.porcentaje || r.tasa)
        }));
      }
      else if (type === 'opening') {
        tableName = 'opening_balances'; conflictTarget = 'account_code';
        formattedData = data.map(r => ({
          fiscal_year: 2026, account_code: safeString(r.cuentacontable), account_name: safeString(r.nombre),
          debit_balance: parseAmount(r.saldodebeinicial || r.debe), 
          credit_balance: parseAmount(r.saldohaberinicial || r.haber),
          description: r.explicacion || '', balance_side: r.debehaber || (parseAmount(r.saldodebeinicial) > 0 ? 'D' : 'H')
        }));
      }
      
      else if (type === 'import_ingresos') {
        tableName = 'incomes'; conflictTarget = 'invoice_number';
        formattedData = data.map(r => {
          const nif = safeString(r.docident || r.nif || r.dni);
          const cp = safeString(r.cpostal || r.codigopostal || r.cp);
          if (!nif || !cp) warningCount++;

          const total = parseAmount(r.cantidad || r.totalfactura);
          const quota = parseAmount(r.impuestos);
          const base = total - quota;

          let vatPercentage = 0;
          if (base > 0 && quota > 0) vatPercentage = Math.round((quota / base) * 100);

          return { 
            invoice_number: safeString(r.numfactura || r.factura || r.num), 
            issue_date: r.fechaemision || r.fecha, 
            client_name: safeString(r.nombrecliente, 'Cliente General'), 
            total_amount: total,
            vat_quota: quota,
            tax_base: base,
            vat_type: vatPercentage,
            client_nif: nif,
            postal_code: cp,
            payment_method: safeString(r.formadepago || r.formapago)
          };
        });
      }
      
      else if (type === 'import_gastos') {
        tableName = 'expenses'; conflictTarget = undefined; 
        formattedData = data.map(r => {
          const total = parseAmount(r.totalpagar || r.total);
          const taxEuro = parseAmount(r.impuestos); 
          const taxTypeStr = safeString(r.tipoimpuesto || r.tipo_impuesto); 

          const base = total - taxEuro;

          let vatPercentage = 0;
          const percentageMatch = taxTypeStr.match(/(\d+([.,]\d+)?)/); 
          if (percentageMatch) vatPercentage = parseFloat(percentageMatch[0].replace(',', '.'));

          return { 
            provider_invoice_number: safeString(r.numfacturaproveedor || r.numfactura), 
            issue_date: r.fechafactura || r.fecha, 
            provider_name: safeString(r.nombreproveedor, 'Proveedor Varios'), 
            total_payment: total,
            vat_quota: taxEuro,     
            tax_base: base,         
            vat_type: vatPercentage, 
            tax_description: taxTypeStr, 
            provider_cif: safeString(r.cif || r.nif),
            expense_type_label: safeString(r.tipogasto),
            payment_method: safeString(r.formadepago || r.formapago)
          };
        });
      }

      else if (type === 'patient_balances') {
        tableName = 'patient_period_balances'; 
        formattedData = data.map(r => ({
          period_date: new Date().toISOString().split('T')[0], 
          patient_name: safeString(r.nombre, 'Paciente'), 
          document_id: safeString(r.documentodeidentificacion || r.dni || r.documentodeidentificacian || r.docident),
          email: safeString(r.email), 
          phone: safeString(r.telefono || r.telafono || r.movil), 
          balance_amount: parseAmount(r.saldo), 
          balance_type: extraParam 
        }));
      }

      formattedData = formattedData.filter(item => {
          if (type.includes('catalog')) return item.name;
          if (type === 'accounting_map') return item.concept_name;
          if (type === 'import_ingresos') return item.invoice_number && item.issue_date;
          if (type === 'import_gastos') return item.provider_invoice_number && item.issue_date;
          if (type === 'patient_balances') return item.document_id;
          return Object.values(item).some(val => val !== '');
      });

      const initialCount = formattedData.length;
      formattedData = removeDuplicates(formattedData, type);
      const dedupCount = initialCount - formattedData.length;

      if (formattedData.length > 0) {
        let upsertConfig = { onConflict: conflictTarget };
        if (type === 'patient_balances') upsertConfig = { onConflict: 'document_id, period_date, balance_type' };
        if (type === 'import_gastos') upsertConfig = { onConflict: 'provider_invoice_number, provider_name' }; 

        const { error } = await supabase.from(tableName).upsert(formattedData, upsertConfig);
        if (error) throw error;
        
        const now = new Date().toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
        const newStats = { date: now, count: formattedData.length };
        
        if (type === 'import_ingresos') setLastUploads(prev => ({...prev, ingresos: newStats}));
        if (type === 'import_gastos') setLastUploads(prev => ({...prev, gastos: newStats}));
        if (type === 'patient_balances' && extraParam === 'Deudor') setLastUploads(prev => ({...prev, deudores: newStats}));
        if (type === 'patient_balances' && extraParam === 'Acreedor') setLastUploads(prev => ({...prev, acreedores: newStats}));

        let msg = `✅ Éxito: ${formattedData.length} registros cargados.`;
        if (dedupCount > 0) msg += ` (Se eliminaron ${dedupCount} duplicados).`;
        if (warningCount > 0 && type === 'import_ingresos') msg += ` ${warningCount} sin DNI/CP.`;

        setMessage({ type: 'success', text: msg });
        refreshAllTables();
      } else {
        setMessage({ type: 'error', text: "⚠️ Archivo vacío o datos no válidos." });
      }
    } catch (err) { 
      console.error(err);
      setMessage({ type: 'error', text: `ERROR TÉCNICO: ${err.message}` }); 
    } finally { 
      setLoading(false); 
      e.target.value = null; 
    }
  };

  const downloadTemplate = (type) => {
    let h = ""; let f = "";
    switch(type) {
      case 'treatment_catalog': h = "Nombre;Cuenta Financiera;Especialidad;Precio"; f = "tratamientos.csv"; break;
      case 'expense_catalog': h = "Nombre;Asiento contable;Fijo/Variable"; f = "tipos_gasto.csv"; break;
      case 'mapping_ingresos': h = "Concepto;Asiento Contable;Tipo Superior"; f = "mapeo_ingresos.csv"; break;
      case 'mapping_gastos': h = "Concepto;Asiento Contable;Tipo Superior"; f = "mapeo_gastos.csv"; break;
      case 'tesoreria': h = "Nombre;Asiento Contable;Explicación"; f = "tesoreria.csv"; break;
      case 'amortization': h = "Nombre;Cuenta Activo;Cuenta Gasto;Cuenta Acumulada;Valor;Porcentaje"; f = "amortizaciones.csv"; break;
      case 'opening': h = "cuenta_contable;nombre;saldo_debe_inicial;saldo_haber_inicial;explicacion;debe_haber"; f = "apertura.csv"; break;
      case 'patient_deudores': h = "Nombre;Documento de identificación;Email;Teléfono;Saldo"; f = "saldos_pacientes_deudores.csv"; break;
      case 'patient_acreedores': h = "Nombre;Documento de identificación;Email;Teléfono;Saldo"; f = "saldos_pacientes_acreedores.csv"; break;
      case 'ingresos': h = "fecha_emision;num_factura;doc_ident;nombre_cliente;c.postal;cantidad;impuestos;forma de pago"; f = "facturacion_ingresos.csv"; break;
      case 'gastos': h = "nombre_proveedor;cif;tipo_gasto;forma_pago;fecha_factura;total_pagar;impuestos;tipo_impuesto;num_factura_proveedor"; f = "facturacion_gastos.csv"; break;
    }
    const blob = new Blob([h], { type: 'text/csv;charset=ISO-8859-1;' });
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = f; link.click();
  };

  return (
    <div className="flex h-screen overflow-hidden bg-[#FFFBF7] font-dm text-[#4A4040]">
      <Sidebar />
      <main className="flex-1 flex flex-col h-screen overflow-y-auto relative">
        <header className="sticky top-0 z-20 border-b border-[#E6CDCD] bg-[#FFFBF7]/95 backdrop-blur-xl px-8 py-4">
          <div className="flex items-center gap-4">
            <div className="p-2 bg-[#8A5A62]/10 rounded-lg text-[#8A5A62]"><SettingsIcon size={24} /></div>
            <h2 className="text-xl font-bold font-montserrat text-[#5D4044]">Panel de Configuración</h2>
          </div>
        </header>

        <div className="p-8 max-w-[1400px] mx-auto w-full space-y-8 relative">
          {message && (
            <div className={`p-4 rounded-xl border flex items-center gap-3 animate-in fade-in ${message.type === 'success' ? 'bg-green-50 text-green-800 border-green-200' : 'bg-red-50 text-red-800 border-red-200'}`}>
              {message.type === 'success' ? <CheckCircle size={20}/> : <Terminal size={20}/>}
              <p className="font-medium font-mono text-sm break-all">{message.text}</p>
            </div>
          )}
          
          {loading && <div className="fixed inset-0 bg-white/50 backdrop-blur-sm z-50 flex items-center justify-center"><Loader2 size={40} className="animate-spin text-[#8A5A62]"/></div>}

          <div className="flex gap-6 border-b border-[#E6CDCD]">
            <TabButton label="1. Diccionarios" id="dictionaries" active={activeTab} onClick={setActiveTab} />
            <TabButton label="2. Contabilidad Gral." id="accounting" active={activeTab} onClick={setActiveTab} />
            <TabButton label="3. Movimientos" id="import" active={activeTab} onClick={setActiveTab} />
          </div>

          {/* Pasamos onEditClick a las secciones */}
          {activeTab === 'dictionaries' && (
            <div className="space-y-12 animate-in fade-in">
              <Section title="Tratamientos" tableName="treatment_catalog" data={treatmentData} cols={['name','account_code','specialty']} labels={['Nombre','Cuenta','Especialidad']} onUpload={(e)=>handleFileUpload(e,'treatment_catalog')} onDownload={()=>downloadTemplate('treatment_catalog')} onDeleteRow={(id)=>handleDeleteRow('treatment_catalog',id)} onDeleteAll={handleDeleteAll} onEdit={handleEditClick} />
              <Section title="Tipos de Gasto" tableName="expense_catalog" data={expenseTypeData} cols={['name','account_code','expense_type']} labels={['Gasto','Cuenta','Tipo']} onUpload={(e)=>handleFileUpload(e,'expense_catalog')} onDownload={()=>downloadTemplate('expense_catalog')} onDeleteRow={(id)=>handleDeleteRow('expense_catalog',id)} onDeleteAll={handleDeleteAll} onEdit={handleEditClick} />
            </div>
          )}

          {activeTab === 'accounting' && (
            <div className="space-y-12 animate-in fade-in">
              <Section title="Mapeo Ingresos" tableName="accounting_map" data={mapIncomeData} cols={['concept_name','account_code']} labels={['Concepto','Cuenta']} onUpload={(e)=>handleFileUpload(e,'accounting_map','Ingreso')} onDownload={()=>downloadTemplate('mapping_ingresos')} onDeleteRow={(id)=>handleDeleteRow('accounting_map',id)} onDeleteAll={handleDeleteAll} onEdit={handleEditClick} />
              <Section title="Mapeo Gastos" tableName="accounting_map" data={mapExpenseData} cols={['concept_name','account_code']} labels={['Concepto','Cuenta']} onUpload={(e)=>handleFileUpload(e,'accounting_map','Gasto')} onDownload={()=>downloadTemplate('mapping_gastos')} onDeleteRow={(id)=>handleDeleteRow('accounting_map',id)} onDeleteAll={handleDeleteAll} onEdit={handleEditClick} />
              <Section title="Tesorería" tableName="treasury_accounts" data={treasuryData} cols={['internal_name','account_code']} labels={['Nombre','Cuenta']} onUpload={(e)=>handleFileUpload(e,'treasury')} onDownload={()=>downloadTemplate('tesoreria')} onDeleteRow={(id)=>handleDeleteRow('treasury_accounts',id)} onDeleteAll={handleDeleteAll} onEdit={handleEditClick} />
              <Section title="Amortizaciones" tableName="assets_amortization" data={amortizationData} cols={['asset_name','asset_account','expense_account','initial_value','annual_rate']} labels={['Activo','Cta. Activo','Cta. Gasto','Valor','Tasa %']} onUpload={(e)=>handleFileUpload(e,'amortization')} onDownload={()=>downloadTemplate('amortization')} onDeleteRow={(id)=>handleDeleteRow('assets_amortization',id)} onDeleteAll={handleDeleteAll} onEdit={handleEditClick} />
              <Section title="Asiento Apertura" tableName="opening_balances" data={openingData} cols={['account_code','account_name','debit_balance','credit_balance']} labels={['Cuenta','Nombre','Debe','Haber']} onUpload={(e)=>handleFileUpload(e,'opening')} onDownload={()=>downloadTemplate('opening')} onDeleteRow={(id)=>handleDeleteRow('opening_balances',id)} onDeleteAll={handleDeleteAll} onEdit={handleEditClick} />
            </div>
          )}

          {activeTab === 'import' && (
            <div className="grid grid-cols-2 gap-8 animate-in fade-in">
              <UploadWidget title="Ingresos (Tratamientos)" stats={lastUploads.ingresos} onDownload={()=>downloadTemplate('ingresos')} onUpload={(e)=>handleFileUpload(e,'import_ingresos')} onDelete={()=>handleDeleteAll('incomes')} />
              <UploadWidget title="Gastos (Mensual)" stats={lastUploads.gastos} onDownload={()=>downloadTemplate('gastos')} onUpload={(e)=>handleFileUpload(e,'import_gastos')} onDelete={()=>handleDeleteAll('expenses')} />
              <UploadWidget title="Saldos Deudores" icon={<Users className="text-red-400"/>} stats={lastUploads.deudores} onDownload={()=>downloadTemplate('patient_deudores')} onUpload={(e)=>handleFileUpload(e,'patient_balances','Deudor')} onDelete={()=>handleDeleteAll('patient_period_balances')} />
              <UploadWidget title="Saldos Acreedores" icon={<Users className="text-green-400"/>} stats={lastUploads.acreedores} onDownload={()=>downloadTemplate('patient_acreedores')} onUpload={(e)=>handleFileUpload(e,'patient_balances','Acreedor')} onDelete={()=>handleDeleteAll('patient_period_balances')} />
            </div>
          )}
        </div>

        {/* MODAL DE EDICIÓN */}
        {editingItem && (
            <EditModal 
                item={editingItem} 
                fields={editingFields} 
                onClose={() => setEditingItem(null)} 
                onSave={handleSaveEdit} 
            />
        )}

      </main>
    </div>
  );
}

// COMPONENTES AUXILIARES ACTUALIZADOS

function Section({ title, tableName, data, cols, labels, onUpload, onDownload, onDeleteRow, onDeleteAll, onEdit }) {
  const hasData = data.length > 0;
  return (
    <div className="grid grid-cols-4 gap-6">
      <div className="col-span-1">
        <UploadWidget title={title} onUpload={onUpload} onDownload={onDownload} />
      </div>
      <div className="col-span-3 flex flex-col gap-3">
         <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2">
                <h4 className="text-sm font-bold text-[#5D4044]">{title}</h4>
                {hasData && <span className="text-xs text-green-700 font-medium flex items-center gap-1 bg-green-50 px-2 py-0.5 rounded-full"><CheckCircle size={12}/> {data.length} reg.</span>}
            </div>
            {hasData && (
                <button onClick={() => onDeleteAll(tableName)} className="flex items-center gap-1 text-[10px] font-bold text-red-400 hover:text-red-600 bg-red-50 px-2 py-1 rounded-md transition-colors" title="Borrar tabla">
                    <XCircle size={14}/> BORRAR TODO
                </button>
            )}
         </div>
        <EditableTable 
            data={data} 
            columns={cols.map((c, i) => ({ key: c, label: labels[i] }))} 
            onDeleteRow={(id) => onDeleteRow(tableName, id)} 
            hasData={hasData}
            onEdit={(item) => onEdit(item, tableName, cols, labels)} // Pasamos la función de editar
        />
      </div>
    </div>
  );
}

function EditableTable({ data, columns, onDeleteRow, hasData, onEdit }) {
  if (!hasData) return <div className="p-8 border-2 border-dashed border-[#E6CDCD] rounded-2xl text-center text-gray-300 italic text-sm font-dm">Sin datos. Sube un archivo CSV.</div>;
  return (
    <div className="bg-white rounded-2xl border border-[#E6CDCD] overflow-hidden shadow-sm max-h-[400px] overflow-auto relative">
      <table className="w-full text-left text-xs font-dm whitespace-nowrap">
        <thead className="bg-[#FDFCF8] sticky top-0 z-10 border-b border-[#E6CDCD]">
          <tr>{columns.map(c => <th key={c.key} className="p-4 text-[#8A5A62] font-bold uppercase tracking-tight bg-[#FDFCF8]">{c.label}</th>)}<th className="p-4 bg-[#FDFCF8] text-right">ACCIONES</th></tr>
        </thead>
        <tbody className="divide-y divide-[#F2E8E8]">
          {data.map(item => (
            <tr key={item.id} className="hover:bg-[#FDFCF8] transition-colors group">
              {columns.map(c => <td key={c.key} className="p-4 text-gray-700">{item[c.key]}</td>)}
              <td className="p-4 text-right sticky right-0 bg-white group-hover:bg-[#FDFCF8] flex justify-end gap-2">
                {/* BOTÓN EDITAR NUEVO */}
                <button onClick={() => onEdit(item)} className="text-blue-300 hover:text-blue-500 transition-colors p-1 bg-blue-50 hover:bg-blue-100 rounded-md">
                    <Pencil size={14}/>
                </button>
                <button onClick={() => onDeleteRow(item.id)} className="text-red-300 hover:text-red-500 transition-colors p-1 bg-red-50 hover:bg-red-100 rounded-md">
                    <Trash2 size={14}/>
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// NUEVO COMPONENTE: MODAL DE EDICIÓN
function EditModal({ item, fields, onClose, onSave }) {
    const [formData, setFormData] = useState(item);

    const handleChange = (key, value) => {
        setFormData(prev => ({ ...prev, [key]: value }));
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
                <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-[#FDFCF8]">
                    <h3 className="text-lg font-bold text-[#5D4044]">Editar Registro</h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20}/></button>
                </div>
                
                <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
                    {fields.map((field) => (
                        <div key={field.key} className="space-y-1">
                            <label className="text-xs font-bold text-[#8A5A62] uppercase tracking-wide">{field.label}</label>
                            <input 
                                type="text" 
                                value={formData[field.key] || ''} 
                                onChange={(e) => handleChange(field.key, e.target.value)}
                                className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:border-[#8A5A62] focus:ring-2 focus:ring-[#8A5A62]/20 outline-none text-sm text-gray-700 transition-all bg-gray-50 focus:bg-white"
                            />
                        </div>
                    ))}
                </div>

                <div className="px-6 py-4 bg-gray-50 flex justify-end gap-3 border-t border-gray-100">
                    <button onClick={onClose} className="px-4 py-2 text-sm font-bold text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors">Cancelar</button>
                    <button onClick={() => onSave(formData)} className="px-4 py-2 text-sm font-bold text-white bg-[#8A5A62] hover:bg-[#6D454B] rounded-lg shadow-lg shadow-[#8A5A62]/20 flex items-center gap-2 transition-all">
                        <Save size={16}/> Guardar Cambios
                    </button>
                </div>
            </div>
        </div>
    );
}

function UploadWidget({ title, onUpload, onDownload, stats, icon, onDelete }) {
  return (
    <div className="bg-white p-6 rounded-[24px] border border-[#E6CDCD] shadow-sm flex flex-col justify-between h-full relative overflow-hidden group hover:shadow-md transition-all">
      <div className="flex justify-between items-start mb-4">
        <div className="flex items-center gap-3">
            <div className={`p-2 bg-[#F2E8E8] rounded-lg ${stats ? 'bg-green-100 text-green-600' : 'text-[#8A5A62]'}`}>{icon || <UploadCloud size={20}/>}</div>
            <div>
                <h4 className="text-sm font-bold text-[#5D4044] font-montserrat">{title}</h4>
                {stats ? (
                    <div className="flex flex-col mt-1 animate-in fade-in">
                        <span className="text-[10px] text-green-600 font-bold flex items-center gap-1"><CheckCircle size={10}/> Última carga: {stats.date}</span>
                        <span className="text-[10px] text-gray-500 flex items-center gap-1"><Hash size={10}/> {stats.count} registros</span>
                    </div>
                ) : (
                    <p className="text-[10px] text-gray-400 mt-1">Esperando datos...</p>
                )}
            </div>
        </div>
        
        {stats && onDelete && (
            <button onClick={onDelete} className="text-red-400 hover:text-red-600 hover:bg-red-50 p-2 rounded-lg transition-colors" title="Borrar todos los datos"><Trash2 size={18} /></button>
        )}
      </div>

      <div className="space-y-2">
        <label className="flex items-center justify-center gap-2 w-full py-3 bg-[#8A5A62] text-white rounded-xl text-xs font-bold cursor-pointer hover:bg-[#6D454B] transition-all">
          <FileSpreadsheet size={14}/> {stats ? 'Actualizar CSV' : 'Importar CSV'} 
          <input type="file" className="hidden" accept=".csv,.xlsx" onChange={onUpload} />
        </label>
        {onDownload && <button onClick={onDownload} className="w-full text-[10px] text-[#B07D85] hover:underline flex items-center justify-center gap-1"><Download size={10}/> Plantilla</button>}
      </div>
    </div>
  );
}

function TabButton({ id, label, active, onClick }) {
  return <button onClick={() => onClick(id)} className={`pb-4 px-2 text-sm font-bold transition-all ${active === id ? 'border-b-2 border-[#8A5A62] text-[#8A5A62]' : 'text-gray-400 hover:text-gray-600'}`}>{label}</button>;
}