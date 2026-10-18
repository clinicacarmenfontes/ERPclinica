-- La conexión de OneDrive solo puede ser la de admin@ (a quien info@ comparte
-- «01. Facturas»). Nunca la de info@, dueña de todo el OneDrive.
delete from erp.integration_tokens
 where provider = 'microsoft_graph' and lower(account_email) <> 'admin@clinicacarmenfontes.com';

alter table erp.integration_tokens
  add constraint integration_tokens_graph_account_check
  check (provider <> 'microsoft_graph' or lower(account_email) = 'admin@clinicacarmenfontes.com');
