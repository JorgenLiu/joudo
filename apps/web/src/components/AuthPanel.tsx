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
        <p>在终端运行下面的命令并完成浏览器授权。</p>
        <code>copilot login</code>
        <p>授权完成后回到这里刷新状态。</p>
        <div className="authActions">
          <button type="button" onClick={() => void onRefreshAuth()} disabled={isRefreshingAuth}>
            {isRefreshingAuth ? "检查中" : "重新检查登录状态"}
          </button>
        </div>
      </div>
    </section>
  );
}