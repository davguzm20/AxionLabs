import { useAlertPreferences } from '../../hooks/useAlertPreferences';

type ToastProps = { message: string; role?: 'status' | 'alert' };

export function Toast({ message, role = 'status' }: ToastProps) {
  const { enabled } = useAlertPreferences();
  if (!enabled) return null;

  return <div role={role} className="rounded-md bg-surface p-4 text-body shadow-md">{message}</div>;
}
