import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { COMPANY } from "@/lib/company";
import type { RepositoryRole } from "@/lib/repository/paths";
import { extractedInvoiceSchema, type ExtractedInvoice } from "./invoice-schema";

export const EXTRACTION_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";

const ROLE_HINT: Record<RepositoryRole, string> = {
  registrada_optimydent: "Está en la carpeta de facturas de proveedores ya registradas.",
  pendiente_registrar: "Es una factura de proveedor recién recibida.",
  profesional:
    "Está en la carpeta de facturas de doctoras/es que facturan a la clínica con retención de IRPF (normalmente 15 %) y sin IVA (asistencia sanitaria exenta).",
  emitida: "Es una factura EMITIDA por la clínica a otra clínica o profesional.",
  ignorado: "",
};

const SYSTEM = `Eres un asistente contable que lee facturas españolas para ${COMPANY.legalName} (CIF ${COMPANY.taxId}), una clínica dental.
Extrae los datos fiscales exactamente como aparecen; no inventes nada: si un dato no aparece o no se lee, devuelve null.
Reglas:
- Fechas en formato AAAA-MM-DD (las facturas españolas usan DD/MM/AAAA).
- Importes en euros como números (1.234,56 → 1234.56). La retención de IRPF siempre en positivo.
- "lines" es el resumen fiscal: una entrada por cada tipo de IVA/retención, no una por artículo.
- total = base + IVA − retención (lo que realmente se paga).
- Si el documento no es una factura (presupuesto, albarán, justificante de transferencia, pedido…) indícalo en document_type.
- En confidence sé honesto: baja si algo está borroso, recortado o es ambiguo.`;

export type ExtractionResult = {
  data: ExtractedInvoice;
  model: string;
  inputTokens: number;
  outputTokens: number;
};

export async function extractInvoice(
  file: { bytes: Uint8Array; mediaType: "application/pdf" | "image/jpeg" | "image/png" | "image/gif" | "image/webp" },
  ctx: { role: RepositoryRole; fileName: string },
): Promise<ExtractionResult> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("Falta ANTHROPIC_API_KEY");
  const client = new Anthropic();
  const data = Buffer.from(file.bytes).toString("base64");
  const source =
    file.mediaType === "application/pdf"
      ? ({ type: "document", source: { type: "base64", media_type: "application/pdf", data } } as const)
      : ({ type: "image", source: { type: "base64", media_type: file.mediaType, data } } as const);

  const message = await client.messages.parse({
    model: EXTRACTION_MODEL,
    max_tokens: 4096,
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          source,
          {
            type: "text",
            text: `Fichero: «${ctx.fileName}». ${ROLE_HINT[ctx.role]}\nExtrae los datos de la factura.`,
          },
        ],
      },
    ],
    output_config: { format: zodOutputFormat(extractedInvoiceSchema) },
  });
  if (!message.parsed_output) throw new Error("Claude no devolvió una lectura válida");
  return {
    data: message.parsed_output,
    model: message.model,
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
  };
}
