import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, Mic, Square, Upload, X } from 'lucide-react';

type VoiceRecorderProps = {
  onClose: () => void;
  onSubmit: (audio: File) => Promise<void>;
};

const MAX_AUDIO_BYTES = 5 * 1024 * 1024;
const MAX_AUDIO_SECONDS = 60;
const SUPPORTED_AUDIO_TYPES = new Set(['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav']);
const RECORDER_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg', 'audio/mp4'];

async function getDuration(file: File): Promise<number> {
  const objectUrl = URL.createObjectURL(file);
  const audio = new Audio();
  try {
    return await new Promise<number>((resolve, reject) => {
      audio.onloadedmetadata = () => resolve(audio.duration);
      audio.onerror = () => reject(new Error('No se pudo leer la duración del audio.'));
      audio.src = objectUrl;
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
    audio.src = '';
  }
}

async function validateAudioFile(file: File): Promise<string | null> {
  const mimeType = file.type.split(';')[0] ?? '';
  if (!SUPPORTED_AUDIO_TYPES.has(mimeType)) {
    return 'Usa un audio webm, ogg, mp4, mpeg o wav.';
  }
  if (file.size > MAX_AUDIO_BYTES) {
    return 'El audio no puede superar los 5 MB.';
  }
  try {
    if (await getDuration(file) > MAX_AUDIO_SECONDS) {
      return 'El audio no puede durar más de 60 segundos.';
    }
  } catch {
    return 'No se pudo leer el audio. Selecciona otro archivo.';
  }
  return null;
}

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, '0');
  const remainingSeconds = (seconds % 60).toString().padStart(2, '0');
  return minutes + ':' + remainingSeconds;
}

export function VoiceRecorder({ onClose, onSubmit }: VoiceRecorderProps) {
  const [recording, setRecording] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const timerRef = useRef<number | null>(null);
  const startTimeRef = useRef(0);
  const cancelledRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function stopTracks() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  function stopRecording() {
    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.stop();
    }
  }

  useEffect(() => () => {
    cancelledRef.current = true;
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
  }, []);

  async function startRecording() {
    setError(null);
    setAudioFile(null);
    setElapsedSeconds(0);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('Este navegador no permite grabar audio. Puedes seleccionar un archivo.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = RECORDER_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder;
      chunksRef.current = [];
      cancelledRef.current = false;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        setError('No se pudo grabar el audio. Inténtalo nuevamente.');
        stopTracks();
        setRecording(false);
      };
      recorder.onstop = () => {
        stopTracks();
        if (cancelledRef.current) return;
        setRecording(false);
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        if (blob.size > MAX_AUDIO_BYTES) {
          setError('El audio supera los 5 MB. Graba un mensaje más corto.');
          return;
        }
        const baseType = blob.type.split(';')[0];
        const extension = baseType === 'audio/ogg' ? 'ogg' : baseType === 'audio/mp4' ? 'mp4' : 'webm';
        setAudioFile(new File([blob], 'nota-de-voz.' + extension, { type: blob.type }));
      };

      recorder.start();
      startTimeRef.current = Date.now();
      setRecording(true);
      timerRef.current = window.setInterval(() => {
        const seconds = Math.min(MAX_AUDIO_SECONDS, Math.floor((Date.now() - startTimeRef.current) / 1000));
        setElapsedSeconds(seconds);
        if (seconds >= MAX_AUDIO_SECONDS) stopRecording();
      }, 500);
    } catch {
      stopTracks();
      setError('No se pudo acceder al micrófono. Revisa el permiso o selecciona un archivo.');
    }
  }

  async function selectAudio(file: File | undefined) {
    setError(null);
    setAudioFile(null);
    if (!file) return;
    const validationError = await validateAudioFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }
    setElapsedSeconds(Math.floor(await getDuration(file)));
    setAudioFile(file);
  }

  async function submitAudio() {
    if (!audioFile || sending) return;
    setSending(true);
    setError(null);
    try {
      await onSubmit(audioFile);
      onClose();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'No se pudo enviar el audio. Inténtalo nuevamente.');
    } finally {
      setSending(false);
    }
  }

  function cancel() {
    cancelledRef.current = true;
    stopRecording();
    stopTracks();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink-900/50 p-0 sm:items-center sm:p-4">
      <section role="dialog" aria-modal="true" aria-labelledby="voice-recorder-title" className="w-full max-w-lg rounded-t-2xl bg-white p-5 shadow-lg sm:rounded-2xl">
        <div className="flex items-center justify-between gap-3">
          <h2 id="voice-recorder-title" className="text-lg font-semibold text-ink-900">Registrar por voz</h2>
          <button type="button" onClick={cancel} disabled={sending} aria-label="Cerrar grabación" className="flex min-h-11 min-w-11 items-center justify-center rounded-md text-ink-700 hover:bg-gray-100 disabled:opacity-50">
            <X aria-hidden="true" size={20} />
          </button>
        </div>

        <p className="mt-2 text-sm text-ink-600">Di el monto y el concepto. Puedes grabar hasta 60 segundos.</p>
        <div className="mt-5 flex flex-col items-center gap-3 rounded-xl bg-gray-50 p-5">
          <p role="status" aria-live="polite" className="font-mono text-2xl font-semibold text-ink-900">{formatTime(elapsedSeconds)} / 01:00</p>
          {recording ? (
            <button type="button" onClick={stopRecording} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-danger-600 px-5 text-sm font-semibold text-white hover:bg-danger-700">
              <Square aria-hidden="true" size={16} /> Detener grabación
            </button>
          ) : (
            <button type="button" onClick={() => void startRecording()} disabled={sending} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-brand-600 px-5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
              <Mic aria-hidden="true" size={18} /> Grabar nota de voz
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/webm,audio/ogg,audio/mp4,audio/mpeg,audio/wav"
            className="sr-only"
            aria-label="Seleccionar archivo de audio"
            onChange={(event) => {
              void selectAudio(event.target.files?.[0]);
              event.currentTarget.value = '';
            }}
          />
          <button type="button" onClick={() => fileInputRef.current?.click()} disabled={recording || sending} className="inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-sm font-medium text-brand-700 hover:bg-brand-50 disabled:opacity-50">
            <Upload aria-hidden="true" size={17} /> Elegir archivo de audio
          </button>
          {audioFile && <p className="max-w-full truncate text-sm text-ink-600">Audio listo: {audioFile.name}</p>}
        </div>

        {error && <p role="alert" className="mt-3 rounded-md bg-red-50 p-3 text-sm text-danger-700">{error}</p>}
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={cancel} disabled={sending} className="min-h-11 rounded-md border border-ink-300 px-4 text-sm font-medium text-ink-900 disabled:opacity-50">Cancelar</button>
          <button type="button" onClick={() => void submitAudio()} disabled={!audioFile || recording || sending} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50">
            {sending && <LoaderCircle aria-hidden="true" className="animate-spin" size={17} />}
            {sending ? 'Enviando…' : 'Enviar audio'}
          </button>
        </div>
      </section>
    </div>
  );
}
