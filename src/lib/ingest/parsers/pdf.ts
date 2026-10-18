import { getDocumentProxy } from "unpdf";
import { DocumentFormatError } from "../types";

// Lectura de PDF con coordenadas reales (pdf.js vía unpdf). Todas las
// coordenadas se devuelven "de arriba abajo" (top = distancia al borde
// superior), como pdfplumber en la versión Python, para portar la lógica tal cual.

export type PdfWord = { text: string; x0: number; x1: number; top: number; bottom: number; page: number };
export type PdfRect = { x0: number; x1: number; top: number; bottom: number; color: string | null };
export type PdfPage = { number: number; width: number; height: number; words: PdfWord[]; rects: PdfRect[] };

type Matrix = [number, number, number, number, number, number];

const multiply = (m1: Matrix, m2: Matrix): Matrix => [
  m1[0] * m2[0] + m1[2] * m2[1],
  m1[1] * m2[0] + m1[3] * m2[1],
  m1[0] * m2[2] + m1[2] * m2[3],
  m1[1] * m2[2] + m1[3] * m2[3],
  m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
  m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
];

const apply = (m: Matrix, x: number, y: number): [number, number] => [
  x * m[0] + y * m[2] + m[4],
  x * m[1] + y * m[3] + m[5],
];

function toHex(color: unknown): string | null {
  if (typeof color === "string") return color.toLowerCase();
  if (Array.isArray(color) && color.length === 3) {
    return `#${color.map((c) => Math.round(Number(c) * (Number(c) <= 1 ? 255 : 1)).toString(16).padStart(2, "0")).join("")}`;
  }
  return null;
}

/** Abre un PDF y devuelve palabras (fragmentos de texto) y rectángulos rellenos por página. */
export async function readPdf(bytes: Uint8Array, opts: { rects?: boolean } = {}): Promise<PdfPage[]> {
  let pdf;
  try {
    pdf = await getDocumentProxy(new Uint8Array(bytes));
  } catch {
    throw new DocumentFormatError("El fichero no es un PDF válido o está protegido.");
  }
  const OPS = opts.rects ? (await import("unpdf/pdfjs")).OPS : null;
  const pages: PdfPage[] = [];

  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const { width, height } = page.getViewport({ scale: 1 });

    const words: PdfWord[] = [];
    const content = await page.getTextContent();
    for (const item of content.items) {
      if (!("str" in item) || item.str.trim() === "") continue;
      const [, , , d, e, f] = item.transform as Matrix;
      const fontHeight = item.height || Math.abs(d);
      const baseline = height - f;
      words.push({
        text: item.str.trim(),
        x0: e,
        x1: e + item.width,
        top: baseline - fontHeight,
        bottom: baseline,
        page: n,
      });
    }

    const rects: PdfRect[] = [];
    if (OPS) {
      const ops = await page.getOperatorList();
      const stack: Matrix[] = [];
      let ctm: Matrix = [1, 0, 0, 1, 0, 0];
      let fill: string | null = null;
      for (let i = 0; i < ops.fnArray.length; i++) {
        const fn = ops.fnArray[i];
        const args = ops.argsArray[i] as unknown[];
        if (fn === OPS.save) stack.push(ctm);
        else if (fn === OPS.restore) ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0];
        else if (fn === OPS.transform) ctm = multiply(ctm, args as Matrix);
        else if (fn === OPS.setFillRGBColor) fill = toHex(args.length === 1 ? args[0] : args);
        else if (fn === OPS.constructPath) {
          const mm = args[2] as ArrayLike<number> | null | undefined;
          if (!mm || mm.length < 4) continue;
          const [ax, ay] = apply(ctm, mm[0], mm[1]);
          const [bx, by] = apply(ctm, mm[2], mm[3]);
          rects.push({
            x0: Math.min(ax, bx),
            x1: Math.max(ax, bx),
            top: height - Math.max(ay, by),
            bottom: height - Math.min(ay, by),
            color: fill,
          });
        }
      }
    }
    pages.push({ number: n, width, height, words, rects });
  }
  await pdf.cleanup();
  return pages;
}

/** Une los fragmentos de una celda respetando líneas; si una línea acaba en guion, pega sin espacio. */
export function joinCellWords(words: PdfWord[]): string {
  if (words.length === 0) return "";
  const sorted = [...words].sort((a, b) => a.page - b.page || a.top - b.top || a.x0 - b.x0);
  const lines: PdfWord[][] = [];
  let lastTop: number | null = null;
  let lastPage: number | null = null;
  for (const w of sorted) {
    if (lastTop === null || Math.abs(w.top - lastTop) > 3 || w.page !== lastPage) {
      lines.push([]);
      lastTop = w.top;
      lastPage = w.page;
    }
    lines[lines.length - 1].push(w);
  }
  let out = "";
  lines.forEach((line, i) => {
    const text = line
      .sort((a, b) => a.x0 - b.x0)
      .map((w) => w.text)
      .join(" ");
    if (i === 0) out = text;
    else if (out.endsWith("-")) out += text;
    else out += ` ${text}`;
  });
  return out.trim();
}

/** Primer texto de la primera página (título del listado). */
export function firstPageText(pages: PdfPage[], maxChars = 400): string {
  const p = pages[0];
  if (!p) return "";
  return [...p.words]
    .sort((a, b) => a.top - b.top || a.x0 - b.x0)
    .map((w) => w.text)
    .join(" ")
    .slice(0, maxChars);
}
