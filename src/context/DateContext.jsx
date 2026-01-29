import React, { createContext, useState, useContext } from 'react';
import { startOfMonth, endOfMonth } from 'date-fns';

const DateContext = createContext();

export const useDate = () => useContext(DateContext);

export const DateProvider = ({ children }) => {
  // Estado Global: Por defecto "Este mes"
  const [dateRange, setDateRange] = useState({
    startDate: startOfMonth(new Date()),
    endDate: endOfMonth(new Date()),
    label: 'Este mes' // Para saber qué botón marcar activo
  });

  return (
    <DateContext.Provider value={{ dateRange, setDateRange }}>
      {children}
    </DateContext.Provider>
  );
};