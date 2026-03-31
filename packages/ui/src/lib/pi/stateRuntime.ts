import type { PiServerEvent, PiSessionViewState } from './types';
import {
  applyPiServerEventAction,
  bootstrapSessionsAction,
  createInitialPiClientState,
  piClientReducer,
  upsertSessionAction,
  type PiClientState,
} from './reducer';

type PiClientStateListener = (state: PiClientState) => void;

let currentState: PiClientState = createInitialPiClientState();
const listeners = new Set<PiClientStateListener>();

const commitState = (nextState: PiClientState) => {
  if (nextState === currentState) {
    return;
  }
  currentState = nextState;
  listeners.forEach((listener) => {
    listener(currentState);
  });
};

export const getPiClientState = (): PiClientState => currentState;

export const subscribePiClientState = (listener: PiClientStateListener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const resetPiClientState = (): void => {
  commitState(createInitialPiClientState());
};

export const bootstrapPiClientSessions = (sessions: PiSessionViewState[]): void => {
  commitState(piClientReducer(currentState, bootstrapSessionsAction(sessions)));
};

export const upsertPiClientSession = (session: PiSessionViewState, options?: { select?: boolean }): void => {
  commitState(piClientReducer(currentState, upsertSessionAction(session, options?.select ?? false)));
};

export const applyPiClientServerEvent = (event: PiServerEvent): void => {
  commitState(piClientReducer(currentState, applyPiServerEventAction(event)));
};
