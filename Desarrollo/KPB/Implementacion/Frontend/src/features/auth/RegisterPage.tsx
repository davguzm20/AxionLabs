import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { api } from '../../lib/api';
import type { ApiError } from '../../lib/errors';

const namePattern = /^[^\d]+$/u;
const registerSchema = z.object({
  name: z.string().trim().min(1, 'Ingresa tus nombres.').max(100).regex(namePattern, 'No uses números en tus nombres.'),
  surname: z.string().trim().min(1, 'Ingresa tus apellidos.').max(100).regex(namePattern, 'No uses números en tus apellidos.'),
  email: z.string().trim().email('Ingresa un correo electrónico válido.'),
  password: z.string().min(8, 'Usa al menos 8 caracteres, con una letra y un número.').max(128).regex(/[A-Za-z]/u, 'Usa al menos 8 caracteres, con una letra y un número.').regex(/\d/u, 'Usa al menos 8 caracteres, con una letra y un número.'),
  confirm_password: z.string().min(8, 'Confirma tu contraseña.'),
  accept_terms: z.boolean().refine(Boolean, 'Debes aceptar los Términos del Servicio y la Política de Privacidad.'),
}).refine((values) => values.password === values.confirm_password, {
  path: ['confirm_password'],
  message: 'Las contraseñas no coinciden.',
});

type RegisterValues = z.infer<typeof registerSchema>;
type RegisterFormValues = z.input<typeof registerSchema>;
type RegisterResponse = { access_token: string; token_type: string; expires_in: number };
type RegistrationError = ApiError & { status?: number };

export function RegisterPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [submitError, setSubmitError] = useState<string>();
  const { register, handleSubmit, setError, formState: { errors } } = useForm<RegisterFormValues, unknown, RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { name: '', surname: '', email: '', password: '', confirm_password: '', accept_terms: false },
  });

  async function onSubmit(values: RegisterValues) {
    setLoading(true);
    setSubmitError(undefined);
    try {
      const response = await api<RegisterResponse>('/auth/register', {
        method: 'POST',
        body: JSON.stringify(values),
      });
      localStorage.setItem('access_token', response.access_token);
      navigate('/inicio', { replace: true, state: { welcomeName: values.name } });
    } catch (error) {
      const apiError = error as RegistrationError;
      if (apiError.status === 409) {
        setSubmitError('Ese correo ya tiene una cuenta. Inicia sesión o recupera tu contraseña.');
      } else if (apiError.status === 422 && apiError.details) {
        apiError.details.forEach(({ field, message }) => {
          if (field in registerSchema.shape) setError(field as keyof RegisterFormValues, { message });
        });
        setSubmitError('Revisa los campos marcados.');
      } else {
        setSubmitError(apiError.message || 'Ocurrió un error. Intenta de nuevo.');
      }
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
          <h1 className="text-center font-display text-h1">Crea tu cuenta</h1>
          <p className="mt-2 text-center text-body text-ink-500">En un solo paso</p>
          <form className="mt-6 space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
            <Field label="Nombres" id="name" error={errors.name?.message}>
              <input id="name" autoComplete="given-name" placeholder="Ej. David Guzmán" aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? 'name-error' : undefined} className={inputClass} {...register('name')} />
            </Field>
            <Field label="Apellidos" id="surname" error={errors.surname?.message}>
              <input id="surname" autoComplete="family-name" aria-invalid={Boolean(errors.surname)} aria-describedby={errors.surname ? 'surname-error' : undefined} className={inputClass} {...register('surname')} />
            </Field>
            <Field label="Correo electrónico" id="email" error={errors.email?.message}>
              <input id="email" type="email" autoComplete="email" aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? 'email-error' : undefined} className={inputClass} {...register('email')} />
            </Field>
            <Field label="Contraseña" id="password" error={errors.password?.message}>
              <input id="password" type="password" autoComplete="new-password" aria-invalid={Boolean(errors.password)} aria-describedby={errors.password ? 'password-error password-help' : 'password-help'} className={inputClass} {...register('password')} />
              <span id="password-help" className="mt-1 block text-small text-ink-500">Mínimo 8 caracteres, con una letra y un número.</span>
            </Field>
            <Field label="Confirmar contraseña" id="confirm_password" error={errors.confirm_password?.message}>
              <input id="confirm_password" type="password" autoComplete="new-password" aria-invalid={Boolean(errors.confirm_password)} aria-describedby={errors.confirm_password ? 'confirm_password-error' : undefined} className={inputClass} {...register('confirm_password')} />
            </Field>
            <div>
              <div className="flex min-h-11 items-start gap-3">
                <input id="accept_terms" type="checkbox" aria-invalid={Boolean(errors.accept_terms)} aria-describedby={errors.accept_terms ? 'accept_terms-error' : undefined} className="mt-1 h-5 w-5 accent-brand-600" {...register('accept_terms')} />
                <label htmlFor="accept_terms" className="text-small text-ink-700">Acepto los Términos del Servicio y la Política de Privacidad.</label>
              </div>
              {errors.accept_terms?.message && <p id="accept_terms-error" role="alert" className="text-small text-danger">{errors.accept_terms.message}</p>}
            </div>
            {submitError && <p role="alert" className="rounded-md border border-danger px-3 py-2 text-small text-danger">{submitError} {submitError.startsWith('Ese correo') && <Link className="underline" to="/login">Inicia sesión</Link>}</p>}
            <button type="submit" disabled={loading} aria-busy={loading} className="min-h-[52px] w-full rounded-md bg-brand-600 px-4 font-semibold text-white hover:bg-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500 disabled:cursor-wait disabled:opacity-70">
              {loading ? 'Registrando…' : 'Registrarme'}
            </button>
          </form>
          <p className="mt-6 text-center text-small text-ink-700">¿Ya tienes una cuenta? <Link to="/login" className="font-medium text-brand-600 underline">Iniciar sesión</Link></p>
        </section>
      </div>
    </main>
  );
}

const inputClass = 'min-h-11 w-full rounded-md border border-ink-300 bg-surface px-3 text-body focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-500 aria-[invalid=true]:border-danger';

function Field({ label, id, error, children }: { label: string; id: string; error?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-small font-medium text-ink-900">{label}</label>
      {children}
      {error && <p id={`${id}-error`} role="alert" className="mt-1 text-small text-danger">{error}</p>}
    </div>
  );
}
