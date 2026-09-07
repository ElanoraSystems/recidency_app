let container: HTMLDivElement | null = null;

function getContainer(): HTMLDivElement {
  if (container && document.body.contains(container)) return container;
  container = document.createElement("div");
  container.style.cssText = "position:fixed;bottom:20px;right:20px;z-index:9999;display:flex;flex-direction:column;gap:8px;";
  document.body.appendChild(container);
  return container;
}

export function toast(message: string) {
  const el = document.createElement("div");
  el.textContent = message;
  el.style.cssText =
    "background:var(--ink-900,#1c1f1a);color:#fff;padding:10px 16px;border-radius:10px;font-size:13px;font-weight:600;box-shadow:0 8px 24px rgba(0,0,0,0.2);opacity:0;transform:translateY(6px);transition:opacity 200ms ease,transform 200ms ease;";
  getContainer().appendChild(el);
  requestAnimationFrame(() => {
    el.style.opacity = "1";
    el.style.transform = "translateY(0)";
  });
  setTimeout(() => {
    el.style.opacity = "0";
    el.style.transform = "translateY(6px)";
    setTimeout(() => el.remove(), 220);
  }, 2600);
}
