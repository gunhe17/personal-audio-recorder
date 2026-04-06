(function () {
  const ui = window.RecorderUI;

  if (!ui) {
    return;
  }

  function bindMeters() {
    const tiles = Array.from(document.querySelectorAll(".meter-tile"));

    if (!tiles.length) {
      return;
    }

    tiles.forEach(function (tile) {
      const meter = tile.querySelector("[data-meter]");
      const hold = tile.querySelector("[data-meter-hold]");
      const text = tile.querySelector("[data-meter-text]");

      tile.__meter = {
        meter: meter,
        hold: hold,
        text: text,
        peak: Math.random() * 42 + 30,
        holdValue: 24 + Math.random() * 30
      };
    });

    window.setInterval(function () {
      tiles.forEach(function (tile) {
        const state = tile.__meter;

        if (!state) {
          return;
        }

        const drift = (Math.random() - 0.44) * 18;
        let nextPeak = state.peak + drift;

        nextPeak = Math.max(12, Math.min(96, nextPeak));
        state.peak = nextPeak;

        if (nextPeak > state.holdValue) {
          state.holdValue = nextPeak;
        } else {
          state.holdValue = Math.max(nextPeak + 4, state.holdValue - 1.2);
        }

        if (state.meter) {
          state.meter.style.height = nextPeak.toFixed(1) + "%";
        }

        if (state.hold) {
          state.hold.style.top = (100 - state.holdValue).toFixed(1) + "%";
        }

        if (state.text) {
          const db = -1 * ((100 - nextPeak) / 100 * 42);
          state.text.textContent = db.toFixed(1);
        }
      });
    }, 240);
  }

  function bindDemoTimers() {
    const timers = document.querySelectorAll("[data-demo-time]");
    let elapsed = 13 * 60 + 24;

    timers.forEach(function (node) {
      node.textContent = ui.formatDuration(elapsed);
    });

    window.setInterval(function () {
      elapsed += 1;

      timers.forEach(function (node) {
        node.textContent = ui.formatDuration(elapsed);
      });
    }, 1000);
  }

  function bindToast() {
    const toast = document.querySelector(".toast-demo");

    if (!toast) {
      return;
    }

    window.setTimeout(function () {
      toast.style.transition = "opacity 320ms ease, transform 320ms ease";
      toast.style.opacity = "0";
      toast.style.transform = "translateY(12px)";
    }, 4200);
  }

  ui.bindDropdowns();
  ui.bindSegmentedGroups();
  bindMeters();
  bindDemoTimers();
  bindToast();
})();
