// Campos del resumen mensual de nóminas (tabla erp.payroll_months).

export type PayrollInput = {
  gross_salaries: number;
  company_social_security: number;
  worker_social_security: number;
  worker_withholding: number;
  partner_remuneration: number;
};

export const PAYROLL_FIELDS: { key: keyof PayrollInput; label: string }[] = [
  { key: "gross_salaries", label: "Salarios brutos" },
  { key: "company_social_security", label: "SS empresa" },
  { key: "worker_social_security", label: "SS trabajador" },
  { key: "worker_withholding", label: "IRPF trabajadores" },
  { key: "partner_remuneration", label: "Retribución socia" },
];
