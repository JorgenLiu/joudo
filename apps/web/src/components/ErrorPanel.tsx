import type { BridgeOperationError } from "@joudo/shared";

import { bridgeErrorCodeLabel } from "./display";

type ErrorPanelProps = {
  error: BridgeOperationError | null;
  retryLabel?: string | null;
  onRetry?: (() => Promise<void>) | null;
  onDismiss?: (() => void) | null;
};

export function ErrorPanel({ error, retryLabel, onRetry, onDismiss }: ErrorPanelProps) {
  if (!error) {
    return null;
  }

  return (
    <div className="errorPanel">
      <div className="errorPanelHeader">
        <strong>{bridgeErrorCodeLabel(error.code)}</strong>
        {onDismiss ? (
          <button type="button" className="ghostButton" onClick={onDismiss}>
            关闭
          </button>
        ) : null}
      </div>
      <p className="errorBox compact">{error.message}</p>
      <small>{error.nextAction}</small>
      {error.details ? <small className="errorDetails">{error.details}</small> : null}
      {onRetry && retryLabel ? (
        <div className="errorActions">
          <button type="button" className="secondaryButton" onClick={() => void onRetry()}>
            {retryLabel}
          </button>
        </div>
      ) : null}
    </div>
  );
}