import { inflateRawSync } from "node:zlib";
import { DocumentFormatError } from "../types";

// Lector mínimo de .xlsx (primera hoja) sin dependencias: un .xlsx es un ZIP
// con XML. Optimydent exporta los listados con DataTables (textos en línea,
// números como <v>, fechas como texto 'AAAA-MM-DD'); también se admiten los
// textos compartidos por si el fichero se ha abierto y guardado con Excel.

export type XlsxCell = string | number | null;

export const isXlsx = (b: Uint8Array) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04; // PK\3\4

/** Ficheros del ZIP por nombre (solo los que se piden). */
function unzip(bytes: Uint8Array, wanted: (name: string) => boolean): Map<string, string> {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // Fin del directorio central: firma 0x06054b50 en los últimos 64 KB.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new DocumentFormatError("El Excel está dañado (no es un .xlsx válido).");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, string>();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new DocumentFormatError("El Excel está dañado (directorio ZIP).");
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (!wanted(name)) continue;
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + size);
    if (method !== 0 && method !== 8) throw new DocumentFormatError(`El Excel usa una compresión no admitida (${method}).`);
    out.set(name, (method === 0 ? raw : inflateRawSync(raw)).toString("utf8"));
  }
  return out;
}

const decodeXml = (s: string) =>
  s.replace(/&(lt|gt|quot|apos|amp|#x[0-9a-f]+|#\d+);/gi, (_, e: string) => {
    const k = e.toLowerCase();
    if (k === "lt") return "<";
    if (k === "gt") return ">";
    if (k === "quot") return '"';
    if (k === "apos") return "'";
    if (k === "amp") return "&";
    return String.fromCodePoint(k.startsWith("#x") ? parseInt(k.slice(2), 16) : Number(k.slice(1)));
  });

/** Texto de un <si> o <is>: concatena todos los <t> (texto enriquecido incluido). */
const textOf = (xml: string) => decodeXml([...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(""));

const attr = (tag: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];

/** "AB12" → 27 (índice de columna desde 0). */
function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? "";
  return [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
}

export type XlsxSheet = {
  name: string;
  /** rows[i] es la fila i+1 de la hoja ([] si está vacía). */
  rows: XlsxCell[][];
};

/** Todas las hojas del libro, en orden, con su nombre. */
export function readXlsxSheets(bytes: Uint8Array): XlsxSheet[] {
  const files = unzip(bytes, (n) => n === "xl/workbook.xml" || n === "xl/_rels/workbook.xml.rels" || n === "xl/sharedStrings.xml" || n.startsWith("xl/worksheets/"));
  const workbook = files.get("xl/workbook.xml");
  if (!workbook) throw new DocumentFormatError("El fichero no es un Excel (.xlsx).");
  const rels = [...(files.get("xl/_rels/workbook.xml.rels") ?? "").matchAll(/<Relationship\s[^>]*>/g)].map((m) => m[0]);
  const shared = [...(files.get("xl/sharedStrings.xml") ?? "").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]));

  return [...workbook.matchAll(/<sheet\s[^>]*>/g)].map((sm, i) => {
    const rid = attr(sm[0], "r:id");
    const target = rels.find((r) => attr(r, "Id") === rid);
    const path = target ? attr(target, "Target")!.replace(/^\/?(xl\/)?/, "xl/") : `xl/worksheets/sheet${i + 1}.xml`;
    const sheet = files.get(path);
    if (!sheet) throw new DocumentFormatError("El Excel tiene una hoja que no se puede leer.");
    return { name: decodeXml(attr(sm[0], "name") ?? ""), rows: parseSheet(sheet, shared) };
  });
}

function parseSheet(sheet: string, shared: string[]): XlsxCell[][] {
  const rows: XlsxCell[][] = [];
  let nextRow = 0;
  for (const rm of sheet.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const rAttr = attr(rm[1], "r");
    const ri = rAttr ? Number(rAttr) - 1 : nextRow;
    nextRow = ri + 1;
    const row: XlsxCell[] = [];
    let next = 0;
    for (const cm of (rm[2] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const tag = cm[1];
      const body = cm[2] ?? "";
      const ref = attr(tag, "r");
      const ci = ref ? columnIndex(ref) : next;
      next = ci + 1;
      const type = attr(tag, "t") ?? "n";
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value: XlsxCell = null;
      if (type === "inlineStr") value = textOf(body);
      else if (type === "s") value = v === undefined ? null : (shared[Number(v)] ?? null);
      else if (type === "str") value = v === undefined ? null : decodeXml(v);
      else if (type === "b") value = v === "1" ? "Sí" : "No";
      else if (type === "n" && v !== undefined && v.trim() !== "") value = Number(v);
      if (typeof value === "string" && value.trim() === "") value = null;
      row[ci] = value;
    }
    rows[ri] = Array.from(row, (c) => c ?? null);
  }
  return Array.from(rows, (r) => r ?? []);
}

/** Filas de la primera hoja (sin las filas vacías). */
export function readXlsxRows(bytes: Uint8Array): XlsxCell[][] {
  const [first] = readXlsxSheets(bytes);
  if (!first) throw new DocumentFormatError("El Excel no tiene ninguna hoja con datos.");
  return first.rows.filter((r) => r.some((c) => c !== null));
}
