(function () {
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
})();
