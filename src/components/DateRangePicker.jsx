import React, { useState, useRef, useEffect } from 'react';
import DatePicker, { registerLocale } from 'react-datepicker';
import es from 'date-fns/locale/es';
import { useDate } from '../context/DateContext'; // <--- CONEXIÓN GLOBAL
import { 
  format, 
  startOfMonth, 
  endOfMonth, 
  startOfYear, 
  endOfYear, 
  subMonths, 
  isSameDay 
} from 'date-fns';
import { Calendar, ChevronDown } from 'lucide-react';
import 'react-datepicker/dist/react-datepicker.css';

registerLocale('es', es);

// Estilos (se mantienen igual)
const customStyles = `
  .react-datepicker { font-family: 'Inter', sans-serif; border: 1px solid #e6e4dc; border-radius: 0.75rem; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1); }
  .react-datepicker__header { background-color: #f9f8f4; border-bottom: 1px solid #e6e4dc; border-top-right-radius: 0.75rem; }
  .react-datepicker__current-month { color: #161313; font-weight: 600; }
  .react-datepicker__day-name { color: #7c6e6e; }
  .react-datepicker__day--selected, .react-datepicker__day--in-selecting-range, .react-datepicker__day--in-range { background-color: #b87a7a !important; color: white !important; }
  .react-datepicker__day:hover { background-color: #f1efe7 !important; }
  .react-datepicker__triangle { display: none; }
`;

export default function DateRangePicker() {
  // Usamos el estado global en lugar del local
  const { dateRange, setDateRange } = useDate(); 
  const { startDate, endDate } = dateRange;
  
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [dropdownRef]);

  // Texto del botón
  const getButtonText = () => {
    if (!startDate || !endDate) return 'Seleccionar periodo';
    if (isSameDay(startDate, startOfMonth(new Date())) && isSameDay(endDate, endOfMonth(new Date()))) return 'Este mes';
    if (isSameDay(startDate, startOfYear(new Date())) && isSameDay(endDate, endOfYear(new Date()))) return 'Este año';
    
    const startFormat = format(startDate, 'd MMM yyyy', { locale: es });
    const endFormat = format(endDate, 'd MMM yyyy', { locale: es });
    
    if (startDate.getFullYear() === endDate.getFullYear()) {
       return `${format(startDate, 'd MMM', { locale: es })} - ${format(endDate, 'd MMM yyyy', { locale: es })}`;
    }
    return `${startFormat} - ${endFormat}`;
  };

  const handlePresetClick = (preset) => {
    const now = new Date();
    let newStart, newEnd;

    switch (preset) {
      case 'thisMonth': newStart = startOfMonth(now); newEnd = endOfMonth(now); break;
      case 'thisYear': newStart = startOfYear(now); newEnd = endOfYear(now); break;
      case 'lastYear': newStart = startOfYear(subMonths(now, 12)); newEnd = endOfYear(subMonths(now, 12)); break;
      case 'last3Months': newStart = startOfMonth(subMonths(now, 2)); newEnd = endOfMonth(now); break;
      case 'last6Months': newStart = startOfMonth(subMonths(now, 5)); newEnd = endOfMonth(now); break;
      default: return;
    }
    // Actualizamos el estado GLOBAL
    setDateRange({ startDate: newStart, endDate: newEnd, label: preset });
    setIsOpen(false);
  };

  const handleCalendarChange = (dates) => {
    const [start, end] = dates;
    // Actualizamos el estado GLOBAL
    setDateRange({ ...dateRange, startDate: start, endDate: end, label: 'custom' });
    if (start && end) setIsOpen(false);
  };

  const presetOptions = [
    { label: 'Este mes', value: 'thisMonth' },
    { label: 'Este año', value: 'thisYear' },
    { label: 'Año pasado', value: 'lastYear' },
    { label: 'Últimos 3 meses', value: 'last3Months' },
    { label: 'Últimos 6 meses', value: 'last6Months' },
  ];

  return (
    <div className="relative" ref={dropdownRef}>
      <style>{customStyles}</style>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-2 px-4 py-2.5 bg-white border rounded-xl text-sm font-medium text-text shadow-sm hover:border-primary/30 hover:shadow-md transition-all group ${isOpen ? 'border-primary/50 ring-2 ring-primary/10' : 'border-border/20'}`}
      >
        <Calendar size={18} className="text-primary group-hover:text-primary/80 transition-colors" />
        <span className="capitalize">{getButtonText()}</span>
        <ChevronDown size={16} className={`text-text/40 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute right-0 z-50 mt-2 bg-white rounded-xl shadow-xl border border-border/10 p-4 flex flex-col md:flex-row gap-4 animate-in fade-in zoom-in-95 duration-200 origin-top-right">
          <div className="flex flex-col gap-1 min-w-[160px]">
            <span className="text-xs font-bold text-text/40 uppercase tracking-wider mb-2 px-2">Rangos Rápidos</span>
            {presetOptions.map((option) => (
              <button
                key={option.value}
                onClick={() => handlePresetClick(option.value)}
                className="text-left px-3 py-2 text-sm font-medium text-text/70 hover:bg-surface/50 hover:text-primary rounded-lg transition-colors"
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="hidden md:block w-px bg-border/10"></div>
          <div>
             <span className="text-xs font-bold text-text/40 uppercase tracking-wider mb-2 px-2 block">Personalizado</span>
            <DatePicker
              selected={startDate}
              onChange={handleCalendarChange}
              startDate={startDate}
              endDate={endDate}
              selectsRange
              inline
              locale="es"
              monthsShown={1}
              maxDate={new Date()}
            />
          </div>
        </div>
      )}
    </div>
  );
}