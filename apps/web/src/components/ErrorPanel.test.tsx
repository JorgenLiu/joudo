import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { BridgeOperationError } from "@joudo/shared";

import { ErrorPanel } from "./ErrorPanel";

const error: BridgeOperationError = {
  code: "validation",
  message: "Prompt 不能为空。",
  nextAction: "补充一条具体任务描述后再重新发送。",
  retryable: true,
  details: "bridge rejected empty prompt payload",
};

describe("ErrorPanel", () => {
  it("renders structured error content and invokes retry and dismiss actions", async () => {
    const onRetry = vi.fn().mockResolvedValue(undefined);
    const onDismiss = vi.fn();

    render(<ErrorPanel error={error} retryLabel="重试发送 prompt" onRetry={onRetry} onDismiss={onDismiss} />);

    expect(screen.getByText("请求无效")).toBeInTheDocument();
    expect(screen.getByText("Prompt 不能为空。")) .toBeInTheDocument();
    expect(screen.getByText("补充一条具体任务描述后再重新发送。")).toBeInTheDocument();
    expect(screen.getByText("bridge rejected empty prompt payload")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "重试发送 prompt" }));
    await waitFor(() => expect(onRetry).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});