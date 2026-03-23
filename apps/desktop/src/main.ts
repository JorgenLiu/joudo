import "./style.css";

const root = document.querySelector("#app");

if (!root) {
  throw new Error("Missing #app root");
}

root.innerHTML = `
  <main class="shell">
    <section class="card hero">
      <p class="eyebrow">Joudo Desktop</p>
      <h1>菜单栏壳骨架已就绪</h1>
      <p class="lede">这层壳后续只负责 bridge 生命周期、TOTP 绑定入口和 repo init，不承载 prompt / approval / summary 业务。</p>
    </section>

    <section class="card checklist">
      <h2>下一步将接入</h2>
      <ul>
        <li>Bridge 后台启动与健康检查</li>
        <li>本机 TOTP 绑定入口</li>
        <li>当前仓库选择与 repo init</li>
      </ul>
    </section>

    <section class="card actions">
      <button id="open-web" type="button">打开本地 Joudo Web UI</button>
      <p class="hint">默认目标: http://127.0.0.1:8787</p>
    </section>
  </main>
`;

const openWebButton = document.querySelector<HTMLButtonElement>("#open-web");
openWebButton?.addEventListener("click", () => {
  window.open("http://127.0.0.1:8787", "_blank", "noopener,noreferrer");
});
