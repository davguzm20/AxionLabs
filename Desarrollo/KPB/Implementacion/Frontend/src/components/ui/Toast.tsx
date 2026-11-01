type ToastProps = { message: string; role?: 'status' | 'alert' };

export function Toast({ message, role = 'status' }: ToastProps) {
  return <div role={role} className="rounded-md bg-surface p-4 text-body shadow-md">{message}</div>;
}
