import React, { createContext, useState, useContext, useEffect } from 'react';
import { supabase } from '../supabaseClient'; // Importamos Supabase para leer datos reales

const NotificationContext = createContext();

export const useNotifications = () => useContext(NotificationContext);

export const NotificationProvider = ({ children }) => {
  const [notifications, setNotifications] = useState([]);
  
  // Guardamos IDs de notificaciones leídas en localStorage para que no reaparezcan al refrescar
  const [readIds, setReadIds] = useState(() => {
    const saved = localStorage.getItem('read_notifications');
    return saved ? JSON.parse(saved) : [];
  });

  // Guardar en localStorage cada vez que leemos una
  useEffect(() => {
    localStorage.setItem('read_notifications', JSON.stringify(readIds));
  }, [readIds]);

  // --- MOTOR DE ANÁLISIS ---
  useEffect(() => {
    const checkSystemStatus = async () => {
      const generatedNotes = [];
      const now = new Date();
      const currentMonth = now.getMonth();
      const currentYear = now.getFullYear();

      try {
        // 1. CHEQUEO DE CALIDAD DE DATOS (PACIENTES SIN DNI)
        // CORREGIDO: Ahora miramos la tabla 'patient_period_balances' en vez de facturas
        const { count: missingDniCount } = await supabase
          .from('patient_period_balances')
          .select('*', { count: 'exact', head: true })
          .or('document_id.is.null,document_id.eq.""'); // Busca DNI vacío o nulo

        if (missingDniCount > 0) {
          generatedNotes.push({
            id: 'data-quality-patients-dni', // ID nuevo para forzar aviso nuevo
            type: 'data',
            title: 'Pacientes sin DNI',
            message: `Atención: Hay ${missingDniCount} registros en "Saldos Pacientes" que no tienen DNI. Esto es necesario para la correcta identificación fiscal.`,
            time: 'Revisión automática',
            read: readIds.includes('data-quality-patients-dni')
          });
        }

        // 2. CHEQUEO DE RENTABILIDAD DEL MES ACTUAL
        const startOfMonth = new Date(currentYear, currentMonth, 1).toISOString();
        const endOfMonth = new Date(currentYear, currentMonth + 1, 0).toISOString();

        // Traemos ingresos del mes
        const { data: monthIncomes } = await supabase
          .from('incomes')
          .select('total_amount')
          .gte('issue_date', startOfMonth)
          .lte('issue_date', endOfMonth);
        
        // Traemos gastos del mes
        const { data: monthExpenses } = await supabase
          .from('expenses')
          .select('total_payment')
          .gte('issue_date', startOfMonth)
          .lte('issue_date', endOfMonth);

        const totalInc = monthIncomes?.reduce((sum, i) => sum + (i.total_amount || 0), 0) || 0;
        const totalExp = monthExpenses?.reduce((sum, e) => sum + (e.total_payment || 0), 0) || 0;

        if (totalExp > totalInc && totalInc > 0) {
           const deficit = totalExp - totalInc;
           generatedNotes.push({
            id: `alert-rentability-${currentMonth}`,
            type: 'insight',
            title: 'Alerta de Rentabilidad Mensual',
            message: `Cuidado: Este mes tus gastos superan a tus ingresos por ${new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(deficit)}. Revisa partidas extraordinarias.`,
            time: 'Hace un momento',
            read: readIds.includes(`alert-rentability-${currentMonth}`)
          });
        }

        // 3. CHEQUEO DE IMPUESTOS (Calendario Fiscal España)
        // Trimestres: Abril (1T), Julio (2T), Octubre (3T), Enero (4T)
        // Avisamos si estamos en el mes del impuesto y antes del día 25
        const taxMonths = [0, 3, 6, 9]; // Enero, Abril, Julio, Octubre (0-indexed)
        if (taxMonths.includes(currentMonth) && now.getDate() <= 25) {
            let modelName = "Modelo 303 (IVA)";
            let quarterName = "";
            if (currentMonth === 3) quarterName = "1er Trimestre";
            if (currentMonth === 6) quarterName = "2º Trimestre";
            if (currentMonth === 9) quarterName = "3er Trimestre";
            if (currentMonth === 0) { quarterName = "4º Trimestre + Anual"; modelName = "Modelos 303 y 390"; }

            generatedNotes.push({
                id: `tax-alert-${currentYear}-${currentMonth}`,
                type: 'tax',
                title: `Vencimiento Impuestos (${quarterName})`,
                message: `Recordatorio: El plazo para presentar el ${modelName} finaliza el día 20/30. Asegura que toda la documentación está subida.`,
                time: 'Calendario Fiscal',
                read: readIds.includes(`tax-alert-${currentYear}-${currentMonth}`)
            });
        }

        setNotifications(generatedNotes);

      } catch (err) {
        console.error("Error chequeando notificaciones:", err);
      }
    };

    checkSystemStatus();
  }, [readIds]); // Se re-ejecuta si leemos algo para actualizar el estado visual

  // Lógica para marcar como leída
  const markAsRead = (id) => {
    if (!readIds.includes(id)) {
        setReadIds(prev => [...prev, id]);
    }
    setNotifications(prev => prev.map(n => 
      n.id === id ? { ...n, read: true } : n
    ));
  };

  // Lógica para marcar todo
  const markAllRead = () => {
    const allIds = notifications.map(n => n.id);
    setReadIds(prev => [...new Set([...prev, ...allIds])]);
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  };

  const unreadCount = notifications.filter(n => !n.read).length;

  return (
    <NotificationContext.Provider value={{ notifications, unreadCount, markAsRead, markAllRead }}>
      {children}
    </NotificationContext.Provider>
  );
};