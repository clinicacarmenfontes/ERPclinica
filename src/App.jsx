import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';

// Providers
import { NotificationProvider } from './context/NotificationContext';
import { DateProvider } from './context/DateContext';
import { AuthProvider, useAuth } from './context/AuthContext';

// Páginas (NOMBRES EN ESPAÑOL para evitar error de Vercel)
import Login from './pages/Login';
import Dashboard from './pages/Resumen';       // Archivo físico: Resumen.jsx
import Expenses from './pages/Gastos';         // Archivo físico: Gastos.jsx
import Taxes from './pages/Impuestos';         // Archivo físico: Impuestos.jsx
import Journal from './pages/Contabilidad';    // Archivo físico: Contabilidad.jsx
import Reports from './pages/Reportes';        // Archivo físico: Reportes.jsx
import Incomes from './pages/Ingresos';        // Archivo físico: Ingresos.jsx
import Patients from './pages/Pacientes';      // Archivo físico: Pacientes.jsx
import Settings from './pages/Configuracion';  // Archivo físico: Configuracion.jsx

// --- COMPONENTE DE PROTECCIÓN ---
const ProtectedRoute = ({ children }) => {
  const { user } = useAuth();
  if (!user) {
    return <Navigate to="/" replace />;
  }
  return children;
};

function App() {
  return (
    <AuthProvider>
      <NotificationProvider>
        <DateProvider>
          <BrowserRouter>
            <Routes>
              {/* Ruta pública (Login) */}
              <Route path="/" element={<Login />} />
              
              {/* Rutas Protegidas (Requieren Login) */}
              <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
              <Route path="/patients" element={<ProtectedRoute><Patients /></ProtectedRoute>} />
              <Route path="/incomes" element={<ProtectedRoute><Incomes /></ProtectedRoute>} />
              <Route path="/expenses" element={<ProtectedRoute><Expenses /></ProtectedRoute>} />
              
              {/* CORRECCIÓN: path="/taxes" para que coincida con el Sidebar */}
              <Route path="/taxes" element={<ProtectedRoute><Taxes /></ProtectedRoute>} />
              
              <Route path="/journal" element={<ProtectedRoute><Journal /></ProtectedRoute>} />
              <Route path="/reports" element={<ProtectedRoute><Reports /></ProtectedRoute>} />
              <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} /> 

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </BrowserRouter>
        </DateProvider>
      </NotificationProvider>
    </AuthProvider>
  );
}

export default App;