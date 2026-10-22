# Axion Labs

Equipo de desarrollo de software conformado por estudiantes de la FISI – UNMSM, con 3 años de experiencia en el mercado peruano. Desarrolla y mantiene aplicativos orientados a resolver problemáticas reales del entorno peruano.

## Proyectos activos

| Proyecto | Cliente | Descripción |
|---|---|---|
| **KhipuBot (KPB)** | Economics Solutions | Aplicación web y bot de mensajería asistida por IA para gestionar finanzas personales mediante texto, voz e imágenes. |
| Plataforma de Gestión de Citas Médicas | Clínica MediPlus Perú | Programación, modificación y seguimiento de citas médicas. |
| Sistema de Gestión Logística y Distribución | Distribuidora SurAndina EIRL | Inventarios, pedidos, despachos y seguimiento de distribución. |

## Herramientas

- **Control de versiones:** Git
- **Repositorio:** GitHub (seleccionado mediante benchmarking en el PGCS)
- **Gestión de tareas:** Plane

## Gestión de la configuración

El Plan de Gestión de la Configuración del Software (PGCS) estandariza el uso del repositorio para mantener la integridad y trazabilidad del código, la documentación y las configuraciones de cada proyecto, y reducir los riesgos del trabajo distribuido.

### Roles

| Rol | Cantidad | Responsabilidad principal |
|---|---|---|
| Gestor de la Configuración | 1 | Definir el PGCS, establecer las políticas de ramas y auditar los repositorios. |
| Bibliotecario | 3 | Administrar accesos, respaldar las líneas base y mantener el historial de cambios. |
| Comité de control de cambios | 3 | Evaluar, priorizar y aprobar o rechazar solicitudes de cambio, verificando que hayan pasado QA. |

### Nomenclatura de ítems

```text
<PROYECTO>-<ELEMENTO>               KPB-PC       Project Charter
<PROYECTO>-<ELEMENTO>-<NÚMERO>      KPB-CU01     Caso de uso 01
<PROYECTO>-<ELEMENTO>-<LETRA>       KPB-AUTH-F   Frontend de autenticación (B = backend)
```

Las pruebas unitarias llevan el prefijo `UT` (por ejemplo, `KPB-UT-AUTH-B`).

### Líneas base de KhipuBot

| Hito | Línea base | Contenido |
|---|---|---|
| 1 | LB1 | Project Charter, cronograma, documento de negocio, requisitos funcionales y no funcionales, casos de uso CU01–CU08. |
| 2 | LB2 | Mockups y prototipo, diseño de la API, arquitectura, diagrama entidad-relación, esquema SQL, plan de pruebas. |
| 3 | LB3 | Código fuente (backend `.py`, frontend `.jsx`) y sus pruebas unitarias. |

---
Axion Labs · Proyecto del curso Gestión de la Configuración y Mantenimiento del Software (FISI – UNMSM)
