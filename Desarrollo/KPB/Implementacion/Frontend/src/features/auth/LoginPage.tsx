import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { api } from '../../lib/api';
import type { ApiError } from '../../lib/errors';

const loginSchema = z.object({
  email: z.string().trim().email('Ingresa un correo electrónico válido.'),
  password: z.string().min(1, 'Ingresa tu contraseña.'),
});
type LoginValues = z.infer<typeof loginSchema>;
type AuthResponse = { access_token: string; token_type: string; expires_in: number };
type LoginError = ApiError & { status?: number };

function getLoginMessage(error: LoginError): string {
  switch (error.status) {
    case 401: return 'Correo o contraseña incorrectos. Inténtalo de nuevo.';
    case 423: return 'Tu cuenta se bloqueó por 30 minutos. Te enviamos un correo.';
    case 403: return 'Tu cuenta está inactiva. Contacta a soporte para recibir ayuda.';
    case 429: return 'Demasiadas solicitudes. Intenta en 30 s.';
    default: return error.message || 'Ocurrió un error. Intenta de nuevo.';
  }
}

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [submitError, setSubmitError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const { register, handleSubmit, setValue, formState: { errors } } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  async function onSubmit(values: LoginValues) {
    setSubmitError(undefined);
    setLoading(true);
    try {
      const response = await api<AuthResponse>('/auth/login', {
        method: 'POST',
        body: JSON.stringify(values),
      });
      localStorage.setItem('access_token', response.access_token);
      const destination = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname;
      navigate(destination || '/inicio', { replace: true });
    } catch (error) {
      setSubmitError(getLoginMessage(error as LoginError));
      setValue('password', '');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-white px-6 py-10">
      <div className="mx-auto w-full max-w-md">
        <section className="w-full max-w-md">
          <div className="mb-6 flex justify-center">
            <img src="/logo.png" alt="KhipuBot Logo" className="h-auto w-40 max-w-full sm:w-56" />
          </div>
          <h1 className="text-center font-display text-h1">Inicia sesión</h1>
          <p className="mt-2 text-center text-body text-ink-500">Bienvenido de nuevo</p>
          <form className="mt-6 space-y-5" onSubmit={handleSubmit(onSubmit)} noValidate>
            <div>
              <label htmlFor="email" className="mb-2 block text-small font-medium text-ink-900">Correo electrónico</label>
              <input
                id="email" type="email" autoComplete="email" autoFocus placeholder="tucorreo@gmail.com"
                aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? 'email-error' : undefined}
                className="min-h-11 w-full rounded-md border border-ink-300 bg-surface px-3 text-body focus-visible:outline-accent-500 aria-[invalid=true]:border-danger"
                {...register('email')}
              />
              {errors.email && <p id="email-error" className="mt-1 text-small text-danger">{errors.email.message}</p>}
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between gap-3">
                <label htmlFor="password" className="text-small font-medium text-ink-900">Contraseña</label>
                <Link to="/recuperar-password" className="inline-flex min-h-11 items-center text-small text-brand-600 underline">¿Olvidaste tu contraseña?</Link>
              </div>
              <div className="flex min-h-11 rounded-md border border-ink-300 focus-within:outline focus-within:outline-2 focus-within:outline-accent-500">
                <input
                  id="password" type={passwordVisible ? 'text' : 'password'} autoComplete="current-password"
                  aria-invalid={Boolean(errors.password)} aria-describedby={errors.password ? 'password-error' : undefined}
                  className="min-w-0 flex-1 rounded-l-md bg-transparent px-3 text-body outline-none"
                  {...register('password')}
                />
                <button
                  type="button" aria-label={passwordVisible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  aria-pressed={passwordVisible}
                  className="min-h-11 min-w-11 rounded-r-md px-3 text-small text-brand-600 underline focus-visible:outline-accent-500"
                  onClick={() => setPasswordVisible((visible) => !visible)}
                >{passwordVisible ? 'Ocultar' : 'Mostrar'}</button>
              </div>
              {errors.password && <p id="password-error" className="mt-1 text-small text-danger">{errors.password.message}</p>}
            </div>
            {submitError && <p role="alert" className="rounded-md border border-danger px-3 py-2 text-small text-danger">{submitError}</p>}
            <button
              type="submit" disabled={loading} aria-busy={loading}
              className="min-h-[52px] w-full rounded-md bg-brand-600 px-4 font-semibold text-white hover:bg-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500 disabled:cursor-wait disabled:opacity-70"
            >{loading ? 'Ingresando…' : 'Ingresar a mis finanzas'}</button>
          </form>
          <p className="mt-6 text-center text-small text-ink-700">
            ¿No tiene una cuenta? <Link to="/registro" className="font-medium text-brand-600 underline">Crear cuenta gratis</Link>
          </p>
        </section>
      </div>
    </main>
  );
}
