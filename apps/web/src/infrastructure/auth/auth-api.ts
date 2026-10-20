import { apiFetch } from '../http/api-client';

export function getSession() {
  return apiFetch('/api/auth/session');
}

export function logout() {
  return apiFetch('/api/auth/logout', { method: 'POST' });
}

export function login(username: string, password: string) {
  return apiFetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
}
