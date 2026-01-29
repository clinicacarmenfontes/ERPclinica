import { createClient } from '@supabase/supabase-js';

// 1. URL de tu proyecto en Supabase
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;

// 2. Clave pública (ANON KEY) de tu proyecto
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// 3. Crear y exportar el cliente para usarlo en toda la app
export const supabase = createClient(supabaseUrl, supabaseAnonKey);