import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableMocking } from './enableMocking';

const start = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('./browser', () => ({ worker: { start } }));
beforeEach(() => start.mockClear());
afterEach(() => vi.unstubAllEnvs());

describe('MSW en el navegador', () => {
  it('no inicia mocks en desarrollo: la aplicación consume la API configurada', async () => {
    vi.stubEnv('DEV', true); vi.stubEnv('VITE_USE_MOCKS', undefined);
    await enableMocking(); expect(start).not.toHaveBeenCalled();
  });
  it('permanece inactivo aunque la variable de mocks esté configurada', async () => {
    vi.stubEnv('DEV', true); vi.stubEnv('VITE_USE_MOCKS', 'false');
    await enableMocking(); expect(start).not.toHaveBeenCalled();
  });
  it('no inicia MSW en producción aunque la variable esté activada', async () => {
    vi.stubEnv('DEV', false); vi.stubEnv('VITE_USE_MOCKS', 'true');
    await enableMocking(); expect(start).not.toHaveBeenCalled();
  });
});
