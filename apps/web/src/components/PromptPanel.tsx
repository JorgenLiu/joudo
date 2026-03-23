import type { FormEvent } from "react";

type PromptPanelProps = {
  prompt: string;
  promptHint: string;
  isSubmitting: boolean;
  disabled: boolean;
  onPromptChange: (value: string) => void;
  onSubmit: () => Promise<void>;
};

export function PromptPanel({ prompt, promptHint, isSubmitting, disabled, onPromptChange, onSubmit }: PromptPanelProps) {
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onSubmit();
  }

  return (
    <section className="panel">
      <div className="sectionHeader">
        <h2>提示词</h2>
        <span>{promptHint}</span>
      </div>
      <form className="promptForm" onSubmit={(event) => void handleSubmit(event)}>
        <textarea
          value={prompt}
          onChange={(event) => onPromptChange(event.target.value)}
          placeholder="输入你要发给 Copilot 会话的提示词"
          rows={5}
          style={{ maxHeight: 280 }}
        />
        <button type="submit" disabled={isSubmitting || disabled || !prompt.trim()}>
          {isSubmitting ? "发送中" : "发送到 bridge"}
        </button>
      </form>
    </section>
  );
}