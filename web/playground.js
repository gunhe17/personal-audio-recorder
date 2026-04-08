(function () {
  const PLAYGROUND_PALETTE_STORAGE_KEY = "recorder.playground.styleTokens.v8";
  const DEFAULT_STYLE_TOKENS = Object.freeze({
    "--logic-ds-canvas-start": "#0b0d12",
    "--logic-ds-canvas-end": "#090b10",
    "--logic-ds-surface-chrome-start": "#d8dade",
    "--logic-ds-surface-chrome-end": "#c9ccd2",
    "--logic-ds-surface-panel-start": "#4e525a",
    "--logic-ds-surface-panel-end": "#40444b",
    "--logic-ds-editor-base": "#2b2f36",
    "--logic-ds-text-primary": "#f3f5f8",
    "--logic-ds-text-secondary": "#d6d9e0",
    "--logic-ds-border-soft": "#5f656e",
    "--logic-ds-border-strong": "#787e88",
    "--logic-ds-grid": "#525863",
    "--logic-ds-accent-start": "#3b82f6",
    "--logic-ds-accent-end": "#2563eb",
    "--logic-ds-danger-start": "#e25147",
    "--logic-ds-danger-end": "#cf433a",
    "--logic-ds-playhead": "#ffffff"
  });

  function normalizeHexColor(value, fallback) {
    const candidate = String(value || "").trim();

    if (/^#[0-9a-fA-F]{6}$/.test(candidate)) {
      return candidate.toLowerCase();
    }

    return fallback;
  }

  function formatHexLabel(value) {
    return String(value || "").toUpperCase();
  }

  function readStoredPalette() {
    try {
      const raw = window.localStorage.getItem(PLAYGROUND_PALETTE_STORAGE_KEY);

      if (!raw) {
        return {};
      }

      const parsed = JSON.parse(raw);

      if (!parsed || typeof parsed !== "object") {
        return {};
      }

      return parsed;
    } catch (error) {
      void error;
      return {};
    }
  }

  function persistPalette(palette) {
    try {
      window.localStorage.setItem(PLAYGROUND_PALETTE_STORAGE_KEY, JSON.stringify(palette));
    } catch (error) {
      void error;
    }
  }

  function buildPaletteSnapshot(inputs) {
    return inputs.reduce(function (accumulator, input) {
      const token = input.getAttribute("data-palette-token");

      if (!token || !(token in DEFAULT_STYLE_TOKENS)) {
        return accumulator;
      }

      accumulator[token] = normalizeHexColor(input.value, DEFAULT_STYLE_TOKENS[token]);
      return accumulator;
    }, {});
  }

  function applyStyleTokens(root, palette) {
    Object.keys(DEFAULT_STYLE_TOKENS).forEach(function (token) {
      const fallback = DEFAULT_STYLE_TOKENS[token];
      const nextValue = normalizeHexColor(palette?.[token], fallback);
      root.style.setProperty(token, nextValue);
    });
  }

  function syncPaletteFieldLabel(input) {
    const code = input.closest(".logic-playground__palette-field")?.querySelector("[data-palette-value]");

    if (code) {
      code.textContent = formatHexLabel(input.value);
    }
  }

  function syncPaletteInputs(inputs, palette) {
    inputs.forEach(function (input) {
      const token = input.getAttribute("data-palette-token");

      if (!token || !(token in DEFAULT_STYLE_TOKENS)) {
        return;
      }

      const value = normalizeHexColor(palette[token], DEFAULT_STYLE_TOKENS[token]);
      input.value = value;
      syncPaletteFieldLabel(input);
    });
  }

  function initPaletteControls() {
    const root = document.querySelector(".logic-playground");
    const palettePanel = document.querySelector("[data-playground-palette]");

    if (!root || !palettePanel) {
      return;
    }

    const paletteInputs = Array.from(palettePanel.querySelectorAll("input[type='color'][data-palette-token]"));
    const resetButton = palettePanel.querySelector("[data-palette-reset]");
    const storedPalette = readStoredPalette();
    const resolvedPalette = Object.keys(DEFAULT_STYLE_TOKENS).reduce(function (accumulator, token) {
      accumulator[token] = normalizeHexColor(storedPalette[token], DEFAULT_STYLE_TOKENS[token]);
      return accumulator;
    }, {});

    applyStyleTokens(root, resolvedPalette);
    syncPaletteInputs(paletteInputs, resolvedPalette);

    paletteInputs.forEach(function (input) {
      input.addEventListener("input", function () {
        const token = input.getAttribute("data-palette-token");

        if (!token || !(token in DEFAULT_STYLE_TOKENS)) {
          return;
        }

        const normalized = normalizeHexColor(input.value, DEFAULT_STYLE_TOKENS[token]);
        input.value = normalized;
        root.style.setProperty(token, normalized);
        syncPaletteFieldLabel(input);
        persistPalette(buildPaletteSnapshot(paletteInputs));
      });
    });

    resetButton?.addEventListener("click", function () {
      applyStyleTokens(root, DEFAULT_STYLE_TOKENS);
      syncPaletteInputs(paletteInputs, DEFAULT_STYLE_TOKENS);

      try {
        window.localStorage.removeItem(PLAYGROUND_PALETTE_STORAGE_KEY);
      } catch (error) {
        void error;
      }
    });
  }

  function initHeroIcons() {
    const render = window.logicHeroIcons?.render;

    if (typeof render !== "function") {
      return;
    }

    document.querySelectorAll("[data-hero-icon]").forEach(function (node) {
      const iconName = node.getAttribute("data-hero-icon");

      if (!iconName) {
        return;
      }

      node.innerHTML = render(iconName, "hero-icon");
    });
  }

  function initSharedEditorLayout() {
    const shared = window.logicEditorLayout;

    if (!shared) {
      return;
    }

    document.querySelectorAll("[data-shared-ruler]").forEach(function (node) {
      const columns = Number.parseInt(node.getAttribute("data-columns") || "10", 10);
      node.outerHTML = shared.renderRulerGrid(Number.isFinite(columns) ? columns : 10);
    });

    document.querySelectorAll("[data-shared-empty-canvas]").forEach(function (node) {
      const classes = node.getAttribute("class") || "logic-playground-empty-canvas";
      node.outerHTML = shared.renderEmptyLaneCanvas(classes);
    });
  }

  function closeAll(except) {
    document.querySelectorAll(".logic-playground [data-dropdown-select]").forEach(function (dropdown) {
      if (dropdown === except) {
        return;
      }

      dropdown.classList.remove("is-open");
      dropdown.querySelector(".dropdown-select__trigger")?.setAttribute("aria-expanded", "false");
    });
  }

  document.addEventListener("click", function (event) {
    const target = event.target;

    if (!(target instanceof Element)) {
      closeAll();
      return;
    }

    const trigger = target.closest(".logic-playground [data-dropdown-select] .dropdown-select__trigger");

    if (trigger) {
      const dropdown = trigger.closest("[data-dropdown-select]");
      const willOpen = !dropdown.classList.contains("is-open");

      closeAll(dropdown);
      dropdown.classList.toggle("is-open", willOpen);
      trigger.setAttribute("aria-expanded", willOpen ? "true" : "false");
      return;
    }

    const option = target.closest(".logic-playground [data-dropdown-select] .dropdown-select__option");

    if (option) {
      const dropdown = option.closest("[data-dropdown-select]");
      const value = option.textContent?.trim() || "";
      const label = dropdown?.querySelector(".dropdown-select__value");

      dropdown?.querySelectorAll(".dropdown-select__option").forEach(function (item) {
        item.classList.toggle("is-selected", item === option);
        item.setAttribute("aria-selected", item === option ? "true" : "false");
      });

      if (label) {
        label.textContent = value;
      }

      closeAll();
      return;
    }

    const toggle = target.closest(".logic-playground [data-track-toggle]");

    if (toggle) {
      const isPressed = toggle.getAttribute("aria-pressed") === "true";
      toggle.setAttribute("aria-pressed", isPressed ? "false" : "true");
      toggle.classList.toggle("is-active", !isPressed);
      return;
    }

    if (!target.closest(".logic-playground [data-dropdown-select]")) {
      closeAll();
    }
  });

  document.addEventListener("input", function (event) {
    const target = event.target;

    if (!(target instanceof HTMLInputElement)) {
      return;
    }

    if (target.classList.contains("logic-playground-strip-slider__input")) {
      const slider = target.closest("[data-playground-slider]");

      if (slider) {
        slider.style.setProperty("--logic-slider-value", String((Number(target.value) || 0) / 100));
      }
      return;
    }

    if (target.classList.contains("logic-playground-strip-knob__input")) {
      const knob = target.closest("[data-playground-knob]");

      if (knob) {
        knob.style.setProperty("--logic-knob-value", String((Number(target.value) || 0) / 100));
      }
    }
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      closeAll();
    }
  });

  initSharedEditorLayout();
  initHeroIcons();
  initPaletteControls();
})();
