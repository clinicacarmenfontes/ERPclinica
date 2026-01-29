import React, { useState, useRef, useEffect } from 'react';
import { useNotifications } from '../context/NotificationContext'; // <--- CONEXIÓN AL CEREBRO
import { 
  Bell, Calendar, TrendingDown, AlertTriangle, Euro, Info, FileWarning
} from 'lucide-react';

export default function Notifications() {
  const { notifications, unreadCount, markAsRead, markAllRead } = useNotifications(); // Usamos los datos globales
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  // Cerrar al hacer clic fuera
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [dropdownRef]);

  // Helpers visuales
  const getIcon = (type) => {
    switch(type) {
      case 'tax': return <Calendar size={16} className="text-red-600" />;
      case 'insight': return <TrendingDown size={16} className="text-purple-600" />;
      case 'data': return <FileWarning size={16} className="text-orange-600" />;
      case 'cashflow': return <Euro size={16} className="text-blue-600" />;
      default: return <Info size={16} className="text-gray-600" />;
    }
  };

  const getBgColor = (type) => {
    switch(type) {
      case 'tax': return "bg-red-50 border-red-100";
      case 'insight': return "bg-purple-50 border-purple-100";
      case 'data': return "bg-orange-50 border-orange-100";
      case 'cashflow': return "bg-blue-50 border-blue-100";
      default: return "bg-gray-50 border-gray-100";
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className={`relative p-2 rounded-xl transition-all duration-200 ${isOpen ? 'bg-primary/10 text-primary' : 'text-text/60 hover:text-primary hover:bg-surface'}`}
      >
        <Bell size={20} />
        {unreadCount > 0 && (
          <span className="absolute top-1.5 right-2 size-2.5 bg-red-500 rounded-full border-2 border-background animate-pulse"></span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-3 w-80 md:w-96 bg-white rounded-2xl shadow-xl border border-border/20 overflow-hidden z-50 animate-in fade-in zoom-in-95 duration-200 origin-top-right">
          <div className="px-4 py-3 border-b border-border/10 bg-surface/50 flex justify-between items-center backdrop-blur-sm">
            <h3 className="font-bold text-sm text-text">Notificaciones Inteligentes</h3>
            {unreadCount > 0 && (
              <button onClick={markAllRead} className="text-xs text-primary font-medium hover:underline">
                Marcar todo leído
              </button>
            )}
          </div>

          <div className="max-h-[400px] overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="p-8 text-center text-text/40 text-sm">Todo al día 🎉</div>
            ) : (
              notifications.map((note) => (
                <div 
                  key={note.id} 
                  onClick={() => markAsRead(note.id)}
                  className={`px-4 py-3 border-b border-border/5 hover:bg-surface/50 transition-colors cursor-pointer flex gap-3 ${!note.read ? 'bg-primary/[0.02]' : ''}`}
                >
                  <div className={`size-9 rounded-full flex items-center justify-center border shrink-0 mt-1 ${getBgColor(note.type)}`}>
                    {getIcon(note.type)}
                  </div>
                  <div className="flex-1">
                    <div className="flex justify-between items-start">
                      <h4 className={`text-sm ${!note.read ? 'font-bold text-text' : 'font-medium text-text/70'}`}>
                        {note.title}
                      </h4>
                      <span className="text-[10px] text-text/40 whitespace-nowrap ml-2">{note.time}</span>
                    </div>
                    <p className={`text-xs mt-0.5 leading-relaxed ${!note.read ? 'text-text/80' : 'text-text/50'}`}>
                      {note.message}
                    </p>
                  </div>
                  {!note.read && <div className="self-center"><div className="size-2 bg-primary rounded-full"></div></div>}
                </div>
              ))
            )}
          </div>
          <div className="p-2 bg-gray-50 border-t border-border/10 text-center">
            <button className="text-xs font-bold text-text/60 hover:text-primary transition-colors py-1 w-full">
              Ver panel de avisos
            </button>
          </div>
        </div>
      )}
    </div>
  );
}