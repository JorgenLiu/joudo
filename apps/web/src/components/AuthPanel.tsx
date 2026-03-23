type AuthPanelProps = {
  visible: boolean;
  isRefreshingAuth: boolean;
  onRefreshAuth: () => Promise<void>;
};

export function AuthPanel({ visible, isRefreshingAuth, onRefreshAuth }: AuthPanelProps) {
  if (!visible) {
    return null;
  }

  return (
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
        <details className="collapsible authFaqCollapsible">
          <summary>常见问题</summary>
          <div className="authFaqContent">
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
          </div>
        </details>
        <div className="authActions">
          <button type="button" onClick={() => void onRefreshAuth()} disabled={isRefreshingAuth}>
            {isRefreshingAuth ? "检查中" : "重新检查登录状态"}
          </button>
        </div>
      </div>
    </section>
  );
}