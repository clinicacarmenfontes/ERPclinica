import { DocumentFormatError, type ParsedDocument } from "../types";
import { decodeText, looksLikeCaixaBankCsv, looksLikeKutxabankPdf, parseCaixaBankCsv, parseKutxabankPdf } from "./banks";
import { detectOptimydentKind, parseEmitidas, parseGastos, parseSaldos } from "./optimydent";
import { firstPageText, readPdf } from "./pdf";

const isPdf = (b: Uint8Array) => b.length > 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46; // %PDF

/**
 * Reconoce el documento por su CONTENIDO (no por el nombre) y lo convierte al
 * formato normalizado. Lanza DocumentFormatError si no lo reconoce o si algo
 * no cuadra: nunca devuelve datos a medias.
 *
 * @param asOf fecha de la foto para los listados de saldos (no la traen).
 */
export async function parseDocument(bytes: Uint8Array, opts: { asOf: string }): Promise<ParsedDocument> {
  if (isPdf(bytes)) {
    const pages = await readPdf(bytes, { rects: true });
    const optimydent = detectOptimydentKind(firstPageText(pages, 120));
    if (optimydent === "gastos") return parseGastos(pages);
    if (optimydent === "emitidas") return parseEmitidas(pages);
    if (optimydent === "saldos") return parseSaldos(pages, opts.asOf);
    if (looksLikeKutxabankPdf(pages)) return parseKutxabankPdf(pages);
    throw new DocumentFormatError(
      "PDF no reconocido. Se admiten los listados de Optimydent (gastos, facturas emitidas, pacientes) y los movimientos de Kutxabank.",
    );
  }
  const text = decodeText(bytes.slice(0, 2_000_000));
  if (looksLikeCaixaBankCsv(text)) return parseCaixaBankCsv(text);
  throw new DocumentFormatError("Fichero no reconocido. Formatos admitidos: PDF de Optimydent o de Kutxabank y CSV de CaixaBank.");
}

export { DocumentFormatError };
