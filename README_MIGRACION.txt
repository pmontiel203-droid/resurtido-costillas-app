MIGRACIÓN PREPARADA PARA CLOUDFLARE PAGES + D1

Contenido:
- index.html: interfaz actual de Resurtido Costillas.
- functions/api/reports.js: API compatible con GET/POST /api/reports usando D1.
- functions/api/migrate.js: importador protegido para migrar historial existente sin sobrescribir fechas ya migradas.
- schema.sql: tabla de reportes.
- wrangler.toml: configuración inicial; sustituir database_id por el ID real de D1.

IMPORTANTE SOBRE LOS DATOS:
No contiene los reportes históricos porque el Blob privado de Vercel está suspendido por exceder la cuota Hobby. No ejecutar importaciones ni borrar el Blob actual. Primero hay que recuperar acceso al historial (al reactivarse el 17-dic-2026 o al pasar a un plan que permita consumo adicional), exportar el JSON y después usar /api/migrate con MIGRATION_SECRET.

DESPLIEGUE (cuando se autorice):
1. Crear cuenta Cloudflare y proyecto Pages conectado al repositorio.
2. Crear una base D1 llamada resurtido-costillas-db.
3. Ejecutar schema.sql en D1.
4. Configurar el binding D1 con nombre DB.
5. En wrangler.toml reemplazar REEMPLAZAR_CON_EL_ID_DE_D1.
6. Configurar el secreto MIGRATION_SECRET en Pages Functions.
7. Desplegar y probar GET /api/reports (debe responder reports: []).
8. Solo después exportar el historial antiguo y migrarlo con POST /api/migrate y header X-Migration-Secret.
9. Comparar cantidad de fechas, tiendas, piezas y montos contra el origen antes de cambiar el dominio o dejar de usar Vercel.

La ruta pública /api/reports conserva el contrato que utiliza index.html, por lo que la interfaz no necesita cambiar su endpoint.


NOTA DE SEGURIDAD: la base existente ya contiene daily_reports. Este paquete crea una tabla adicional llamada reports; no elimina daily_reports ni importa datos automáticamente. Antes de migrar, se debe exportar y validar el historial de Blob.
