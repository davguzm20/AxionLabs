import { zodResolver } from '@hookform/resolvers/zod';
import { Mail, Plus, Smartphone, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useThresholds } from '../hooks/useThresholds';

const schema = z.object({
  thresholds: z.array(z.number().int().min(1).max(100)).min(1, 'Agrega al menos un porcentaje.').max(5, 'Puedes configurar hasta cinco porcentajes.'),
  channels: z.array(z.enum(['app', 'email'])),
});
type FormValues = z.infer<typeof schema>;

interface Props {
  categoryId: string;
  categoryName: string;
  onClose: () => void;
  onSaved: (message: string) => void;
}

export function ThresholdConfigModal({ categoryId, categoryName, onClose, onSaved }: Props) {
  const { config, loading, saving, error, save } = useThresholds(categoryId);
  const [custom, setCustom] = useState('');
  const { register, handleSubmit, watch, setValue, reset, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { thresholds: [75, 90], channels: ['app'] },
  });
  const thresholds = watch('thresholds');

  useEffect(() => {
    if (config) reset({ thresholds: config.thresholds, channels: config.channels as FormValues['channels'] });
  }, [config, reset]);

  const toggleThreshold = (value: number) => {
    const next = thresholds.includes(value)
      ? thresholds.filter((item) => item !== value)
      : [...thresholds, value].sort((a, b) => a - b);
    setValue('thresholds', next, { shouldValidate: true, shouldDirty: true });
  };

  const addCustom = () => {
    const value = Number(custom);
    if (Number.isInteger(value) && value >= 1 && value <= 100 && !thresholds.includes(value) && thresholds.length < 5) {
      setValue('thresholds', [...thresholds, value].sort((a, b) => a - b), { shouldValidate: true, shouldDirty: true });
      setCustom('');
    }
  };

  const submit = async (values: FormValues) => {
    try {
      await save({ thresholds: values.thresholds, channels: values.channels });
      onSaved('Configuración de alertas guardada.');
      onClose();
    } catch {
      // El error queda visible en el modal para permitir corregir o reintentar.
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/50 sm:items-center sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="threshold-title" className="max-h-[94dvh] w-full overflow-y-auto rounded-t-xl bg-white p-5 shadow-lg sm:max-w-lg sm:rounded-xl sm:p-6">
        <header className="mb-5 flex items-center justify-between gap-3">
          <div>
            <h2 id="threshold-title" className="text-lg font-semibold text-ink-900">Configurar alertas</h2>
            <p className="mt-1 text-sm text-gray-500">{categoryName}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="grid size-11 shrink-0 place-items-center rounded-lg text-gray-500 hover:bg-gray-100"><X aria-hidden="true" size={20} /></button>
        </header>
        {loading ? <p role="status" className="py-8 text-center text-sm text-gray-500">Cargando configuración…</p> : (
          <form onSubmit={handleSubmit(submit)} noValidate className="space-y-5">
            <fieldset>
              <legend className="text-sm font-semibold text-gray-800">Avisarme al llegar a</legend>
              <div className="mt-3 flex flex-wrap gap-2">
                {[75, 90, 100].map((value) => (
                  <button key={value} type="button" aria-pressed={thresholds.includes(value)} onClick={() => toggleThreshold(value)} className={`min-h-11 rounded-full border px-4 text-sm font-medium ${thresholds.includes(value) ? 'border-teal-600 bg-teal-50 text-teal-800' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`}>{value}%</button>
                ))}
                {thresholds.filter((value) => ![75, 90, 100].includes(value)).map((value) => <button key={value} type="button" aria-label={`Quitar ${value}%`} onClick={() => toggleThreshold(value)} className="min-h-11 rounded-full border border-teal-600 bg-teal-50 px-4 text-sm font-medium text-teal-800">{value}% ×</button>)}
              </div>
              <div className="mt-3 flex gap-2">
                <label className="sr-only" htmlFor="custom-threshold">Porcentaje personalizado</label>
                <input id="custom-threshold" type="number" min={1} max={100} step={1} inputMode="numeric" value={custom} onChange={(event) => setCustom(event.target.value)} placeholder="Otro porcentaje" className="min-h-11 min-w-0 flex-1 rounded-lg border border-gray-300 px-3 text-sm" />
                <button type="button" onClick={addCustom} disabled={!custom || thresholds.length >= 5} className="flex min-h-11 items-center gap-1 rounded-lg border border-gray-300 px-3 text-sm font-medium text-gray-700 disabled:opacity-50"><Plus aria-hidden="true" size={17} />Agregar</button>
              </div>
              {errors.thresholds && <p role="alert" className="mt-2 text-sm text-red-600">{errors.thresholds.message}</p>}
              <p className="mt-1 text-xs text-gray-500">Elige entre uno y cinco porcentajes enteros del 1% al 100%.</p>
            </fieldset>

            <fieldset>
              <legend className="text-sm font-semibold text-gray-800">Canales</legend>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <label className="flex min-h-12 items-center gap-3 rounded-lg border border-gray-200 px-3 text-sm text-gray-700"><Smartphone aria-hidden="true" size={18} className="text-teal-700" /><input type="checkbox" value="app" {...register('channels')} className="size-4 accent-teal-700" />App</label>
                <label className="flex min-h-12 items-center gap-3 rounded-lg border border-gray-200 px-3 text-sm text-gray-700"><Mail aria-hidden="true" size={18} className="text-teal-700" /><input type="checkbox" value="email" {...register('channels')} className="size-4 accent-teal-700" />Correo</label>
              </div>
            </fieldset>
            {(error || errors.channels) && <p role="alert" className="text-sm text-red-600">{error ?? 'Selecciona un canal válido.'}</p>}
            <div className="flex gap-3 pt-1">
              <button type="button" onClick={onClose} className="min-h-11 flex-1 rounded-lg border border-gray-300 px-3 text-sm font-medium text-gray-700">Cancelar</button>
              <button type="submit" disabled={saving} className="min-h-11 flex-1 rounded-lg bg-brand-600 px-3 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">{saving ? 'Guardando…' : 'Guardar'}</button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
