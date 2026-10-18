import { NextResponse, type NextRequest } from "next/server";
import { getAdminUser } from "@/lib/auth/session";
import { STORAGE_BUCKET } from "@/lib/ingest/pipeline";
import { createAdminClient } from "@/lib/supabase/admin";

// Ver el original de un documento (PDF/imagen) desde la bandeja. Se sirve desde
// el propio dominio tras comprobar que eres admin@: el bucket es privado.
export async function GET(_request: NextRequest, ctx: RouteContext<"/api/documentos/[id]">) {
  if (!(await getAdminUser())) return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Id no válido" }, { status: 400 });

  const db = createAdminClient();
  const { data: doc } = await db
    .from("source_documents")
    .select("file_name, mime_type, storage_path")
    .eq("id", id)
    .maybeSingle<{ file_name: string; mime_type: string; storage_path: string }>();
  if (!doc) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  const { data: blob, error } = await db.storage.from(STORAGE_BUCKET).download(doc.storage_path);
  if (error || !blob) return NextResponse.json({ error: "No se pudo leer el original" }, { status: 502 });

  const type = doc.mime_type === "image/jpg" || doc.mime_type === "image/jfif" ? "image/jpeg" : doc.mime_type;
  return new NextResponse(blob.stream(), {
    headers: {
      "content-type": type,
      "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(doc.file_name)}`,
      "cache-control": "private, max-age=300",
    },
  });
}
