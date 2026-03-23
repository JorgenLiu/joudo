import { useEffect, useRef, useState } from "react";

import type { TotpSetupResponse, TotpVerifyResponse } from "@joudo/shared";

import { bridgeOrigin } from "../hooks/bridge-utils";

type TotpGateProps = {
  onAuthenticated: (token: string) => void;
};

const DIGITS = 6;

export function TotpGate({ onAuthenticated }: TotpGateProps) {
  const [digits, setDigits] = useState<string[]>(Array.from({ length: DIGITS }, () => ""));
  const [error, setError] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [setupInfo, setSetupInfo] = useState<TotpSetupResponse | null>(null);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const code = digits.join("");

  useEffect(() => {
    let cancelled = false;

    void fetch(`${bridgeOrigin}/api/auth/totp/setup`)
      .then(async (response) => {
        const payload = (await response.json()) as TotpSetupResponse;
        if (!cancelled) {
          setSetupInfo(payload);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSetupInfo(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function verify(fullCode: string) {
    if (fullCode.length !== DIGITS || isVerifying) {
      return;
    }

    setIsVerifying(true);
    setError(null);

    try {
      const response = await fetch(`${bridgeOrigin}/api/auth/totp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: fullCode }),
      });

      const result = (await response.json()) as TotpVerifyResponse;

      if (result.success && result.token) {
        onAuthenticated(result.token);
      } else {
        setError(result.message);
        setDigits(Array.from({ length: DIGITS }, () => ""));
        inputRefs.current[0]?.focus();
      }
    } catch {
      setError("无法连接 bridge，请确认 bridge 正在运行。");
    } finally {
      setIsVerifying(false);
    }
  }

  function handleChange(index: number, value: string) {
    const digit = value.replace(/\D/g, "").slice(-1);
    const next = [...digits];
    next[index] = digit;
    setDigits(next);
    setError(null);

    if (digit && index < DIGITS - 1) {
      inputRefs.current[index + 1]?.focus();
    }

    const fullCode = next.join("");
    if (fullCode.length === DIGITS) {
      void verify(fullCode);
    }
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  }

  function handlePaste(e: React.ClipboardEvent) {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, DIGITS);
    if (!pasted) {
      return;
    }
    const next = Array.from({ length: DIGITS }, (_, i) => pasted[i] ?? "");
    setDigits(next);
    const focusIdx = Math.min(pasted.length, DIGITS - 1);
    inputRefs.current[focusIdx]?.focus();

    if (pasted.length === DIGITS) {
      void verify(pasted);
    }
  }

  return (
    <div className="totpGate">
      <div className="totpCard">
        <div className="totpLogo">
          <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
            <rect width="40" height="40" rx="10" fill="var(--accent)" />
            <text x="50%" y="54%" dominantBaseline="middle" textAnchor="middle" fill="#fff" fontSize="20" fontWeight="700" fontFamily="system-ui">J</text>
          </svg>
        </div>
        <h1 className="totpTitle">Joudo</h1>
        <p className="totpSubtitle">安全验证</p>
        <p className="totpHint">
          打开手机验证器应用，输入 6 位动态验证码
        </p>

        <div className="totpDigits" onPaste={handlePaste}>
          {digits.map((d, i) => (
            <input
              key={i}
              ref={(el) => { inputRefs.current[i] = el; }}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={1}
              autoComplete={i === 0 ? "one-time-code" : "off"}
              value={d}
              onChange={(e) => handleChange(i, e.target.value)}
              onKeyDown={(e) => handleKeyDown(i, e)}
              className={`totpDigitInput${error ? " totpDigitError" : ""}`}
              disabled={isVerifying}
              autoFocus={i === 0}
            />
          ))}
        </div>

        {isVerifying && (
          <div className="totpVerifying">
            <span className="totpSpinner" />
            <span>验证中…</span>
          </div>
        )}

        {error && <p className="totpError">{error}</p>}

        <div className="totpDivider" />

        {setupInfo?.available ? (
          <div className="totpSetupCard">
            <p className="totpFootnote">
              {setupInfo.message}
            </p>
            {setupInfo.secret && (
              <code className="totpSecretBlock">{setupInfo.secret}</code>
            )}
            {setupInfo.uri && (
              <details className="authFaqCollapsible">
                <summary>显示 otpauth URI</summary>
                <div className="authFaqContent">
                  <code>{setupInfo.uri}</code>
                </div>
              </details>
            )}
          </div>
        ) : (
          <p className="totpFootnote">
            首次使用？请在本机打开 Joudo 桌面壳，或查看 bridge 启动日志里的二维码完成绑定。
          </p>
        )}
      </div>
    </div>
  );
}
