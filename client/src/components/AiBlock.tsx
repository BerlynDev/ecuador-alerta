import type { AiText } from '@ea/shared';

type State = { status: 'idle' } | { status: 'loading' } | { status: 'done'; result: AiText } | { status: 'error'; message: string };
export type AiState = State;

/** Renders an AI text with an honest label about where it came from. */
export function AiBlock({ state, onRetry }: { state: State; onRetry?: () => void }) {
  if (state.status === 'idle') return null;
  if (state.status === 'loading') {
    return (
      <p className="ai ai--loading" aria-live="polite">
        Redactando a partir de los datos…
      </p>
    );
  }
  if (state.status === 'error') {
    return (
      <p className="ai ai--error" role="alert">
        No se pudo generar el texto: {state.message}{' '}
        {onRetry && (
          <button type="button" className="link" onClick={onRetry}>
            Reintentar
          </button>
        )}
      </p>
    );
  }
  const { result } = state;
  return (
    <div className="ai" aria-live="polite">
      <p className="ai__text">{result.text}</p>
      <p className="ai__origin">
        {result.origin === 'llm'
          ? 'Redactado por IA solo con los datos mostrados; las cifras se verificaron automáticamente.'
          : (result.note ?? 'Texto automático generado a partir de los datos.')}
      </p>
    </div>
  );
}
