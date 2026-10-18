import { centsToNumber, cleanText, dateRange, ES_DATE_RE, isEsAmount, parseEsAmountCents, parseEsDate } from "../normalize";
import { DocumentFormatError, type BankTransaction, type ParsedDocument } from "../types";
import type { PdfPage, PdfWord } from "./pdf";

// Movimientos bancarios. Cada banco tiene su formato, pero la garantía es la
// misma: el saldo de cada fila debe cuadrar con el anterior ± el importe. Si
// una sola fila no cuadra, el fichero se rechaza entero (no se carga a medias).

type RawTx = { date: string; valueDate: string | null; amountCents: number; balanceCents: number; description: string };

/** Comprueba la cadena de saldos en orden cronológico. */
function assertBalanceChain(rows: RawTx[], label: string) {
  for (let i = 1; i < rows.length; i++) {
    const expected = rows[i - 1].balanceCents + rows[i].amountCents;
    if (expected !== rows[i].balanceCents) {
      throw new DocumentFormatError(
        `${label}: el saldo no cuadra en el movimiento del ${rows[i].date} «${rows[i].description}» ` +
          `(esperado ${(expected / 100).toFixed(2)}, el fichero dice ${(rows[i].balanceCents / 100).toFixed(2)}).`,
      );
    }
  }
}

function toTransactions(rows: RawTx[]): { transactions: BankTransaction[]; skipped: number } {
  let skipped = 0;
  const transactions: BankTransaction[] = [];
  rows.forEach((r, i) => {
    // Liquidaciones de 0,00 € (p. ej. intereses sin importe) no son movimientos.
    if (r.amountCents === 0) {
      skipped++;
      return;
    }
    transactions.push({
      booking_date: r.date,
      value_date: r.valueDate,
      amount: centsToNumber(r.amountCents),
      balance_after: centsToNumber(r.balanceCents),
      description: r.description,
      ordinal: i,
    });
  });
  return { transactions, skipped };
}

// ── CaixaBank: CSV de CaixaBankNow ("Concepto;Fecha;Importe;Saldo") ─────────

export function looksLikeCaixaBankCsv(text: string): boolean {
  const header = text.replace(/^﻿/, "").split(/\r?\n/, 1)[0] ?? "";
  return /^concepto;fecha;importe;saldo$/i.test(header.trim());
}

export function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

export function parseCaixaBankCsv(text: string): ParsedDocument {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  const rows: RawTx[] = lines.slice(1).map((line, i) => {
    const parts = line.split(";");
    if (parts.length !== 4) throw new DocumentFormatError(`CaixaBank, línea ${i + 2}: se esperaban 4 columnas.`);
    const [concept, date, amount, balance] = parts;
    try {
      return {
        date: parseEsDate(date)!,
        valueDate: null,
        amountCents: parseEsAmountCents(amount)!,
        balanceCents: parseEsAmountCents(balance)!,
        description: cleanText(concept),
      };
    } catch (e) {
      throw new DocumentFormatError(`CaixaBank, línea ${i + 2}: ${(e as Error).message}`);
    }
  });
  if (rows.length === 0) throw new DocumentFormatError("El fichero de CaixaBank no tiene movimientos.");
  // CaixaBankNow lista del más reciente al más antiguo.
  rows.reverse();
  assertBalanceChain(rows, "CaixaBank");
  const { transactions, skipped } = toTransactions(rows);
  const [from, to] = dateRange(rows.map((r) => r.date));
  return {
    kind: "movimientos_banco",
    bank: "caixabank",
    accountNumber: null,
    summary: `CaixaBank · ${transactions.length} movimientos del ${from} al ${to}`,
    warnings: skipped ? [`${skipped} movimientos de 0,00 € omitidos.`] : [],
    coversFrom: from,
    coversTo: to,
    transactions,
  };
}

// ── Kutxabank: PDF "Movimientos de cuenta" ─────────────────────────────────

export function looksLikeKutxabankPdf(pages: PdfPage[]): boolean {
  const text = pages.flatMap((p) => p.words.map((w) => w.text)).join(" ");
  return /Kutxabank/i.test(text) && /Movimientos de cuenta/i.test(text);
}

/** Agrupa fragmentos en líneas por su línea base (misma fila del PDF). */
function linesOf(words: PdfWord[]): PdfWord[][] {
  const sorted = [...words].sort((a, b) => a.bottom - b.bottom || a.x0 - b.x0);
  const lines: PdfWord[][] = [];
  for (const w of sorted) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last[0].bottom - w.bottom) <= 2) last.push(w);
    else lines.push([w]);
  }
  return lines.map((l) => l.sort((a, b) => a.x0 - b.x0));
}

export function parseKutxabankPdf(pages: PdfPage[]): ParsedDocument {
  let accountNumber: string | null = null;
  const rows: RawTx[] = [];

  for (const page of pages) {
    const lines = linesOf(page.words);
    const headerIdx = lines.findIndex((l) => {
      const t = l.map((w) => w.text).join(" ");
      return /Fecha/.test(t) && /Concepto/.test(t) && /Importe/.test(t) && /Saldo/.test(t);
    });
    for (const l of lines) {
      const t = l.map((w) => w.text).join(" ");
      const m = /N[úu]mero:\s*([\d\s]{20,30})/.exec(t);
      if (m) accountNumber = m[1].replace(/\s/g, "").slice(0, 20);
    }
    if (headerIdx === -1) continue;
    const header = lines[headerIdx];
    const xOf = (label: string) => header.find((w) => w.text.startsWith(label))?.x0 ?? 0;
    const xValue = header.find((w) => /valor/i.test(w.text))?.x0 ?? xOf("Importe");
    const xAmount = xOf("Importe");

    for (const l of lines.slice(headerIdx + 1)) {
      if (!ES_DATE_RE.test(l[0].text) || l[0].x0 > xOf("Concepto")) continue;
      const dates = l.filter((w) => ES_DATE_RE.test(w.text));
      const amounts = l.filter((w) => isEsAmount(w.text));
      if (dates.length !== 2 || amounts.length !== 2) {
        throw new DocumentFormatError(
          `Kutxabank, página ${page.number}: fila no reconocida «${l.map((w) => w.text).join(" ")}».`,
        );
      }
      const valueDate = dates.find((w) => w.x0 >= xValue - 20) ?? dates[1];
      const concept = l
        .filter((w) => !dates.includes(w) && !amounts.includes(w) && w.x0 < xAmount)
        .map((w) => w.text)
        .join(" ");
      const [amount, balance] = amounts.sort((a, b) => a.x1 - b.x1);
      rows.push({
        date: parseEsDate(dates[0].text)!,
        valueDate: parseEsDate(valueDate.text),
        amountCents: parseEsAmountCents(amount.text)!,
        balanceCents: parseEsAmountCents(balance.text)!,
        description: cleanText(concept),
      });
    }
  }

  if (rows.length === 0) throw new DocumentFormatError("No se han encontrado movimientos en el PDF de Kutxabank.");
  assertBalanceChain(rows, "Kutxabank");
  const { transactions, skipped } = toTransactions(rows);
  const [from, to] = dateRange(rows.map((r) => r.date));
  return {
    kind: "movimientos_banco",
    bank: "kutxabank",
    accountNumber,
    summary: `Kutxabank · ${transactions.length} movimientos del ${from} al ${to}`,
    warnings: skipped ? [`${skipped} movimientos de 0,00 € omitidos.`] : [],
    coversFrom: from,
    coversTo: to,
    transactions,
  };
}
