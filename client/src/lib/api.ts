const TOKEN_KEY = 'comunidade_token';

const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

export function apiUrl(path: string) {
  return `${API_BASE}/api${path}`;
}

export function mediaUrl(path: string | null | undefined) {
  if (!path) return '';
  if (
    path.startsWith('http://') ||
    path.startsWith('https://') ||
    path.startsWith('data:') ||
    path.startsWith('blob:')
  ) {
    return path;
  }
  return `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem(TOKEN_KEY);
  const headers: Record<string, string> = {
    ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
    ...(options.headers as Record<string, string>),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(apiUrl(path), { ...options, headers });
  } catch {
    throw new Error('Não foi possível conectar à API. Verifique sua conexão.');
  }

  const text = await res.text();
  let data: { error?: string } & T = {} as { error?: string } & T;
  if (text) {
    try {
      data = JSON.parse(text) as { error?: string } & T;
    } catch {
      if (!res.ok) {
        throw new Error(`API indisponível (HTTP ${res.status}). Tente de novo em alguns segundos.`);
      }
      throw new Error('Resposta inválida da API');
    }
  }

  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data as T;
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export async function uploadFile(file: File) {
  const form = new FormData();
  form.append('file', file);
  const token = getToken();
  const res = await fetch(apiUrl('/upload'), {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  const text = await res.text();
  let data: { url?: string; error?: string } = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    /* ignore */
  }
  if (!res.ok) throw new Error(data.error || `Falha no upload (HTTP ${res.status})`);
  if (!data.url) throw new Error('Upload sem URL');
  return data as { url: string };
}
