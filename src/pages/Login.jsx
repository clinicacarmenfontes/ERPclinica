import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Mail, Lock, Loader2, ArrowRight, AlertCircle } from 'lucide-react';
// IMPORTACIÓN DE ASSETS
import logo from '../assets/logo_completo.svg'; 
import clinicaBg from '../assets/clinica.jpeg'; // <--- TU IMAGEN DE FONDO

export default function Login() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  
  const [formData, setFormData] = useState({
    email: '',
    password: ''
  });

  const { signIn } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      await signIn(formData.email, formData.password);
      navigate('/dashboard');
    } catch (err) {
      console.error("ERROR SUPABASE:", err);
      // Esto nos mostrará el mensaje técnico exacto en la cajita roja
      setError(err.message || 'Error desconocido');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* INYECCIÓN DE FUENTES (Montserrat + DM Sans) */}
      <style>
        {`
          @import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,300;400;500&family=Montserrat:wght@300;400;500;600&display=swap');
          .font-dm { font-family: 'DM Sans', sans-serif; }
          .font-montserrat { font-family: 'Montserrat', sans-serif; }
        `}
      </style>

      <div className="flex h-screen w-full bg-[#FFFBF7] font-dm text-[#4A4040] overflow-hidden">
        
        {/* ---------------------------------------------------------
            LADO IZQUIERDO: BRANDING ATMOSFÉRICO
        --------------------------------------------------------- */}
        <div className="hidden lg:flex w-1/2 relative flex-col justify-center items-center text-center p-12 overflow-hidden">
          
          {/* IMAGEN DE FONDO (TU CLÍNICA) */}
          <div 
            className="absolute inset-0 bg-cover bg-center"
            style={{ backgroundImage: `url(${clinicaBg})` }}
          ></div>
          
          {/* OVERLAY: ROSA PASTEL SEMI-OSCURO (Dusty Rose / Mauve) */}
          <div className="absolute inset-0 bg-gradient-to-br from-[#B38B91] to-[#6D4C53] opacity-90 mix-blend-multiply"></div>
          
          {/* CONTENIDO */}
          <div className="relative z-10 flex flex-col items-center animate-in fade-in zoom-in-95 duration-1000">
            
            {/* LOGO COMPLETO (h-64) */}
            <div className="mb-6 filter drop-shadow-xl hover:scale-105 transition-transform duration-700">
               <img src={logo} alt="Clínica Carmen Fontes" className="h-64 w-auto object-contain" />
            </div>

            {/* CLAIM (Alineado al logo) */}
            <div className="max-w-md space-y-4">
              <div className="w-16 h-[1px] bg-white/40 mx-auto mb-4"></div>
              <p className="text-xl text-white/90 font-montserrat font-light tracking-wide leading-relaxed italic">
                "Excelencia clínica y gestión integral para el cuidado de tu salud y belleza."
              </p>
            </div>
            
          </div>

          {/* Copyright alineado */}
          <div className="absolute bottom-8 text-white/40 text-[10px] font-montserrat tracking-[0.2em] uppercase">
            Clínica Carmen Fontes © 2026
          </div>
        </div>

        {/* ---------------------------------------------------------
            LADO DERECHO: FORMULARIO FLOTANTE
        --------------------------------------------------------- */}
        <div className="w-full lg:w-1/2 flex flex-col justify-center items-center p-8 relative bg-[#FFFBF7]">
          
          {/* TARJETA ELEVABLE (Efecto Glass sutil) */}
          <div className="w-full max-w-[420px] bg-white/50 backdrop-blur-sm p-10 rounded-[32px] shadow-[0_20px_40px_-15px_rgba(180,150,150,0.1)] border border-white/60 hover:shadow-[0_25px_50px_-12px_rgba(180,150,150,0.2)] transition-shadow duration-500 animate-in slide-in-from-right-8 duration-700">
            
            <div className="text-left mb-8">
              <h1 className="text-3xl font-montserrat font-medium text-[#5D4044] mb-2 tracking-tight">
                Bienvenido
              </h1>
              <p className="text-[#9C8C90] text-sm font-dm">
                Área privada de gestión.
              </p>
            </div>

            {error && (
              <div className="bg-[#FFF0F0] text-[#9F1239] text-sm p-4 rounded-2xl flex items-start gap-3 border border-[#FCDCDC] shadow-sm mb-6 font-medium">
                <AlertCircle size={18} className="shrink-0 mt-0.5" /> 
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-6">
              
              {/* INPUT EMAIL CON EFECTO ELEVACIÓN */}
              <div className="space-y-2 group">
                <label className="text-xs font-bold text-[#A87C84] uppercase tracking-widest ml-1 transition-colors group-focus-within:text-[#8A5A62]">Correo Profesional</label>
                <div className="relative transform transition-transform duration-300 group-hover:-translate-y-1">
                  <div className="absolute left-4 top-1/2 -translate-y-1/2 text-[#D4A5A5] transition-colors group-focus-within:text-[#8A5A62]">
                     <Mail size={20} />
                  </div>
                  <input 
                    type="email" 
                    required 
                    placeholder="usuario@clinica.com"
                    className="w-full pl-12 pr-4 py-4 bg-white border border-[#E6CDCD] rounded-2xl focus:border-[#B07D85] focus:ring-4 focus:ring-[#F2E8E8] focus:outline-none transition-all font-dm text-[#5D4044] placeholder:text-[#E0D0D0] shadow-sm group-hover:shadow-md"
                    value={formData.email}
                    onChange={(e) => setFormData({...formData, email: e.target.value})}
                  />
                </div>
              </div>

              {/* INPUT PASSWORD CON EFECTO ELEVACIÓN */}
              <div className="space-y-2 group">
                <label className="text-xs font-bold text-[#A87C84] uppercase tracking-widest ml-1 transition-colors group-focus-within:text-[#8A5A62]">Contraseña</label>
                <div className="relative transform transition-transform duration-300 group-hover:-translate-y-1">
                   <div className="absolute left-4 top-1/2 -translate-y-1/2 text-[#D4A5A5] transition-colors group-focus-within:text-[#8A5A62]">
                     <Lock size={20} />
                  </div>
                  <input 
                    type="password" 
                    required 
                    placeholder="••••••••"
                    className="w-full pl-12 pr-4 py-4 bg-white border border-[#E6CDCD] rounded-2xl focus:border-[#B07D85] focus:ring-4 focus:ring-[#F2E8E8] focus:outline-none transition-all font-dm text-[#5D4044] placeholder:text-[#E0D0D0] shadow-sm group-hover:shadow-md"
                    value={formData.password}
                    onChange={(e) => setFormData({...formData, password: e.target.value})}
                  />
                </div>
              </div>

              <div className="pt-4">
                <button 
                  type="submit" 
                  disabled={loading}
                  className="w-full bg-[#8A5A62] text-white font-montserrat font-medium py-4 rounded-2xl shadow-[0_10px_25px_-5px_rgba(138,90,98,0.3)] hover:bg-[#6D454B] hover:shadow-[0_15px_30px_-5px_rgba(138,90,98,0.4)] hover:-translate-y-1 transition-all duration-300 flex items-center justify-center gap-3 text-sm tracking-widest uppercase"
                >
                  {loading ? <Loader2 size={20} className="animate-spin" /> : (
                     <>Acceder <ArrowRight size={18}/></>
                  )}
                </button>
              </div>
            </form>

            <div className="text-center pt-8 mt-2">
              <button className="text-[#B07D85] text-xs font-bold hover:text-[#8A5A62] transition-colors hover:underline">
                ¿Necesitas ayuda? Contactar Soporte
              </button>
            </div>

          </div>
        </div>

      </div>
    </>
  );
}