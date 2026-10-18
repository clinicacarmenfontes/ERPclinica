# Procedimientos de edición y corrección

Principio: **lo que ya ha producido efectos contables o fiscales no se edita, se rectifica**
(queda el original, la corrección y el motivo). Todo lo demás se edita directamente.
Cada cambio manual deja en `audit_log` quién, cuándo, el valor anterior, el nuevo y el motivo.

En la interfaz, cada campo muestra su tipo de edición:
✏️ editable directo · 🔁 se corrige por rectificación (botón "Corregir…") · 🔒 nunca editable (con un enlace a cómo se corrige).

## 1. Facturas (emitidas y recibidas)

| Campo | Tipo | Cómo se cambia |
|---|---|---|
| Categoría analítica, tipo de gasto | ✏️ | Directo mientras el trimestre esté abierto. Pasa a "manual": **la sincronización ya no lo pisa**. Opción "aplicar a futuras facturas de este proveedor" (guarda el tipo por defecto del tercero) |
| Notas, vencimiento | ✏️ | Directo, también con el trimestre cerrado |
| Estado de cobro/pago | ✏️ | Lo actualiza la sincronización (Pendiente → Pagada). A mano: "Registrar cobro/pago" con fecha e importe (admite parciales). Queda en el historial de estados |
| NIF, nombre del emisor, nº, fecha, base, IVA, retención, total | 🔁 | **Corregir factura**: indicas el motivo → la original queda *anulada* (con asiento de rectificación si ya estaba contabilizada) y se crea la correcta enlazada. Si Optimydent vuelve a mandar el dato erróneo, se reconoce por su hash y se ignora. **Lo ideal es corregirlo también en Optimydent** |
| Línea duplicada en Optimydent | 🔁 | **Descartar** = anular con motivo "duplicado en origen" (sustituye a las "líneas excluidas" de la app local) |
| Factura sin número (`SN-…`) | 🔁 | Corregir factura poniendo el número real |
| Borrar una factura | 🔒 | No existe. Se anula con motivo |

## 2. Conflictos de sincronización

Llega una factura con el mismo emisor, nº y año que una existente, pero con otro importe o fecha. No entra sola: aparece en **Sincronización → Conflictos** con las diferencias resaltadas.
- **Mantener la existente**: el entrante se ignora (y se recuerda: no vuelve a aparecer).
- **Sustituir por la entrante**: equivale a "Corregir factura" con el motivo que escribas.

## 3. Documentos del repositorio (OneDrive de info@, leídos con Claude)

Lo que casa sin dudas con un registro de Optimydent se vincula solo como justificante. Lo demás pasa a **Repositorio → Bandeja**. Cada lectura muestra el enlace al original, los motivos de revisión y las facturas candidatas.

- **Es esta**: vincula el documento como justificante de una factura existente. No crea nada contable.
- Corriges cualquier campo ✏️ y **Contabilizar**. Se guarda lo que leyó la IA y lo que corregiste. Pasa por el mismo filtro antiduplicados: si ya existía, queda vinculado.
- Facturas de proveedor **sin picar en Optimydent**: lo normal es esperar. Cuando la piques y subas el listado de gastos, se vinculará sola. Contabilízala aquí solo si no se va a introducir en Optimydent, porque si no se duplicaría.
- **Descartar** con motivo: presupuestos, justificantes de pago, duplicados… Lo que Claude identifica como "no es una factura" se descarta solo, con ese motivo.
- Si mueves un PDF de carpeta (de la raíz a PICADAS), se actualiza su rol en la siguiente sincronización. Si cambias su contenido, se vuelve a leer.
- Una vez contabilizado, se aplican las reglas del apartado 1.

## 4. Saldos de pacientes (acreedores / deudores)

🔒 Son fotos fechadas. Si subiste un listado equivocado, sube el correcto con la misma fecha: manda el más reciente. El anterior queda en el historial.

## 5. Movimientos bancarios y conciliación

- Movimientos 🔒: vienen del Excel del banco. Si subes un fichero que se solapa con otro ya cargado, los movimientos repetidos se ignoran.
- Movimiento manual (p. ej. efectivo de caja) ✏️ al crearlo; después, igual que los demás.
- Conciliación ✏️: las propuestas automáticas se **confirman o rechazan**; las manuales se crean y deshacen libremente **mientras el trimestre esté abierto**.

## 6. Asientos contables

🔒 Nunca se modifican ni se borran (lo impide la propia base de datos).
- Error en un asiento → **Rectificar**: se genera el asiento inverso enlazado y, si hace falta, el correcto.
- Asientos manuales (amortizaciones, regularizaciones, ajustes del gestor) ✏️ al crearlos: descripción obligatoria y deben cuadrar.

## 7. Nóminas (resumen mensual)

✏️ Editables mientras el trimestre esté abierto. Si ya estaban contabilizadas, al guardar se rectifica el asiento anterior y se contabiliza el nuevo automáticamente.

## 8. Cierre y reapertura de trimestre

- **Cerrar** (al entregar al gestor): bloquea altas, anulaciones, reclasificaciones, nóminas y conciliaciones del trimestre. Los cobros/pagos posteriores sí se registran.
- **Reabrir** 🔁: motivo obligatorio (mín. 10 caracteres). Queda en el historial de cierres.
- Excel del gestor: cada generación es una versión nueva (v1, v2…). Nunca se pisa un fichero ya entregado; la pantalla avisa si hay cambios posteriores a la última versión enviada.

## 9. Configuración

| Elemento | Tipo | Notas |
|---|---|---|
| Datos de la sociedad, % prorrata, día de alerta | ✏️ | La prorrata afecta a los cálculos del 303 de trimestres abiertos |
| Plan de cuentas: nombre, activa/inactiva | ✏️ | El **código** no cambia si la cuenta ya tiene apuntes (crea una nueva y desactiva la antigua) |
| Tipos de gasto → cuenta, partida, modelo 111/115 | ✏️ | Afecta solo a lo que se contabilice después. Para reclasificar lo ya contabilizado: botón "Reclasificar trimestre abierto" (genera rectificaciones) |
| Terceros: nombre, teléfono, retención y tipo de gasto por defecto | ✏️ | |
| Terceros: NIF | 🔁 | Si el tercero ya tiene facturas, se corrigen esas facturas (apartado 1). Dos fichas del mismo tercero → **Fusionar** |
| Patrones recurrentes | ✏️ | Activar/desactivar, importe y día esperados. "Esta factura ya no llegará" lo desactiva |
| Alertas | ✏️ | Resolver o descartar con nota |
