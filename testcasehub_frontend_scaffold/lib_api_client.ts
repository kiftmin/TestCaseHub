import { JwtUser } from '../types/api';

const API_BASE_URL = 'http://localhost:3000/api';

export async function customFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('tch_token');
  
  const headers = new Headers(options.headers);
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  
  if (!(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
  });

  if (response.status === 429) {
    throw new Error('Too many login attempts. Please wait before trying again.');
  }

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.message || `HTTP ${response.status}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as T;
}
