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
      <nav class="main-nav" aria-label="Main navigation">
        <a class="route-link" href="#/models">模型</a>
        <a class="route-link" href="#/studio">无限画板</a>
        <a class="route-link" href="#/commercial-video">对话式生成</a>
        <a class="route-link" href="#/workflows">工作流</a>
        <a class="route-link" href="#/api-relay">API 中转</a>
        <a class="route-link" href="#/console">控制台</a>
        <a class="route-link" href="#/pricing">价格支付</a>
      </nav>
      <div class="header-actions" id="authArea"></div>
    </header>
    <main id="appView"></main>
    <footer class="footer">
      <span>DreameHub</span>
      <span>Full-stack AI creation platform prototype</span>
    </footer>
    <div class="toast-host" id="toastHost" aria-live="polite"></div>
  `,
);
