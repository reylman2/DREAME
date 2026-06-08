function defineComponent(name, template) {
  customElements.define(
    name,
    class extends HTMLElement {
      connectedCallback() {
        this.innerHTML = template();
      }
    },
  );
}

defineComponent(
  "app-root",
  () => `
    <header class="topbar">
      <a class="brand route-link" href="#/">
        <span class="brand-mark" aria-hidden="true">D</span>
        <span>DreameHub</span>
      </a>
      <nav class="main-nav" aria-label="主导航">
        <a class="route-link" href="#/models">模型广场</a>
        <a class="route-link" href="#/studio">创作工作台</a>
        <a class="route-link" href="#/workflows">工作流</a>
        <a class="route-link" href="#/console">控制台</a>
        <a class="route-link" href="#/pricing">价格支付</a>
      </nav>
      <div class="header-actions" id="authArea"></div>
    </header>
    <main id="appView"></main>
    <footer class="footer">
      <span>DreameHub</span>
      <span>全栈 AI 创作平台原型 · 验证注册 · Workspace · 钱包 · API Key</span>
    </footer>
    <div class="toast-host" id="toastHost" aria-live="polite"></div>
  `,
);
