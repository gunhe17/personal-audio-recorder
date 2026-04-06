(function () {
  const data = window.RECORDER_MOCK;
  const button = document.querySelector("[data-start-session]");

  if (!data || !button) {
    return;
  }

  function createSessionId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }

    return "sess_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 10);
  }

  button.addEventListener("click", function () {
    const sessionId = createSessionId();
    window.location.href = data.buildSessionHref(sessionId);
  });
})();
