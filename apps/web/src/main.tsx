import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { BridgeProvider } from "./hooks/BridgeContext";
import "./styles/index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <BridgeProvider>
        <App />
      </BridgeProvider>
    </ErrorBoundary>
  </StrictMode>,
);
