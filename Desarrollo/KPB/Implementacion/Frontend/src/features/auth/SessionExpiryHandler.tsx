import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { clearLocalSession } from './session';

type ExpiryEvent = CustomEvent<{ message?: string }>;

export function SessionExpiryHandler() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const handling = useRef(false);

  useEffect(() => {
    const onSessionExpired = (event: Event) => {
      if (handling.current) return;
      handling.current = true;
      clearLocalSession(queryClient);
      navigate('/login', { replace: true, state: { sessionExpired: true, message: (event as ExpiryEvent).detail?.message } });
    };
    window.addEventListener('khipubot:session-expired', onSessionExpired);
    return () => window.removeEventListener('khipubot:session-expired', onSessionExpired);
  }, [navigate, queryClient]);

  return null;
}
