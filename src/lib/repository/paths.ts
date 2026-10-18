// Interpreta la ruta de un fichero dentro de "01. Facturas" del OneDrive de info@:
//   "04. 2026/3er Trimestre/PICADAS/Consenur 1004187E26E1977.pdf"
// → año 2026, 3T, rol "registrada_optimydent".
// Los nombres reales varían ("1er Trimestre", "4º trimestre", "1trimestre",
// "4TRIMESTRE2024"…), así que se reconocen por patrón, no por nombre exacto.

export type RepositoryRole = "registrada_optimydent" | "pendiente_registrar" | "profesional" | "emitida" | "ignorado";

export type PathInfo = {
  year: number | null;
  quarter: 1 | 2 | 3 | 4 | null;
  role: RepositoryRole;
  /** Tipo de fichero que se puede leer con Claude (o null si se ignora). */
  media: "pdf" | "image" | null;
  reason?: string;
};

const IMAGE_EXT = new Set(["jpg", "jpeg", "jfif", "png", "webp", "gif", "heic", "heif"]);

function yearOf(segment: string): number | null {
  const m = /^(?:\d{1,2}\.\s*)?(20\d{2})$/.exec(segment.trim());
  return m ? Number(m[1]) : null;
}

function quarterOf(segment: string): 1 | 2 | 3 | 4 | null {
  const m = /([1-4])\s*(?:er|º|ª|o|°)?\s*trimestre/i.exec(segment) ?? /^([1-4])\s*T(?:\s|$|\d)/i.exec(segment.trim());
  return m ? (Number(m[1]) as 1 | 2 | 3 | 4) : null;
}

function roleOfFolder(segment: string): RepositoryRole | null {
  const s = segment.toLowerCase();
  if (/transferenc/.test(s)) return "ignorado";
  if (/picad/.test(s) || /metidas en el programa/.test(s)) return "registrada_optimydent";
  if (/retenci|doctor/.test(s)) return "profesional";
  if (/emitidas/.test(s)) return "emitida";
  return null;
}

export function classifyPath(relPath: string, fromYear: number): PathInfo {
  const parts = relPath.split("/").filter(Boolean);
  const file = parts.pop() ?? "";
  const ext = file.includes(".") ? file.split(".").pop()!.toLowerCase() : "";
  const media = ext === "pdf" ? "pdf" : IMAGE_EXT.has(ext) ? "image" : null;

  const year = parts.length ? yearOf(parts[0]) : null;
  const base = { year, quarter: null as PathInfo["quarter"] };
  if (year === null) return { ...base, role: "ignorado", media: null, reason: "Fuera de las carpetas de año" };
  if (year < fromYear) return { ...base, role: "ignorado", media: null, reason: `Ejercicio anterior a ${fromYear}` };
  if (!media) return { ...base, role: "ignorado", media: null, reason: `Formato .${ext || "?"} no es una factura` };

  let quarter: PathInfo["quarter"] = null;
  let role: RepositoryRole = "pendiente_registrar";
  for (const segment of parts.slice(1)) {
    quarter = quarter ?? quarterOf(segment);
    const r = roleOfFolder(segment);
    if (r === "ignorado") return { year, quarter, role: "ignorado", media: null, reason: "Carpeta de transferencias (no son facturas)" };
    if (r) role = r;
  }
  return { year, quarter, role, media };
}

export const ROLE_LABELS: Record<RepositoryRole, string> = {
  registrada_optimydent: "Picada en Optimydent",
  pendiente_registrar: "Sin picar en Optimydent",
  profesional: "Doctora con retención",
  emitida: "Emitida a otra clínica",
  ignorado: "Ignorado",
};
