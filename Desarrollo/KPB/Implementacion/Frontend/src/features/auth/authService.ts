import { api } from '../../lib/api';

export interface LoginResponse {
  access_token: string;
  token_type: string;
  inactivity_timeout_seconds: number;
  user: { id: string; email: string };
}

export async function login(email: string, password: string): Promise<LoginResponse> {
  return api<LoginResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password, device: { platform: 'web' } }),
  });
}

export interface PasswordRecoveryResponse {
  recovery_id: string;
  code_expires_in_seconds: number;
  message: string;
}

export function requestPasswordRecovery(email: string): Promise<PasswordRecoveryResponse> {
  return api<PasswordRecoveryResponse>('/auth/password/forgot', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

export function verifyPasswordRecoveryCode(recoveryId: string, code: string): Promise<{ reset_token: string; reset_token_expires_in_seconds: number }> {
  return api<{ reset_token: string; reset_token_expires_in_seconds: number }>('/auth/password/verify-code', {
    method: 'POST',
    body: JSON.stringify({ recovery_id: recoveryId, code }),
  });
}

export function resetPassword(resetToken: string, newPassword: string, confirmPassword: string): Promise<void> {
  return api<void>('/auth/password/reset', {
    method: 'POST',
    body: JSON.stringify({ reset_token: resetToken, new_password: newPassword, confirm_password: confirmPassword }),
  });
}

export function logout(): Promise<void> {
  return api<void>('/auth/logout', { method: 'POST' });
}
