import { transferableAbortController } from 'node:util';

type JsdomTestGlobal = typeof globalThis & { jsdom: { window: Window } };

const browserWindow = (globalThis as JsdomTestGlobal).jsdom.window;
const properties = ['localStorage', 'sessionStorage', 'AbortController', 'AbortSignal'] as const;
const originalDescriptors = new Map(properties.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
const nativeController = transferableAbortController();

// Vitest 3 puede conservar el almacenamiento nativo de Node 26 en lugar del de jsdom.
// fetch/Request, en cambio, necesitan las clases de cancelación de su propia implementación.
Object.defineProperties(globalThis, {
  localStorage: {
    configurable: true,
    get: () => browserWindow.localStorage,
  },
  sessionStorage: {
    configurable: true,
    get: () => browserWindow.sessionStorage,
  },
  AbortController: {
    configurable: true,
    writable: true,
    value: nativeController.constructor,
  },
  AbortSignal: {
    configurable: true,
    writable: true,
    value: nativeController.signal.constructor,
  },
});

export function restoreBrowserGlobals(): void {
  for (const [name, descriptor] of originalDescriptors) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
}
