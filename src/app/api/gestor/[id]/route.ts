import { NextResponse, type NextRequest } from "next/server";
import { getAdminUser } from "@/lib/auth/session";
import { XLSX_MIME } from "@/lib/gestor/generate";
import { STORAGE_BUCKET } from "@/lib/ingest/pipeline";
import { createAdminClient } from "@/lib/supabase/admin";

// Descarga de una versión del Excel del gestor (bucket privado: solo admin@).
export async function GET(_request: NextRequest, ctx: RouteContext<"/api/gestor/[id]">) {
  if (!(await getAdminUser())) return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Id no válido" }, { status: 400 });

  const db = createAdminClient();
  const { data: exp } = await db
    .from("gestor_exports")
    .select("file_name, storage_path")
    .eq("id", id)
    .maybeSingle<{ file_name: string; storage_path: string }>();
  if (!exp) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  const { data: blob, error } = await db.storage.from(STORAGE_BUCKET).download(exp.storage_path);
  if (error || !blob) return NextResponse.json({ error: "No se pudo leer el fichero" }, { status: 502 });
  return new NextResponse(blob.stream(), {
    headers: {
      "content-type": XLSX_MIME,
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(exp.file_name)}`,
      "cache-control": "private, no-store",
    },
  });
}
