import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { api } from '../../lib/api';
import type { ApiError } from '../../lib/errors';

const forgotSchema = z.object({
  email: z.string().trim().email('Ingresa un correo electrónico válido.'),
});
type ForgotValues = z.infer<typeof forgotSchema>;

export function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>();
  const { register, handleSubmit, formState: { errors } } = useForm<ForgotValues>({
    resolver: zodResolver(forgotSchema),
    defaultValues: { email: '' },
  });

  async function onSubmit(values: ForgotValues) {
    setLoading(true);
    setErrorMessage(undefined);
    try {
      await api<{ message: string }>('/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify(values),
      });
      navigate('/reset-password', { state: { email: values.email } });
    } catch (error) {
      // The contract specifies a generic success response to avoid email enumeration.
      // Keep the same next step if the request cannot be completed temporarily.
      setErrorMessage((error as ApiError).message || 'El servicio no está disponible. Intenta más tarde.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-white px-6 py-10">
      <section className="mx-auto w-full max-w-md">
        <div className="mb-6 flex justify-center">
          <img src="/logo.png" alt="KhipuBot Logo" className="h-auto w-40 max-w-full sm:w-56" />
        </div>
        <h1 className="text-center font-display text-h1">Recupera tu contraseña</h1>
        <p className="mt-2 text-center text-body text-ink-500">Te enviaremos un código a tu correo.</p>
        <form className="mt-6 space-y-5" onSubmit={handleSubmit(onSubmit)} noValidate>
          <div>
            <label htmlFor="recovery-email" className="mb-2 block text-small font-medium text-ink-900">Correo electrónico</label>
            <input
              id="recovery-email" type="email" autoComplete="email" autoFocus
              aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? 'recovery-email-error' : undefined}
              className="min-h-11 w-full rounded-md border border-ink-300 bg-white px-3 text-body focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-500 aria-[invalid=true]:border-danger"
              {...register('email')}
            />
            {errors.email && <p id="recovery-email-error" role="alert" className="mt-1 text-small text-danger">{errors.email.message}</p>}
          </div>
          {errorMessage && <p role="alert" className="text-small text-danger">{errorMessage}</p>}
          <button type="submit" disabled={loading} aria-busy={loading} className="min-h-[52px] w-full rounded-md bg-brand-600 px-4 font-semibold text-white hover:bg-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500 disabled:opacity-70">
            {loading ? 'Enviando…' : 'Enviar código'}
          </button>
        </form>
        <p className="mt-6 text-center text-small"><Link to="/login" className="text-brand-600 underline">Volver a iniciar sesión</Link></p>
      </section>
    </main>
  );
}
