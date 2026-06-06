function ensureToastContainer() {
  let container = document.getElementById("toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    const target = document.body || document.documentElement;
    target.appendChild(container);
  }
  return container;
}

function dismissToast(toast) {
  if (!toast || toast.dataset.dismissing) return;
  toast.dataset.dismissing = "1";
  toast.classList.add("leaving");
  window.setTimeout(() => toast.remove(), 240);
}

export function showToast(message, type = "info") {
  const allowedTypes = new Set(["success", "error", "warning", "info"]);
  const toastType = allowedTypes.has(type) ? type : "info";
  const container = ensureToastContainer();
  const toast = document.createElement("div");
  toast.className = `toast toast-${toastType}`;
  toast.role = "status";
  toast.ariaLive = toastType === "error" ? "assertive" : "polite";

  const icon = document.createElement("div");
  icon.className = "toast-icon";
  icon.textContent = toastType === "success" ? "✓" : toastType === "error" ? "✕" : toastType === "warning" ? "!" : "i";

  const messageEl = document.createElement("div");
  messageEl.className = "toast-message";
  messageEl.textContent = String(message || "");

  toast.append(icon, messageEl);
  if (toastType === "error") {
    const close = document.createElement("button");
    close.type = "button";
    close.className = "toast-close";
    close.ariaLabel = "Cerrar notificación";
    close.textContent = "×";
    close.addEventListener("click", () => dismissToast(toast));
    toast.append(close);
  } else {
    window.setTimeout(() => dismissToast(toast), 4000);
  }

  container.appendChild(toast);
  return toast;
}
