(function () {
  function bindSegmentedGroups(scope) {
    const root = scope || document;
    const groups = root.querySelectorAll("[data-segmented-group]");

    groups.forEach(function (group) {
      const items = group.querySelectorAll(".segmented__item");

      items.forEach(function (item) {
        item.addEventListener("click", function () {
          items.forEach(function (candidate) {
            candidate.classList.remove("is-selected");

            const input = candidate.querySelector("input");

            if (input) {
              input.checked = false;
            }
          });

          item.classList.add("is-selected");

          const input = item.querySelector("input");

          if (input) {
            input.checked = true;
          }
        });
      });
    });
  }

  function bindDropdowns(scope) {
    const root = scope || document;
    const dropdowns = Array.from(root.querySelectorAll("[data-dropdown-select]"));

    function closeAll(except) {
      dropdowns.forEach(function (dropdown) {
        if (dropdown === except) {
          return;
        }

        dropdown.classList.remove("is-open");

        const trigger = dropdown.querySelector(".dropdown-select__trigger");

        if (trigger) {
          trigger.setAttribute("aria-expanded", "false");
        }
      });
    }

    dropdowns.forEach(function (dropdown) {
      const trigger = dropdown.querySelector(".dropdown-select__trigger");
      const valueNode = dropdown.querySelector(".dropdown-select__value");
      const options = dropdown.querySelectorAll(".dropdown-select__option");

      if (!trigger || !valueNode || !options.length) {
        return;
      }

      trigger.addEventListener("click", function () {
        const willOpen = !dropdown.classList.contains("is-open");

        closeAll(dropdown);
        dropdown.classList.toggle("is-open", willOpen);
        trigger.setAttribute("aria-expanded", willOpen ? "true" : "false");
      });

      options.forEach(function (option) {
        option.addEventListener("click", function () {
          options.forEach(function (candidate) {
            candidate.classList.remove("is-selected");
          });

          option.classList.add("is-selected");
          valueNode.textContent = option.dataset.value || option.textContent.trim();
          dropdown.classList.remove("is-open");
          trigger.setAttribute("aria-expanded", "false");
        });
      });
    });

    document.addEventListener("click", function (event) {
      const target = event.target;

      if (!(target instanceof Element)) {
        closeAll();
        return;
      }

      if (!target.closest("[data-dropdown-select]")) {
        closeAll();
      }
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        closeAll();
      }
    });
  }

  function formatDuration(totalSeconds) {
    const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
    const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
    const seconds = String(totalSeconds % 60).padStart(2, "0");

    return hours + ":" + minutes + ":" + seconds;
  }

  window.RecorderUI = {
    bindDropdowns: bindDropdowns,
    bindSegmentedGroups: bindSegmentedGroups,
    formatDuration: formatDuration
  };
})();
