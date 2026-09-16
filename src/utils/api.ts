/**
 * API base URL for backend calls.
 *
 * - Local dev with Express (npm run dev): leave VITE_API_BASE_URL empty
 *   and relative "/api/..." calls hit the same origin.
 * - Production (frontend on Pages, backend on Workers): set
 *   VITE_API_BASE_URL=https://chatbot-api.<subdomain>.workers.dev
 */
export function apiUrl(path: string): string {
  const base = (import.meta.env.VITE_API_BASE_URL as string | undefined || '').trim().replace(/\/+$/, '');
  return base ? `${base}${path}` : path;
}
