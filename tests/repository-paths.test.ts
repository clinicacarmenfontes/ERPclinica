import { describe, expect, it } from "vitest";
import { classifyPath } from "@/lib/repository/paths";

// Rutas reales de "01. Facturas" (OneDrive de info@, octubre 2026).
describe("classifyPath", () => {
  it.each([
    ["04. 2026/3er Trimestre/PICADAS/Consenur 1004187E26E1977.pdf", 2026, 3, "registrada_optimydent", "pdf"],
    ["04. 2026/3er Trimestre/PICADAS/Alexis Julio Roger 173-1.jpeg", 2026, 3, "registrada_optimydent", "image"],
    ["04. 2026/1er Trimestre/PICADAS/foto.jfif", 2026, 1, "registrada_optimydent", "image"],
    ["04. 2026/2º Trimestre/METIDAS EN EL PROGRAMA PERO NO PASADAS A PACO/BPCE Equipment AR26035149.pdf", 2026, 2, "registrada_optimydent", "pdf"],
    ["04. 2026/3er Trimestre/G177994826_682fd4fe.pdf", 2026, 3, "pendiente_registrar", "pdf"],
    ["04. 2026/3er Trimestre/Facturas anterior trimestre no metidas/C6A3DBCA.pdf", 2026, 3, "pendiente_registrar", "pdf"],
    ["04. 2026/1er Trimestre/2025/Factura9100124384.pdf", 2026, 1, "pendiente_registrar", "pdf"],
    ["04. 2026/3er Trimestre/Facturas con retención/URSULA SEPT 2026.pdf", 2026, 3, "profesional", "pdf"],
    ["04. 2026/2º Trimestre/Facturas con retención/Facturas doctoras 2ºTrimestre 2026/x.pdf", 2026, 2, "profesional", "pdf"],
    ["04. 2026/2º Trimestre/Facturas emitidas SLP 2º Trimestre/Factura_03-2026.pdf", 2026, 2, "emitida", "pdf"],
    ["04. 2026/4º trimestre/341162572.pdf", 2026, 4, "pendiente_registrar", "pdf"],
    ["04. 2026/Factura_OrdenSalida_N2026_A_199530.pdf", 2026, null, "pendiente_registrar", "pdf"],
  ])("%s", (path, year, quarter, role, media) => {
    expect(classifyPath(path, 2026)).toMatchObject({ year, quarter, role, media });
  });

  it.each([
    ["04. 2026/2º Trimestre/Facturas con retención/Transferencias SLP a Carmen en 2026/IMG_1.jpeg", /transferencias/i],
    ["04. 2026/2º Trimestre/Facturas con retención/Transferencias SLP a Carmen en 2026/resumen.xlsx", /xlsx|transferencias/i],
    ["04. 2026/CCF 2º Trimestre.zip", /zip/],
    ["03. 2025/3trimestre/PICADAS/a.pdf", /anterior a 2026/],
    ["01. Traspaso/Traspaso Medinensis/a.pdf", /año/],
    ["Certificado sobre exoneración de retención 2026.pdf", /año/],
  ])("ignora %s", (path, reason) => {
    const info = classifyPath(path, 2026);
    expect(info.role).toBe("ignorado");
    expect(info.reason).toMatch(reason);
  });

  it("reconoce variantes de trimestre de años anteriores", () => {
    expect(classifyPath("03. 2025/1trimestre/Gastos/a.pdf", 2025).quarter).toBe(1);
    expect(classifyPath("02. 2024/4TRIMESTRE2024/Envio 4Q2024_OK/a.pdf", 2024).quarter).toBe(4);
  });
});

describe("acceso", () => {
  it("solo admin@ e info@ (sin distinguir mayúsculas); nadie más del dominio", async () => {
    const { isAllowedEmail } = await import("@/lib/auth/allowlist");
    expect(isAllowedEmail("admin@clinicacarmenfontes.com")).toBe(true);
    expect(isAllowedEmail(" Info@ClinicaCarmenFontes.com ")).toBe(true);
    expect(isAllowedEmail("recepcion@clinicacarmenfontes.com")).toBe(false);
    expect(isAllowedEmail("info@clinicacarmenfontes.com.evil.com")).toBe(false);
    expect(isAllowedEmail(null)).toBe(false);
  });

  it("solo la sesión de admin@ sirve como credencial de OneDrive (info@ no)", async () => {
    const { isGraphAccount } = await import("@/lib/auth/allowlist");
    expect(isGraphAccount("Admin@clinicacarmenfontes.com")).toBe(true);
    expect(isGraphAccount("info@clinicacarmenfontes.com")).toBe(false);
  });
});
