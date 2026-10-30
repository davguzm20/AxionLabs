import { http, HttpResponse } from 'msw';

export const handlers = [
  http.get('*/health', () => HttpResponse.json({ status: 'ok' })),
  http.post('*/auth/login', () => HttpResponse.json({
    access_token: 'test-access-token',
    token_type: 'bearer',
    expires_in: 1200,
    user: {
      id: '6a2e2604-2fac-4d0e-b4c3-71cd82b85d80',
      name: 'Andrea',
      surname: 'Quispe',
      email: 'andrea@example.com',
      created_at: '2026-10-27T10:00:00Z',
    },
  })),
];
