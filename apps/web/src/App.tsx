import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import type {
  ApprovalResolutionPayload,
  ApprovalRequest,
  RepoDescriptor,
  ServerEvent,
  SessionSnapshot,
  SessionTimelineEntry,
} from "@joudo/shared";

const bridgeOrigin = import.meta.env.VITE_BRIDGE_ORIGIN ?? `http://${window.location.hostname}:8787`;
const bridgeSocketOrigin = bridgeOrigin.replace("http://", "ws://").replace("https://", "wss://");

const emptySnapshot: SessionSnapshot = {
  sessionId: "mvp-session",
  status: "disconnected",
  repo: null,
  model: "gpt-5-mini",
  auth: {
    status: "unknown",
    message: "正在检查 Copilot CLI 登录状态。",
  },
  lastPrompt: null,
  approvals: [],
  timeline: [],
  summary: null,
  updatedAt: new Date(0).toISOString(),
};

function timelineLabel(entry: SessionTimelineEntry) {
  switch (entry.kind) {
    case "prompt":
      return "提示词";
    case "assistant":
      return "回复";
    case "approval-requested":
      return "待审批";
    case "approval-resolved":
      return "审批结果";
    case "error":
      return "错误";
    case "status":
    default:
      return "状态";
  }
}

async function readJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    headers: {
      "Content-Type": "application/json",
    },
    ...init,
  });

  if (!response.ok) {
    throw new Error(`Request failed with ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export function App() {
  const [repos, setRepos] = useState<RepoDescriptor[]>([]);
  const [snapshot, setSnapshot] = useState<SessionSnapshot>(emptySnapshot);
  const [prompt, setPrompt] = useState("请帮我梳理 bridge 如何接入 ACP 会话与审批流");
  const [connectionState, setConnectionState] = useState("bridge 连接中");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRefreshingAuth, setIsRefreshingAuth] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let isActive = true;

    async function bootstrap() {
      try {
        const [repoResponse, sessionResponse] = await Promise.all([
          readJson<{ repos: RepoDescriptor[] }>(`${bridgeOrigin}/api/repos`),
          readJson<SessionSnapshot>(`${bridgeOrigin}/api/session`),
        ]);

        if (!isActive) {
          return;
        }

        setRepos(repoResponse.repos);
        setSnapshot(sessionResponse);
        setConnectionState("bridge 已连接");
      } catch (error) {
        if (!isActive) {
          return;
        }

        setErrorMessage(error instanceof Error ? error.message : "无法加载 bridge 数据");
        setConnectionState("bridge 连接失败");
      }
    }

    bootstrap();

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    const socket = new WebSocket(`${bridgeSocketOrigin}/ws`);

    socket.addEventListener("open", () => {
      setConnectionState("bridge 实时通道已连接");
    });

    socket.addEventListener("message", (message) => {
      const event = JSON.parse(message.data) as ServerEvent;

      if (event.type === "session.snapshot") {
        setSnapshot(event.payload);
      }
    });

    socket.addEventListener("close", () => {
      setConnectionState("bridge 实时通道已断开");
    });

    return () => {
      socket.close();
    };
  }, []);

  const activeApproval = snapshot.approvals[0] ?? null;
  const promptHint = useMemo(() => {
    if (snapshot.auth.status === "unauthenticated") {
      return "当前 Copilot CLI 未登录，先在终端执行 copilot login，再回来继续发送提示词。";
    }

    if (snapshot.status === "running") {
      return "当前仓库正在执行一轮真实会话，先等待结果或处理待审批请求。";
    }

    if (activeApproval) {
      return "当前有待审批请求，先处理审批再继续发送新提示词。";
    }

    return "现在会优先尝试真实 ACP 会话；遇到权限请求时会转到网页审批。";
  }, [activeApproval, snapshot.auth.status, snapshot.status]);

  async function selectRepo(repoId: string) {
    try {
      setErrorMessage(null);
      const nextSnapshot = await readJson<SessionSnapshot>(`${bridgeOrigin}/api/session/select`, {
        method: "POST",
        body: JSON.stringify({ repoId }),
      });
      setSnapshot(nextSnapshot);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "无法切换仓库");
    }
  }

  async function submitPrompt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!prompt.trim()) {
      return;
    }

    try {
      setIsSubmitting(true);
      setErrorMessage(null);
      const nextSnapshot = await readJson<SessionSnapshot>(`${bridgeOrigin}/api/prompt`, {
        method: "POST",
        body: JSON.stringify({
          sessionId: snapshot.sessionId,
          prompt,
        }),
      });
      setSnapshot(nextSnapshot);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "提交提示词失败");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function resolveApproval(request: ApprovalRequest, decision: ApprovalResolutionPayload["decision"]) {
    try {
      setErrorMessage(null);
      const nextSnapshot = await readJson<SessionSnapshot>(`${bridgeOrigin}/api/approval`, {
        method: "POST",
        body: JSON.stringify({
          approvalId: request.id,
          decision,
        }),
      });
      setSnapshot(nextSnapshot);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "处理审批失败");
    }
  }

  async function refreshAuth() {
    try {
      setIsRefreshingAuth(true);
      setErrorMessage(null);
      const nextSnapshot = await readJson<SessionSnapshot>(`${bridgeOrigin}/api/auth/refresh`, {
        method: "POST",
      });
      setSnapshot(nextSnapshot);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "刷新登录状态失败");
    } finally {
      setIsRefreshingAuth(false);
    }
  }

  return (
    <main className="shell">
      <section className="hero panel">
        <div>
          <p className="eyebrow">Joudo / Web-first MVP</p>
          <h1>先把网页闭环跑通，再决定原生 App 该包成什么样。</h1>
          <p className="lede">
            当前版本把 bridge、审批卡片、结构化摘要和实时事件流放到同一个移动优先网页里，后续原生 App 只需要封装这一层。
          </p>
        </div>
        <div className="heroMeta">
          <span className="pill">{connectionState}</span>
          <span className="pill">模型 {snapshot.model}</span>
          <span className={`pill${snapshot.auth.status === "authenticated" ? "" : " accent"}`}>{snapshot.auth.message}</span>
          <span className="pill accent">会话状态 {snapshot.status}</span>
        </div>
      </section>

      <section className="layout">
        <aside className="panel column">
          <div className="sectionHeader">
            <h2>仓库</h2>
            <span>{repos.length} 个可选项</span>
          </div>
          <div className="stack">
            {repos.map((repo) => {
              const isActive = repo.id === snapshot.repo?.id;
              return (
                <button
                  key={repo.id}
                  className={`repoCard${isActive ? " active" : ""}`}
                  type="button"
                  onClick={() => selectRepo(repo.id)}
                >
                  <strong>{repo.name}</strong>
                  <span>{repo.rootPath}</span>
                  <em>
                    {repo.trusted ? "受信任仓库" : "未受信任"} / 策略 {repo.policyState}
                  </em>
                </button>
              );
            })}
          </div>
        </aside>

        <section className="column mainColumn">
          {snapshot.auth.status !== "authenticated" ? (
            <section className="panel authPanel">
              <div className="sectionHeader">
                <h2>首次配置</h2>
                <span>需要在这台电脑的终端里完成</span>
              </div>
              <div className="authGuide">
                <p>1. 在 Mac 上打开任意一个终端窗口。</p>
                <p>2. 运行下面这条命令，按提示完成浏览器授权。</p>
                <code>copilot login</code>
                <p>3. 在浏览器里输入 device code 之后，还要继续确认 GitHub 授权；终端通常会一直停在 Waiting for authorization..，不会持续刷出新日志。</p>
                <p>4. 看到终端返回登录成功后，再回到 Joudo，点击“重新检查登录状态”。</p>
                <p className="authFootnote">
                  默认情况下，Copilot CLI 会把令牌保存在系统凭据存储里；如果系统没有可用的凭据存储，才会退回到
                  <strong> ~/.copilot/ </strong>
                  下的配置文件。所以同一系统用户下的新 shell、bridge 重启和重新打开网页，都会继续看到这次登录状态。
                </p>
                <p className="authFootnote">
                  如果是自动化或无头环境，才建议改用 COPILOT_GITHUB_TOKEN、GH_TOKEN 或 GITHUB_TOKEN。那种方式默认是进程级的，不适合面向普通用户的首登体验。
                </p>
                <p className="authFootnote">
                  如果 Waiting for authorization.. 持续很久，通常说明浏览器端只完成了输入 code，还没有完成最终授权，或者当前 GitHub 账号没有可用的 Copilot 权限。
                </p>
                <div className="authActions">
                  <button type="button" onClick={refreshAuth} disabled={isRefreshingAuth}>
                    {isRefreshingAuth ? "检查中" : "重新检查登录状态"}
                  </button>
                </div>
              </div>
            </section>
          ) : null}

          <section className="panel">
            <div className="sectionHeader">
              <h2>提示词</h2>
              <span>{promptHint}</span>
            </div>
            <form className="promptForm" onSubmit={submitPrompt}>
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="输入你要发给 Copilot 会话的提示词"
                rows={5}
              />
              <button type="submit" disabled={isSubmitting || Boolean(activeApproval) || snapshot.status === "running"}>
                {isSubmitting ? "发送中" : "发送到 bridge"}
              </button>
            </form>
          </section>

          <section className="panel approvalPanel">
            <div className="sectionHeader">
              <h2>审批</h2>
              <span>{activeApproval ? "需要用户确认" : "当前无待审批请求"}</span>
            </div>
            {activeApproval ? (
              <div className="approvalCard">
                <h3>{activeApproval.title}</h3>
                <p>{activeApproval.rationale}</p>
                <code>{activeApproval.commandPreview}</code>
                <div className="approvalActions">
                  <button type="button" onClick={() => resolveApproval(activeApproval, "deny")}>
                    拒绝
                  </button>
                  <button type="button" className="danger" onClick={() => resolveApproval(activeApproval, "allow")}>
                    批准
                  </button>
                </div>
              </div>
            ) : (
              <p className="emptyState">真实会话遇到权限请求时，这里会出现网页审批卡片。</p>
            )}
          </section>
        </section>

        <aside className="panel column">
          <div className="sectionHeader">
            <h2>摘要</h2>
            <span>{snapshot.model} / 最近更新 {new Date(snapshot.updatedAt).toLocaleTimeString()}</span>
          </div>

          {snapshot.summary ? (
            <div className="summaryCard">
              <h3>{snapshot.summary.title}</h3>
              <p>{snapshot.summary.body}</p>

              <dl className="summaryList">
                <div>
                  <dt>执行命令</dt>
                  <dd>{snapshot.summary.executedCommands.length ? snapshot.summary.executedCommands.join(" / ") : "暂无"}</dd>
                </div>
                <div>
                  <dt>文件变更</dt>
                  <dd>{snapshot.summary.changedFiles.length ? snapshot.summary.changedFiles.join(" / ") : "暂无"}</dd>
                </div>
                <div>
                  <dt>检查</dt>
                  <dd>{snapshot.summary.checks.length ? snapshot.summary.checks.join(" / ") : "暂无"}</dd>
                </div>
                <div>
                  <dt>风险</dt>
                  <dd>{snapshot.summary.risks.length ? snapshot.summary.risks.join(" / ") : "暂无"}</dd>
                </div>
              </dl>

              <div className="nextAction">
                <span>下一步</span>
                <strong>{snapshot.summary.nextAction}</strong>
              </div>
            </div>
          ) : (
            <p className="emptyState">bridge 还没有产生摘要。</p>
          )}

          <div className="metaBlock">
            <span>当前会话</span>
            <strong>{snapshot.sessionId}</strong>
            <small>当前模型：{snapshot.model}</small>
            <small>Copilot 认证：{snapshot.auth.message}</small>
            <small>最近提示词：{snapshot.lastPrompt ?? "尚未发送"}</small>
          </div>

          <div className="timelinePanel">
            <div className="sectionHeader">
              <h2>时间线</h2>
              <span>{snapshot.timeline.length} 条事件</span>
            </div>
            {snapshot.timeline.length ? (
              <div className="timelineList">
                {snapshot.timeline.map((entry) => (
                  <article key={entry.id} className={`timelineEntry ${entry.kind}`}>
                    <div className="timelineMeta">
                      <span>{timelineLabel(entry)}</span>
                      <time>{new Date(entry.timestamp).toLocaleTimeString()}</time>
                    </div>
                    <strong>{entry.title}</strong>
                    <p>{entry.body}</p>
                  </article>
                ))}
              </div>
            ) : (
              <p className="emptyState">会话事件会在这里累计，方便回看整轮执行过程。</p>
            )}
          </div>

          {errorMessage ? <p className="errorBox">{errorMessage}</p> : null}
        </aside>
      </section>
    </main>
  );
}
