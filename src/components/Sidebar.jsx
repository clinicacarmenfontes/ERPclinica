import React from 'react';
import { NavLink } from 'react-router-dom';
import { 
  LayoutDashboard, 
  Users, 
  TrendingUp, 
  CreditCard, 
  FileText, 
  BookOpen, 
  Landmark, 
  LogOut, 
  Settings 
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
// IMPORTANTE: Asegúrate de que la ruta al logo es correcta
import logo from '../assets/logo_completo.svg'; 

export default function Sidebar() {
  const { signOut } = useAuth();

  const navItems = [
    { to: "/dashboard", icon: <LayoutDashboard size={20} />, label: "Dashboard" },
    { to: "/patients", icon: <Users size={20} />, label: "Pacientes" },
    { to: "/incomes", icon: <TrendingUp size={20} />, label: "Ingresos" },
    { to: "/expenses", icon: <CreditCard size={20} />, label: "Gastos" },
    { to: "/taxes", icon: <Landmark size={20} />, label: "Impuestos" },
    { to: "/journal", icon: <BookOpen size={20} />, label: "Contabilidad" },
    { to: "/reports", icon: <FileText size={20} />, label: "Reportes" },
  ];

  return (
    <aside className="w-64 bg-[#f4f0ec] border-r border-[#e6e1db] flex flex-col h-screen shrink-0 z-30">
      {/* LOGO AREA */}
      <div className="p-6 flex justify-center items-center mb-2">
        <img 
            src={logo} 
            alt="Clínica Carmen Fontes" 
            className="w-full max-w-[160px] h-auto object-contain" 
        />
      </div>

      <nav className="flex-1 px-4 flex flex-col gap-2">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200 ${
                isActive
                  ? "bg-[#8a5a62] text-white shadow-md shadow-[#8a5a62]/20"
                  : "text-[#5d4044] hover:bg-[#eaddd7]"
              }`
            }
          >
            {item.icon}
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="p-4 border-t border-[#e6e1db]">
        <NavLink to="/settings" className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-[#5d4044] hover:bg-[#eaddd7] mb-2">
            <Settings size={20} /> Configuración
        </NavLink>
        <button onClick={signOut} className="flex w-full items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-[#5d4044] hover:bg-[#eaddd7] transition-colors">
          <LogOut size={20} /> Cerrar Sesión
        </button>
      </div>
    </aside>
  );
}