import { normHeader } from "../normalize";
import { DocumentFormatError } from "../types";
import { joinCellWords, type PdfPage, type PdfWord } from "./pdf";

// Port de contabilidad/pdf_tables.py: los PDF de Optimydent son tablas HTML
// impresas con pdfmake. La cabecera es una fila de rectángulos azul oscuro
// (#3f4c6b) repetida en cada página, uno por columna:
//   · los límites de columna salen de esos rectángulos;
//   · cada fila empieza donde aparece su "ancla" (fecha, nº de historia…);
//   · cada fragmento de texto se asigna a (fila, columna) por su posición.
//   · las columnas se localizan por nombre (orden libre, extras ignoradas).
// Al final se exige que TODO el texto del cuerpo esté asignado; si no, error
// en lugar de devolver datos incompletos.

const HEADER_RGB = [0x3f, 0x4c, 0x6b];

function isHeaderColor(color: string | null): boolean {
  if (!color || !/^#[0-9a-f]{6}$/.test(color)) return false;
  const rgb = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
  return rgb.every((c, i) => Math.abs(c - HEADER_RGB[i]) <= 6);
}

/**
 * Nombre cortado por el borde de la página: en Gastos la última columna
 * ("Asiento contable") se sale del A4 horizontal y llega como "a co". Cada
 * palabra debe ser prefijo de la esperada.
 */
function truncatedMatch(found: string, expected: string): boolean {
  const fw = found.split(" ");
  const ew = expected.split(" ");
  return fw.length === ew.length && fw.every((w, j) => w.length > 0 && ew[j].startsWith(w));
}

/**
 * Las columnas del listado se eligen a mano en el panel de Optimydent, así que
 * pueden venir en otro orden o con columnas de más. Se localiza cada columna
 * conocida por su nombre; las demás se leen (para no dejar texto sin asignar)
 * pero se descartan. Devuelve columna conocida → índice en la página.
 */
function resolveColumns(found: string[], known: string[]): Map<string, number> {
  const index = new Map<string, number>();
  for (const name of known) {
    const hits = found.flatMap((f, i) => (f === name ? [i] : []));
    if (hits.length > 1) throw new DocumentFormatError(`La columna «${name}» aparece ${hits.length} veces en el PDF.`);
    if (hits.length === 1) index.set(name, hits[0]);
  }
  // Solo la última columna puede llegar cortada por el borde de la página.
  const last = found.length - 1;
  if (last >= 0 && ![...index.values()].includes(last)) {
    const candidates = known.filter((name) => !index.has(name) && truncatedMatch(found[last], name));
    if (candidates.length === 1) index.set(candidates[0], last);
  }
  return index;
}

export type TableRow = { page: number; cells: Record<string, string> };
export type Table = {
  columns: string[];
  /** Columnas conocidas que no venían en el PDF (sus celdas quedan vacías). */
  missing: string[];
  rows: TableRow[];
  pages: number;
  warnings: string[];
};
export type TableSpec = {
  /** Columnas que se leen (las que se guardan en BBDD). Cualquier otra se ignora. */
  columns: string[];
  /**
   * Imprescindibles para la contabilidad: sin ellas el listado se rechaza.
   * Un grupo ["a", "b"] exige al menos una de las dos.
   */
  required: (string | string[])[];
  /** Columna que marca el inicio de cada fila (debe ser obligatoria). */
  anchorColumn: string;
  anchorRe: RegExp;
};

export function readOptimydentTable(pages: PdfPage[], spec: TableSpec): Table {
  const { columns: known, required, anchorColumn, anchorRe } = spec;
  const warnings: string[] = [];
  let bounds: [number, number][] | null = null;
  let names: string[] | null = null;
  let index: Map<string, number> | null = null;
  type RowAcc = { page: number; groups: Map<number, PdfWord[]> };
  const rows: RowAcc[] = [];
  let total = 0;
  let assigned = 0;

  for (const page of pages) {
    const pno = page.number;
    const hdr = page.rects.filter((r) => isHeaderColor(r.color)).sort((a, b) => a.x0 - b.x0);
    if (hdr.length === 0) {
      if (page.words.length > 0) {
        throw new DocumentFormatError(
          `Página ${pno}: no se encuentra la cabecera de la tabla (¿ha cambiado el formato de Optimydent?).`,
        );
      }
      continue;
    }
    const pageBounds: [number, number][] = hdr.map((r) => [r.x0, r.x1]);
    const hTop = Math.min(...hdr.map((r) => r.top));
    const hBot = Math.max(...hdr.map((r) => r.bottom));

    const pageNames = pageBounds.map(([x0, x1]) => {
      const ws = page.words.filter((w) => {
        const cx = (w.x0 + w.x1) / 2;
        return w.top >= hTop - 1 && w.bottom <= hBot + 1 && cx >= x0 && cx < x1;
      });
      ws.sort((a, b) => Math.round(a.top) - Math.round(b.top) || a.x0 - b.x0);
      return normHeader(ws.map((w) => w.text).join(" "));
    });

    const pageIndex = resolveColumns(pageNames, known);
    if (!index) {
      const missingRequired = required
        .map((req) => (Array.isArray(req) ? req : [req]))
        .filter((group) => !group.some((name) => pageIndex.has(name)))
        .map((group) => group.join(" o "));
      if (missingRequired.length > 0) {
        throw new DocumentFormatError(
          `Faltan columnas imprescindibles para la contabilidad: ${missingRequired.join(", ")}.\n` +
            `Añádelas al exportar desde Optimydent.\nEncontradas: ${pageNames.join(", ")}`,
        );
      }
      const used = new Set(pageIndex.values());
      const extra = pageNames.filter((_, i) => !used.has(i));
      if (extra.length > 0) warnings.push(`Columnas adicionales ignoradas: ${extra.map((e) => e || "(sin nombre)").join(", ")}.`);
      names = pageNames;
      index = pageIndex;
      bounds = pageBounds;
    } else if (
      pageNames.length !== names!.length ||
      known.some((name) => pageIndex.get(name) !== index!.get(name))
    ) {
      throw new DocumentFormatError(`Página ${pno}: la cabecera difiere de la de la página 1.`);
    }
    const b = bounds!;
    const cols = names!;

    const body = page.words.filter((w) => w.top > hBot - 1);
    total += body.length;
    const colOf = new Map<PdfWord, number>();
    for (const w of body) {
      const cx = (w.x0 + w.x1) / 2;
      let ci = b.findIndex(([x0, x1]) => cx >= x0 - 0.5 && cx < x1 + 0.5);
      if (ci === -1) {
        ci = cx >= b[b.length - 1][1] ? b.length - 1 : 0;
        warnings.push(`Pág. ${pno}: «${w.text}» fuera de columnas; asignado a «${cols[ci]}».`);
      }
      colOf.set(w, ci);
    }

    const anchorIdx = index.get(anchorColumn)!;
    const anchors: number[] = [];
    for (const w of body
      .filter((w) => colOf.get(w) === anchorIdx)
      .sort((a, b2) => a.top - b2.top || a.x0 - b2.x0)) {
      if (anchorRe.test(w.text) && (anchors.length === 0 || Math.abs(w.top - anchors[anchors.length - 1]) > 3)) {
        anchors.push(w.top);
      }
    }
    if (anchors.length === 0) {
      if (body.length > 0) throw new DocumentFormatError(`Página ${pno}: hay texto pero no se localiza ninguna fila.`);
      continue;
    }

    // Texto por encima de la primera fila = continuación de la última fila
    // de la página anterior (celda multilínea partida entre páginas).
    const firstTop = Math.min(...body.map((w) => w.top));
    if (firstTop < anchors[0] - 3) {
      if (rows.length === 0) throw new DocumentFormatError(`Página ${pno}: texto huérfano por encima de la primera fila.`);
      const prev = rows[rows.length - 1];
      for (const w of body) {
        if (w.top < anchors[0] - 3) {
          const ci = colOf.get(w)!;
          prev.groups.set(ci, [...(prev.groups.get(ci) ?? []), w]);
          assigned++;
        }
      }
    }
    const limits = [...anchors, Number.POSITIVE_INFINITY];
    anchors.forEach((a, k) => {
      const row: RowAcc = { page: pno, groups: new Map() };
      for (const w of body) {
        if (w.top >= a - 3 && w.top < limits[k + 1] - 3) {
          const ci = colOf.get(w)!;
          row.groups.set(ci, [...(row.groups.get(ci) ?? []), w]);
          assigned++;
        }
      }
      rows.push(row);
    });
  }

  if (assigned !== total) {
    throw new DocumentFormatError(`Se leyeron ${total} textos pero solo se asignaron ${assigned} a filas.`);
  }
  // Solo salen las columnas conocidas; el texto de las adicionales se descarta.
  const idx = index ?? new Map<string, number>();
  return {
    columns: known.filter((name) => idx.has(name)),
    missing: index ? known.filter((name) => !idx.has(name)) : [],
    pages: pages.length,
    warnings,
    rows: rows.map((r) => ({
      page: r.page,
      cells: Object.fromEntries(
        known.map((name) => {
          const ci = idx.get(name);
          return [name, ci === undefined ? "" : joinCellWords(r.groups.get(ci) ?? [])];
        }),
      ),
    })),
  };
}
