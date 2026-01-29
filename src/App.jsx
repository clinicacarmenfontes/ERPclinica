import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';

// Providers
import { NotificationProvider } from './context/NotificationContext';
import { DateProvider } from './context/DateContext';
import { AuthProvider, useAuth } from './context/AuthContext';

// Páginas
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Expenses from './pages/Expenses';
import Taxes from './pages/Impuestos';
import Journal from './pages/Journal'; // <--- NUEVA PÁGINA (Contabilidad)
import Reports from './pages/Reports';
import Incomes from './pages/Incomes';
import Patients from './pages/Patients';
import Settings from './pages/Settings';

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
              
              <Route path="/Impuestos" element={<ProtectedRoute><Taxes /></ProtectedRoute>} />
              <Route path="/journal" element={<ProtectedRoute><Journal /></ProtectedRoute>} /> {/* <--- NUEVA RUTA */}
              
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

// Forzando actualización de Vercel