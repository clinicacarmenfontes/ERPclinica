import "server-only";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { GRAPH_ACCOUNT_EMAIL, isGraphAccount } from "@/lib/auth/allowlist";
import { createAdminClient } from "@/lib/supabase/admin";

// Acceso a la carpeta de facturas del OneDrive de info@ con el MÍNIMO permiso:
// info@ comparte "01. Facturas" (solo lectura) con admin@, y el ERP lee con la
// sesión delegada de admin@ (Files.Read.All delegado = solo lo que admin@ puede
// ver). Nada de permisos de aplicación sobre todo el tenant.
//
// El refresh token se obtiene al iniciar sesión (scope offline_access) y se
// guarda cifrado; Microsoft lo rota en cada uso.

const GRAPH = "https://graph.microsoft.com/v1.0";
export const GRAPH_SCOPES = "offline_access Files.Read.All";

export class GraphAuthError extends Error {
  constructor(message = "OneDrive no está conectado: cierra sesión y vuelve a entrar con admin@ para reconectarlo.") {
    super(message);
    this.name = "GraphAuthError";
  }
}

export type DriveFile = {
  id: string;
  driveId: string;
  path: string;
  name: string;
  size: number;
  eTag: string | null;
  cTag: string | null;
  lastModified: string | null;
};

/** Guarda (cifrado) el refresh token recibido al iniciar sesión. */
export async function saveGraphRefreshToken(email: string, refreshToken: string) {
  if (!isGraphAccount(email)) throw new Error("Solo se guarda la conexión de OneDrive de la cuenta admin@");
  const db = createAdminClient();
  const { error } = await db.from("integration_tokens").upsert({
    provider: "microsoft_graph",
    account_email: email,
    refresh_token_enc: encryptSecret(refreshToken),
    scopes: GRAPH_SCOPES,
    last_error: null,
  });
  if (error) throw error;
}

/** Access token fresco a partir del refresh token guardado (y lo rota). */
export async function getGraphAccessToken(): Promise<string> {
  const db = createAdminClient();
  const { data: row } = await db
    .from("integration_tokens")
    .select("account_email, refresh_token_enc")
    .eq("provider", "microsoft_graph")
    .eq("account_email", GRAPH_ACCOUNT_EMAIL)
    .maybeSingle<{ account_email: string; refresh_token_enc: string }>();
  if (!row) throw new GraphAuthError();

  const { MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET } = process.env;
  if (!MS_TENANT_ID || !MS_CLIENT_ID || !MS_CLIENT_SECRET) {
    throw new Error("Faltan MS_TENANT_ID / MS_CLIENT_ID / MS_CLIENT_SECRET (los mismos del proveedor Azure de Supabase)");
  }
  const res = await fetch(`https://login.microsoftonline.com/${MS_TENANT_ID}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: MS_CLIENT_ID,
      client_secret: MS_CLIENT_SECRET,
      refresh_token: decryptSecret(row.refresh_token_enc),
      scope: GRAPH_SCOPES,
    }),
  });
  const body = (await res.json()) as { access_token?: string; refresh_token?: string; error_description?: string };
  if (!res.ok || !body.access_token) {
    const msg = body.error_description?.split("\r\n")[0] ?? `HTTP ${res.status}`;
    await db.from("integration_tokens").update({ last_error: msg }).eq("provider", "microsoft_graph");
    throw new GraphAuthError(`OneDrive desconectado (${msg}). Cierra sesión y vuelve a entrar con admin@.`);
  }
  if (body.refresh_token) {
    await db
      .from("integration_tokens")
      .update({ refresh_token_enc: encryptSecret(body.refresh_token), last_error: null })
      .eq("provider", "microsoft_graph");
  }
  return body.access_token;
}

async function graph<T>(token: string, url: string): Promise<T> {
  const res = await fetch(url.startsWith("http") ? url : `${GRAPH}${url}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (res.status === 401 || res.status === 403) {
    throw new GraphAuthError(
      res.status === 403
        ? "Sin acceso a la carpeta: comprueba que info@ ha compartido «01. Facturas» con admin@."
        : undefined,
    );
  }
  if (!res.ok) throw new Error(`Graph ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

/** Resuelve el enlace de la carpeta compartida (ONEDRIVE_FOLDER_URL) a driveId/itemId. */
export async function resolveSharedFolder(token: string): Promise<{ driveId: string; itemId: string; name: string }> {
  const url = process.env.ONEDRIVE_FOLDER_URL;
  if (!url) throw new Error("Falta ONEDRIVE_FOLDER_URL: el enlace de «01. Facturas» compartido con admin@");
  const encoded = `u!${Buffer.from(url, "utf8").toString("base64url")}`;
  const item = await graph<{ id: string; name: string; parentReference: { driveId: string }; folder?: object }>(
    token,
    `/shares/${encoded}/driveItem?$select=id,name,parentReference,folder`,
  );
  if (!item.folder) throw new Error("El enlace de ONEDRIVE_FOLDER_URL no es una carpeta");
  return { driveId: item.parentReference.driveId, itemId: item.id, name: item.name };
}

type GraphItem = {
  id: string;
  name: string;
  size: number;
  eTag?: string;
  cTag?: string;
  lastModifiedDateTime?: string;
  folder?: { childCount: number };
  file?: { mimeType: string };
};

/**
 * Lista recursiva de ficheros. `skipFolder(path)` permite podar ramas enteras
 * (p. ej. años anteriores) sin recorrerlas.
 */
export async function listTree(
  token: string,
  driveId: string,
  rootId: string,
  skipFolder: (path: string) => boolean,
): Promise<DriveFile[]> {
  const out: DriveFile[] = [];
  const queue: { id: string; path: string }[] = [{ id: rootId, path: "" }];
  while (queue.length) {
    const { id, path } = queue.shift()!;
    let next: string | undefined =
      `/drives/${driveId}/items/${id}/children?$top=999&$select=id,name,size,eTag,cTag,lastModifiedDateTime,folder,file`;
    while (next) {
      const page: { value: GraphItem[]; "@odata.nextLink"?: string } = await graph(token, next);
      for (const it of page.value) {
        const p = path ? `${path}/${it.name}` : it.name;
        if (it.folder) {
          if (!skipFolder(p)) queue.push({ id: it.id, path: p });
        } else if (it.file) {
          out.push({
            id: it.id,
            driveId,
            path: p,
            name: it.name,
            size: it.size,
            eTag: it.eTag ?? null,
            cTag: it.cTag ?? null,
            lastModified: it.lastModifiedDateTime ?? null,
          });
        }
      }
      next = page["@odata.nextLink"];
    }
  }
  return out;
}

export async function downloadItem(token: string, driveId: string, itemId: string): Promise<Uint8Array> {
  const res = await fetch(`${GRAPH}/drives/${driveId}/items/${itemId}/content`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`No se pudo descargar el fichero (HTTP ${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * Versión JPEG reducida que genera OneDrive. Para fotos de más de ~3,7 MB (el
 * límite de Claude es 5 MB por imagen en base64) y para HEIC, que Claude no lee.
 */
export async function downloadPreviewJpeg(token: string, driveId: string, itemId: string): Promise<Uint8Array> {
  const res = await fetch(`${GRAPH}/drives/${driveId}/items/${itemId}/thumbnails/0/c2048x2048/content`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`OneDrive no generó una vista reducida de la imagen (HTTP ${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}
