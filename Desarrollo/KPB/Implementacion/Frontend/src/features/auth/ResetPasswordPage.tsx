import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { api } from '../../lib/api';
import type { ApiError } from '../../lib/errors';

const resetSchema = z.object({
  code: z.string().regex(/^\d{6}$/u, 'Ingresa el código de 6 dígitos.'),
  new_password: z.string().min(8, 'Usa al menos 8 caracteres, con una letra y un número.')
    .regex(/[A-Za-z]/u, 'Usa al menos 8 caracteres, con una letra y un número.')
    .regex(/\d/u, 'Usa al menos 8 caracteres, con una letra y un número.'),
  confirm_password: z.string().min(8, 'Confirma tu contraseña.'),
}).refine((values) => values.new_password === values.confirm_password, {
  path: ['confirm_password'],
  message: 'Las contraseñas no coinciden.',
});
type ResetValues = z.infer<typeof resetSchema>;

export function ResetPasswordPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const email = (location.state as { email?: string } | null)?.email;
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(60);
  const [errorMessage, setErrorMessage] = useState<string>();
  const [success, setSuccess] = useState(false);
  const { register, handleSubmit, formState: { errors } } = useForm<ResetValues>({
    resolver: zodResolver(resetSchema),
    defaultValues: { code: '', new_password: '', confirm_password: '' },
  });

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((remaining) => remaining - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  if (!email) return <Navigate to="/recuperar-password" replace />;

  async function onSubmit(values: ResetValues) {
    setLoading(true);
    setErrorMessage(undefined);
    try {
      await api('/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ email, ...values }),
      });
      setSuccess(true);
      window.setTimeout(() => navigate('/login', { replace: true, state: { message: 'Contraseña actualizada. Inicia sesión con tu nueva contraseña.' } }), 1200);
    } catch (error) {
      const apiError = error as ApiError;
      setErrorMessage(apiError.code === 'TOO_MANY_ATTEMPTS'
        ? 'Demasiados intentos. Intenta más tarde.'
        : 'El código no es válido o expiró. Solicita uno nuevo.');
    } finally {
      setLoading(false);
    }
  }

  async function resendCode() {
    if (cooldown > 0 || resending) return;
    setResending(true);
    setErrorMessage(undefined);
    try {
      await api('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) });
      setCooldown(60);
    } catch (error) {
      setErrorMessage((error as ApiError).message || 'El servicio no está disponible. Intenta más tarde.');
    } finally {
      setResending(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-white px-6 py-10">
      <section className="mx-auto w-full max-w-md">
        <div className="mb-6 flex justify-center">
          <img src="/logo.png" alt="KhipuBot Logo" className="h-auto w-40 max-w-full sm:w-56" />
        </div>
        <h1 className="text-center font-display text-h1">Recupera tu contraseña</h1>
        <p className="mt-2 text-center text-body text-ink-500">Paso 2 de 2</p>
        {success ? (
          <p role="status" className="mt-6 text-center text-body text-success">Contraseña actualizada. Inicia sesión con tu nueva contraseña.</p>
        ) : (
          <>
            <p className="mt-4 text-body text-ink-700">Si el correo existe, enviamos un código de recuperación.</p>
            <form className="mt-6 space-y-5" onSubmit={handleSubmit(onSubmit)} noValidate>
              <div>
                <label htmlFor="reset-code" className="mb-2 block text-small font-medium text-ink-900">Código de 6 dígitos</label>
                <input id="reset-code" inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={6} aria-invalid={Boolean(errors.code)} aria-describedby={errors.code ? 'reset-code-error' : undefined} className="min-h-11 w-full rounded-md border border-ink-300 bg-white px-3 text-body focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-500 aria-[invalid=true]:border-danger" {...register('code')} />
                {errors.code && <p id="reset-code-error" role="alert" className="mt-1 text-small text-danger">{errors.code.message}</p>}
              </div>
              <div>
                <label htmlFor="new-password" className="mb-2 block text-small font-medium text-ink-900">Nueva contraseña</label>
                <input id="new-password" type="password" autoComplete="new-password" aria-invalid={Boolean(errors.new_password)} aria-describedby={errors.new_password ? 'new-password-error' : undefined} className="min-h-11 w-full rounded-md border border-ink-300 bg-white px-3 text-body focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-500 aria-[invalid=true]:border-danger" {...register('new_password')} />
                {errors.new_password && <p id="new-password-error" role="alert" className="mt-1 text-small text-danger">{errors.new_password.message}</p>}
              </div>
              <div>
                <label htmlFor="confirm-password" className="mb-2 block text-small font-medium text-ink-900">Confirmar nueva contraseña</label>
                <input id="confirm-password" type="password" autoComplete="new-password" aria-invalid={Boolean(errors.confirm_password)} aria-describedby={errors.confirm_password ? 'confirm-password-error' : undefined} className="min-h-11 w-full rounded-md border border-ink-300 bg-white px-3 text-body focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-500 aria-[invalid=true]:border-danger" {...register('confirm_password')} />
                {errors.confirm_password && <p id="confirm-password-error" role="alert" className="mt-1 text-small text-danger">{errors.confirm_password.message}</p>}
              </div>
              {errorMessage && <p role="alert" className="text-small text-danger">{errorMessage}</p>}
              <button type="submit" disabled={loading} aria-busy={loading} className="min-h-[52px] w-full rounded-md bg-brand-600 px-4 font-semibold text-white hover:bg-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500 disabled:opacity-70">
                {loading ? 'Actualizando…' : 'Cambiar contraseña'}
              </button>
            </form>
            <button type="button" onClick={() => void resendCode()} disabled={cooldown > 0 || resending} className="mt-4 min-h-11 w-full text-small text-brand-600 underline disabled:text-ink-500">
              {resending ? 'Enviando…' : cooldown > 0 ? `Reenviar código (${cooldown} s)` : 'Reenviar código'}
            </button>
          </>
        )}
        <p className="mt-4 text-center text-small"><Link to="/login" className="text-brand-600 underline">Volver a iniciar sesión</Link></p>
      </section>
    </main>
  );
}
