import React, { createContext, useState, useContext } from 'react';

// Creamos el contexto (la nube de datos)
const NotificationContext = createContext();

export const useNotifications = () => useContext(NotificationContext);

export const NotificationProvider = ({ children }) => {
  // AQUÍ ESTADO GLOBAL: Estos datos persistirán aunque cambies de página
  const [notifications, setNotifications] = useState([
    {
      id: 1,
      type: 'tax',
      title: 'Vencimiento Modelo 303',
      message: 'El plazo para el IVA del 1T finaliza el 20 de Abril. Tienes 3 facturas pendientes de revisar.',
      time: 'Hace 2 horas',
      read: false
    },
    {
      id: 2,
      type: 'insight',
      title: 'Alerta de Rentabilidad',
      message: 'El margen de beneficio ha bajado un 3% este trimestre. El gasto en "Laboratorio" ha subido inusualmente.',
      time: 'Ayer, 09:30',
      read: false
    },
    {
      id: 3,
      type: 'data',
      title: 'Calidad de Datos',
      message: 'Hay 3 pacientes nuevos sin DNI registrado. Esto impedirá generar el Modelo 347 correctamente.',
      time: 'Ayer, 16:00',
      read: false
    },
    {
      id: 4,
      type: 'cashflow',
      title: 'Previsión de Tesorería',
      message: 'Se prevé un cargo de Seguridad Social de 4.500€ el día 30. Asegura saldo en la cuenta principal.',
      time: 'Hace 2 días',
      read: true
    }
  ]);

  // Lógica para marcar como leída
  const markAsRead = (id) => {
    setNotifications(prev => prev.map(n => 
      n.id === id ? { ...n, read: true } : n
    ));
  };

  // Lógica para marcar todo
  const markAllRead = () => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  };

  const unreadCount = notifications.filter(n => !n.read).length;

  return (
    <NotificationContext.Provider value={{ notifications, unreadCount, markAsRead, markAllRead }}>
      {children}
    </NotificationContext.Provider>
  );
};