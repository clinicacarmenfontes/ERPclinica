import { DocumentFormatError, type ParsedDocument } from "../types";
import { decodeText, looksLikeCaixaBankCsv, looksLikeKutxabankPdf, parseCaixaBankCsv, parseKutxabankPdf } from "./banks";
import {
  detectOptimydentKind,
  detectOptimydentSheetKind,
  parseEmitidas,
  parseGastos,
  parseSaldos,
  SPEC_EMITIDAS,
  SPEC_GASTOS,
  SPEC_SALDOS,
} from "./optimydent";
import { readOptimydentSheet, readOptimydentTable } from "./optimydent-table";
import { firstPageText, readPdf } from "./pdf";
import { isXlsx, readXlsxRows } from "./xlsx";

const isPdf = (b: Uint8Array) => b.length > 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46; // %PDF

/**
 * Reconoce el documento por su CONTENIDO (no por el nombre) y lo convierte al
 * formato normalizado. Lanza DocumentFormatError si no lo reconoce o si algo
 * no cuadra: nunca devuelve datos a medias.
 *
 * @param asOf fecha de la foto para los listados de saldos (no la traen).
 */
export async function parseDocument(bytes: Uint8Array, opts: { asOf: string }): Promise<ParsedDocument> {
  if (isXlsx(bytes)) {
    const sheet = readXlsxRows(bytes);
    const kind = detectOptimydentSheetKind(sheet);
    if (kind === "gastos") return parseGastos(readOptimydentSheet(sheet, SPEC_GASTOS));
    if (kind === "emitidas") return parseEmitidas(readOptimydentSheet(sheet, SPEC_EMITIDAS));
    if (kind === "saldos") return parseSaldos(readOptimydentSheet(sheet, SPEC_SALDOS), opts.asOf);
    throw new DocumentFormatError(
      "Excel no reconocido. Se admiten los listados de Optimydent: gastos, facturas emitidas y pacientes (saldos).",
    );
  }
  if (isPdf(bytes)) {
    const pages = await readPdf(bytes, { rects: true });
    const optimydent = detectOptimydentKind(firstPageText(pages, 120));
    if (optimydent === "gastos") return parseGastos(readOptimydentTable(pages, SPEC_GASTOS));
    if (optimydent === "emitidas") return parseEmitidas(readOptimydentTable(pages, SPEC_EMITIDAS));
    if (optimydent === "saldos") return parseSaldos(readOptimydentTable(pages, SPEC_SALDOS), opts.asOf);
    if (looksLikeKutxabankPdf(pages)) return parseKutxabankPdf(pages);
    throw new DocumentFormatError(
      "PDF no reconocido. Se admiten los listados de Optimydent (mejor en Excel) y los movimientos de Kutxabank.",
    );
  }
  const text = decodeText(bytes.slice(0, 2_000_000));
  if (looksLikeCaixaBankCsv(text)) return parseCaixaBankCsv(text);
  throw new DocumentFormatError(
    "Fichero no reconocido. Formatos admitidos: Excel de Optimydent, PDF de Optimydent o de Kutxabank y CSV de CaixaBank.",
  );
}

export { DocumentFormatError };
