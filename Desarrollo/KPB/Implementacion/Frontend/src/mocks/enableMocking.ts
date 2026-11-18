/**
 * Los mocks de MSW se ejecutan exclusivamente mediante el servidor de Node
 * configurado en Vitest. La aplicación del navegador siempre consume la API
 * configurada, incluso durante el desarrollo.
 */
export async function enableMocking(): Promise<void> {
  // Punto de extensión deliberadamente inactivo: no registrar un Service Worker.
}
