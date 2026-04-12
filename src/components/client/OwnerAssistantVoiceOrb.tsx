"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRealtimeVoice } from "@/components/client/useRealtimeVoice";
import type { AssistantVoice } from "@/components/client/assistantVoice";

export default function OwnerAssistantVoiceOrb({
  storeId,
  voice,
  primaryLanguage,
  secondaryLanguage,
  onOpenAssistant,
}: {
  storeId: string;
  voice: AssistantVoice;
  primaryLanguage: string;
  secondaryLanguage: string;
  onOpenAssistant?: () => void;
}) {
  const [portalNode, setPortalNode] = useState<Element | null>(null);
  const {
    supportsRealtime,
    state,
    uiState,
    mode,
    error,
    listening,
    toggleListening,
  } = useRealtimeVoice(
    storeId,
    voice,
    primaryLanguage,
    secondaryLanguage,
    storeId,
  );

  useEffect(() => {
    setPortalNode(document.body);
  }, []);

  if (!portalNode || !supportsRealtime || !storeId) {
    return null;
  }

  return createPortal(
    <div
      className="assistant-orb"
      data-state={state}
      data-listening={listening ? "true" : "false"}
    >
      <button
        type="button"
        className="assistant-orb__btn"
        aria-label="Toggle voice assistant"
        onClick={toggleListening}
      >
        <span className="assistant-orb__ring" />
        <span className="assistant-orb__core">
          <svg
            viewBox="0 0 24 24"
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
          >
            <path d="M12 3a3 3 0 0 1 3 3v6a3 3 0 1 1-6 0V6a3 3 0 0 1 3-3Z" />
            <path d="M19 11a7 7 0 0 1-14 0" />
            <path d="M12 18v3" />
          </svg>
        </span>
      </button>
      <button
        type="button"
        onClick={onOpenAssistant}
        className="assistant-orb__label"
      >
        {uiState === "connecting" || state === "connecting"
          ? "Connecting"
          : uiState === "thinking"
            ? "Thinking"
            : uiState === "speaking"
              ? "Speaking"
              : listening
            ? "Listening"
            : mode === "active"
              ? "Voice on"
            : "Ask AI"}
      </button>
      {error && <div className="assistant-orb__error">{error}</div>}
    </div>,
    portalNode,
  );
}
