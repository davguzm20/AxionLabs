# AxionLabs

Responde en español.

## Límites del repositorio
- El código activo está en `Desarrollo/KPB/Implementacion/{Frontend,Backend}`. No hay un workspace ni comandos de compilación o pruebas en la raíz.
- `Linea base/` contiene copias de los hitos, no las fuentes activas. Los requisitos y diseños de trabajo de KPB están en `Desarrollo/KPB/{Analisis,Diseño}`.
- Las afirmaciones del README del frontend sobre páginas provisionales y autenticación sin implementar están desactualizadas. `Backend/app/main.py` solo registra los routers de autenticación y transacciones; los mocks del frontend implementan APIs adicionales.

## Frontend
Ejecuta los comandos desde `Desarrollo/KPB/Implementacion/Frontend`.

- Preparación: copia `.env.example` a `.env`, ejecuta `npm ci` y luego `npm run dev`.
- Verificación: `npm run lint`, `npm test` y `npm run build`. La compilación ejecuta `tsc -b` antes de generar el paquete; para comprobar solo los tipos, usa `npx tsc -b`.
- Prueba puntual: `npm test -- src/features/auth/auth.test.tsx`. Añade `-t "nombre de la prueba"` para filtrar más.
- `src/main.tsx` activa MSW automáticamente en desarrollo salvo que `VITE_USE_MOCKS=false`; no lo inicia en producción.
- Para conectar la API real, `VITE_API_BASE_URL` debe incluir `/api/v1`. No hay un proxy de Vite ni middleware CORS en el backend.
- Vitest usa jsdom y MSW; las peticiones sin manejador se consideran errores. La configuración global restaura los manejadores, no los datos persistidos o simulados. Usa `src/test/resetFrontendState.ts` en `beforeEach` para limpiar localStorage y el estado de presupuestos y notificaciones.

## Backend
Ejecuta los comandos desde `Desarrollo/KPB/Implementacion/Backend`.

- Usa Python 3.14 y uv ≥0.13.0: `uv sync` y después `uv run uvicorn app.main:app --reload`.
- La configuración lee `.env` respecto del directorio de ejecución. Copia `.env.example`; las peticiones reales de autenticación y base de datos necesitan sus variables de PostgreSQL, `REDIS_URL` y un `JWT_SECRET` de al menos 32 caracteres. `/health` no comprueba la conexión a la base de datos.
- La implementación está en `app/modules/{auth,transactions}`. `app/KPB-RTT.py` reexporta componentes de transacciones; no es otra implementación.
- Los modelos ORM se definen en `app/KPB-ENT.py`. Impórtalos desde `app.entities`, que carga dinámicamente ese archivo con guion y reexporta los símbolos seleccionados.
- Todas las pruebas: `uv run pytest`. Comprobación sin servicios externos: `uv run pytest tests/test_health.py tests/test_security.py`.
- Prueba individual: `uv run pytest tests/test_security.py::test_token_has_required_claims`.
- El README anuncia `--cov=app`, pero `pytest-cov` no está declarado ni incluido en `uv.lock`.

## Seguridad de las pruebas con base de datos
- Las pruebas de autenticación se omiten si `TEST_DATABASE_URL` no está en el entorno del proceso; definirla solo en `.env` no las habilita. Redis se sustituye por fakeredis.
- Usa una base PostgreSQL desechable inicializada con `Desarrollo/KPB/Diseño/KPB-SCHEMA.sql`. Cada ejecución de la fixture `db_session` hace `TRUNCATE users CASCADE`: nunca la apuntes a una base compartida o del equipo.
- El script del esquema empieza con `CREATE DATABASE kpb_db`; separa la creación de la base de la carga de sus tablas, tipos y triggers en la base de pruebas prevista.
