// Inicializar antes de MSW y de los módulos que leen el almacenamiento al importarse.
import { restoreBrowserGlobals } from './setupBrowserGlobals';
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { server } from '../mocks/server';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => {
  server.close();
  restoreBrowserGlobals();
});
