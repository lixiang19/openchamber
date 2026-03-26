import type { PiAgentInfo, PiServerEvent, PiSessionViewState } from './types';

const API_BASE = '/api/pi';

const parseResponse = async <T>(response: Response): Promise<T> => {
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(text || `Request failed (${response.status})`);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return response.json() as Promise<T>;
};

export const piClient = {
  async listSessions(): Promise<PiSessionViewState[]> {
    const response = await fetch(`${API_BASE}/sessions`, { headers: { Accept: 'application/json' } });
    return parseResponse<PiSessionViewState[]>(response);
  },
  async listAgents(cwd?: string): Promise<PiAgentInfo[]> {
    const url = new URL(`${API_BASE}/agents`, window.location.origin);
    if (cwd) url.searchParams.set('cwd', cwd);
    const response = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
    return parseResponse<PiAgentInfo[]>(response);
  },
  async createSession(payload?: { cwd?: string; title?: string }): Promise<PiSessionViewState> {
    const response = await fetch(`${API_BASE}/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload || {}),
    });
    return parseResponse<PiSessionViewState>(response);
  },
  async getSession(sessionId: string): Promise<PiSessionViewState> {
    const response = await fetch(`${API_BASE}/sessions/${encodeURIComponent(sessionId)}`, {
      headers: { Accept: 'application/json' },
    });
    return parseResponse<PiSessionViewState>(response);
  },
  async prompt(sessionId: string, text: string): Promise<void> {
    const response = await fetch(`${API_BASE}/sessions/${encodeURIComponent(sessionId)}/prompt`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ text }),
    });
    await parseResponse<void>(response);
  },
  async abort(sessionId: string): Promise<void> {
    const response = await fetch(`${API_BASE}/sessions/${encodeURIComponent(sessionId)}/abort`, {
      method: 'POST',
      headers: { Accept: 'application/json' },
    });
    await parseResponse<void>(response);
  },
  async respondToRequest(requestId: string, responseValue: string | boolean): Promise<void> {
    const response = await fetch(`${API_BASE}/requests/${encodeURIComponent(requestId)}/respond`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ response: responseValue }),
    });
    await parseResponse<void>(response);
  },
  async rejectRequest(requestId: string): Promise<void> {
    const response = await fetch(`${API_BASE}/requests/${encodeURIComponent(requestId)}/reject`, {
      method: 'POST',
      headers: { Accept: 'application/json' },
    });
    await parseResponse<void>(response);
  },
  subscribe(sessionId: string | null, onEvent: (event: PiServerEvent) => void): () => void {
    const url = new URL(`${API_BASE}/events`, window.location.origin);
    if (sessionId) {
      url.searchParams.set('sessionId', sessionId);
    }

    const source = new EventSource(url.toString());
    source.onmessage = (message) => {
      if (!message.data) return;
      try {
        const parsed = JSON.parse(message.data) as PiServerEvent;
        onEvent(parsed);
      } catch (error) {
        console.warn('Failed to parse Pi SSE event:', error);
      }
    };
    return () => source.close();
  },
};
