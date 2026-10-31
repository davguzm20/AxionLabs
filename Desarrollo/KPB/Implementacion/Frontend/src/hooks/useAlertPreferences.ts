import { useEffect, useState } from 'react';

const STORAGE_KEY = 'khipubot.alertVisualsEnabled';
const CHANGE_EVENT = 'khipubot:alert-visual-preference-change';

function readPreference(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== 'false';
  } catch {
    return true;
  }
}

export function useAlertPreferences() {
  const [enabled, setEnabled] = useState(readPreference);

  useEffect(() => {
    const handlePreferenceChange = (event: Event) => {
      setEnabled((event as CustomEvent<boolean>).detail);
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) setEnabled(event.newValue !== 'false');
    };

    window.addEventListener(CHANGE_EVENT, handlePreferenceChange);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener(CHANGE_EVENT, handlePreferenceChange);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  const updateEnabled = (next: boolean) => {
    setEnabled(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, String(next));
    } catch {
      // La preferencia sigue activa en memoria si el navegador bloquea el almacenamiento local.
    }
    window.dispatchEvent(new CustomEvent<boolean>(CHANGE_EVENT, { detail: next }));
  };

  // Esta preferencia solo controla avisos visuales locales; no afecta la campana ni el SSE del servidor.
  return { enabled, setEnabled: updateEnabled };
}
