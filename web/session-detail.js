(function () {
  const ui = window.RecorderUI;
  const data = window.RECORDER_MOCK;

  if (!ui || !data) {
    return;
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function formatShortTime(totalSeconds) {
    const formatted = ui.formatDuration(Math.max(0, Math.floor(totalSeconds || 0)));
    const parts = formatted.split(":");

    if (parts[0] === "00") {
      return parts[1] + ":" + parts[2];
    }

    return parts[0] + ":" + parts[1];
  }

  function buildTimeline(detail) {
    const sourceTracks = Array.isArray(detail.tracks) ? detail.tracks : [];
    const tracks = sourceTracks.length ? sourceTracks : [
      {
        usbChannel: 1,
        label: "Audio 01",
        status: "prepared",
        peakDb: -60,
        segments: []
      }
    ];
    const maxSegments = tracks.reduce(function (max, track) {
      const count = Array.isArray(track.segments) ? track.segments.length : 0;

      return Math.max(max, count);
    }, 0);
    const columns = Math.max(12, maxSegments > 0 ? maxSegments * 6 : 12);
    const majorSteps = Math.max(1, Math.floor(columns / 2));
    const stepSeconds = detail.summary.durationSeconds > 0
      ? Math.max(30, Math.ceil(detail.summary.durationSeconds / majorSteps))
      : 60;
    const marks = [];

    for (let index = 0; index < columns; index += 2) {
      marks.push(formatShortTime(stepSeconds * (index / 2)));
    }

    const laneTracks = tracks.map(function (track, index) {
      const segments = Array.isArray(track.segments) ? track.segments : [];
      const slotSize = segments.length > 0 ? Math.max(3, Math.floor(columns / segments.length)) : columns;
      const regions = segments.map(function (segment, segmentIndex) {
        const start = segmentIndex * slotSize;
        const isLast = segmentIndex === segments.length - 1;
        const length = isLast
          ? Math.max(2, columns - start)
          : Math.max(2, slotSize - 1);

        return {
          start: start + 1,
          length: Math.min(length, columns),
          label: track.label,
          take: segment.file || "",
          size: segment.size || ""
        };
      });

      const lastRegion = regions[regions.length - 1];
      const playheadColumn = lastRegion
        ? Math.min(columns, lastRegion.start + lastRegion.length - 1)
        : 1;

      return {
        kind: "audio",
        usbChannel: track.usbChannel,
        label: track.label,
        color: index % 3 === 0 ? "indigo" : (index % 3 === 1 ? "blue" : "cyan"),
        regions: regions,
        playheadColumn: playheadColumn
      };
    });

    const aggregatePlayhead = laneTracks.reduce(function (max, track) {
      return Math.max(max, track.playheadColumn);
    }, 1);

    return {
      columns: columns,
      marks: marks,
      playheadColumn: aggregatePlayhead,
      tracks: laneTracks
    };
  }

  function renderWindowBar(detail) {
    const slot = document.getElementById("logic-windowbar");
    const summary = detail.summary;
    const canStart = summary.status !== "recording";
    const canStop = summary.status === "recording";

    slot.innerHTML = [
      '<div class="logic-windowbar__side">',
      "</div>",
      '<div class="logic-transport logic-transport--session">',
      '  <div class="logic-transport__buttons">',
      '    <button class="logic-transport-btn logic-transport-btn--record" type="button"' + (canStart ? "" : " disabled") + '><span class="logic-shape logic-shape--record"></span></button>',
      '    <button class="logic-transport-btn" type="button"' + (canStop ? "" : " disabled") + '><span class="logic-shape logic-shape--stop"></span></button>',
      "  </div>",
      "</div>",
      '<div class="logic-windowbar__side logic-windowbar__side--right">',
      "</div>"
    ].join("");
  }

  function renderArrangeCorner(detail) {
    document.getElementById("logic-arrange-corner").innerHTML = "";
  }

  function renderRuler(timeline) {
    const slot = document.getElementById("logic-ruler");
    const cells = [];

    slot.style.setProperty("--logic-columns", String(timeline.columns));
    slot.style.setProperty("--logic-playhead", String(timeline.playheadColumn));

    for (let index = 0; index < timeline.columns; index += 1) {
      const majorIndex = Math.floor(index / 2);
      const label = index % 2 === 0 && majorIndex < timeline.marks.length ? timeline.marks[majorIndex] : "";

      cells.push(
        [
          '<div class="logic-ruler__cell">',
          label ? '  <span class="logic-ruler__label mono">' + escapeHtml(label) + "</span>" : "",
          "</div>"
        ].join("")
      );
    }

    slot.innerHTML = '<div class="logic-ruler__grid">' + cells.join("") + "</div>";
  }

  function buildInputOptions(currentValue, totalInputs) {
    const options = [];

    for (let index = 1; index <= totalInputs; index += 1) {
      const value = String(index).padStart(2, "0");

      options.push(
        [
          '<button class="dropdown-select__option' + (value === currentValue ? " is-selected" : "") + '" type="button" data-value="' + value + '">',
          "  <span>" + value + "</span>",
          "</button>"
        ].join("")
      );
    }

    return options.join("");
  }

  function renderTrackHeaders(timeline) {
    const slot = document.getElementById("logic-track-headers");
    const totalInputs = Math.max(32, timeline.tracks.reduce(function (max, track) {
      return Math.max(max, Number(track.usbChannel) || 0);
    }, 0));

    if (!timeline.tracks.length) {
      slot.innerHTML = "";
      return;
    }

    slot.innerHTML = timeline.tracks.map(function (track) {
      const inputValue = String(track.usbChannel).padStart(2, "0");

      return [
        '<article class="logic-track-header logic-track-header--session">',
        '  <div class="logic-track-select dropdown-select" data-dropdown-select data-track-input-select>',
        '    <input type="hidden" data-track-input-value value="' + escapeHtml(inputValue) + '">',
        '    <button class="dropdown-select__trigger logic-track-select__trigger" type="button" aria-expanded="false">',
        '      <span class="dropdown-select__value">' + escapeHtml(inputValue) + "</span>",
        '      <span class="dropdown-select__chevron" aria-hidden="true"></span>',
        "    </button>",
        '    <div class="dropdown-select__menu logic-track-select__menu" role="listbox">',
        buildInputOptions(inputValue, totalInputs),
        "    </div>",
        "  </div>",
        '  <div class="logic-track-name" data-track-name-editor>',
        '    <button class="logic-track-name__display" type="button" data-track-name-display data-value="' + escapeHtml(track.label) + '">' + escapeHtml(track.label) + "</button>",
        '    <input class="logic-track-name__input" type="text" value="' + escapeHtml(track.label) + '" data-track-name-input hidden>',
        "  </div>",
        "</article>"
      ].join("");
    }).join("");
  }

  function buildRegion(track, region) {
    return [
      '<article class="logic-region logic-region--display logic-region--' + escapeHtml(track.color) + '" style="grid-column:' + String(region.start) + ' / span ' + String(region.length) + ';">',
      '  <div class="logic-region__wave" aria-hidden="true"></div>',
      "</article>"
    ].join("");
  }

  function renderTrackLanes(timeline) {
    const slot = document.getElementById("logic-track-lanes");

    slot.style.setProperty("--logic-columns", String(timeline.columns));
    slot.style.setProperty("--logic-playhead", String(timeline.playheadColumn));

    slot.classList.remove("is-empty");
    slot.innerHTML = timeline.tracks.map(function (track) {
      const regions = track.regions.length
        ? track.regions.map(function (region) {
          return buildRegion(track, region);
        }).join("")
        : '<div class="logic-audio-display logic-audio-display--empty" style="grid-column:1 / -1;"><div class="logic-audio-display__wave" aria-hidden="true"></div></div>';

      return [
        '<div class="logic-track-lane logic-track-lane--session">',
        '  <div class="logic-track-lane__grid">',
        regions,
        "  </div>",
        "</div>"
      ].join("");
    }).join("");
  }

  function bindTrackEditors() {
    const slot = document.getElementById("logic-track-headers");

    if (!slot) {
      return;
    }

    ui.bindDropdowns(slot);

    slot.querySelectorAll("[data-track-name-editor]").forEach(function (container) {
      const display = container.querySelector("[data-track-name-display]");
      const input = container.querySelector("[data-track-name-input]");

      if (!display || !input) {
        return;
      }

      function commit(cancelEdit) {
        const nextValue = cancelEdit
          ? (display.dataset.value || display.textContent || "").trim()
          : (input.value || "").trim() || "Untitled";

        display.dataset.value = nextValue;
        display.textContent = nextValue;
        input.value = nextValue;
        input.hidden = true;
        display.hidden = false;
        container.classList.remove("is-editing");
      }

      display.addEventListener("click", function () {
        container.classList.add("is-editing");
        display.hidden = true;
        input.hidden = false;
        input.focus();
        input.select();
      });

      input.addEventListener("keydown", function (event) {
        if (event.key === "Enter") {
          commit(false);
          event.preventDefault();
          return;
        }

        if (event.key === "Escape") {
          commit(true);
          event.preventDefault();
        }
      });

      input.addEventListener("blur", function () {
        commit(false);
      });
    });

    slot.addEventListener("click", function (event) {
      const option = event.target.closest(".dropdown-select__option");

      if (!option) {
        return;
      }

      const dropdown = option.closest("[data-track-input-select]");
      const hiddenInput = dropdown?.querySelector("[data-track-input-value]");

      if (hiddenInput) {
        hiddenInput.value = option.dataset.value || option.textContent.trim();
      }
    });
  }

  function bindTrackResizer() {
    const root = document.querySelector(".logic-screen--session");
    const handles = Array.from(document.querySelectorAll("[data-track-resizer]"));
    const storageKey = "recorder.session.sidebarWidth";
    const minWidth = 180;
    const maxWidth = 520;
    let dragState = null;

    if (!root || !handles.length) {
      return;
    }

    function readWidth() {
      const cssWidth = Number.parseFloat(getComputedStyle(root).getPropertyValue("--logic-sidebar-width"));

      if (Number.isFinite(cssWidth)) {
        return cssWidth;
      }

      const measuredWidth = document.getElementById("logic-track-headers")?.getBoundingClientRect().width;

      return Number.isFinite(measuredWidth) ? measuredWidth : 320;
    }

    function updateAria(width) {
      handles.forEach(function (handle) {
        if (handle.getAttribute("role") === "separator") {
          handle.setAttribute("aria-valuenow", String(Math.round(width)));
        }
      });
    }

    function setWidth(width) {
      const nextWidth = Math.max(minWidth, Math.min(maxWidth, width));

      root.style.setProperty("--logic-sidebar-width", String(nextWidth) + "px");
      updateAria(nextWidth);

      try {
        window.localStorage.setItem(storageKey, String(Math.round(nextWidth)));
      } catch (error) {
        void error;
      }

      return nextWidth;
    }

    function stopDrag(event) {
      if (!dragState) {
        return;
      }

      if (dragState.handle?.hasPointerCapture?.(dragState.pointerId)) {
        dragState.handle.releasePointerCapture(dragState.pointerId);
      }

      dragState = null;
      root.classList.remove("is-resizing");
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stopDrag);
      window.removeEventListener("pointercancel", stopDrag);

      if (event) {
        event.preventDefault();
      }
    }

    function onPointerMove(event) {
      if (!dragState) {
        return;
      }

      setWidth(dragState.startWidth + (event.clientX - dragState.startX));
    }

    const savedWidth = Number.parseInt(window.localStorage.getItem(storageKey) || "", 10);

    if (Number.isFinite(savedWidth)) {
      setWidth(savedWidth);
    } else {
      updateAria(readWidth());
    }

    handles.forEach(function (handle) {
      handle.addEventListener("pointerdown", function (event) {
        if (event.button !== 0) {
          return;
        }

        dragState = {
          handle: handle,
          pointerId: event.pointerId,
          startX: event.clientX,
          startWidth: readWidth()
        };

        root.classList.add("is-resizing");
        handle.setPointerCapture?.(event.pointerId);
        window.addEventListener("pointermove", onPointerMove);
        window.addEventListener("pointerup", stopDrag);
        window.addEventListener("pointercancel", stopDrag);
        event.preventDefault();
      });

      handle.addEventListener("keydown", function (event) {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
          return;
        }

        const step = event.shiftKey ? 24 : 12;
        const direction = event.key === "ArrowLeft" ? -1 : 1;

        setWidth(readWidth() + (step * direction));
        event.preventDefault();
      });
    });
  }

  function renderNotFound(id) {
    document.title = "Session Not Found";
    document.getElementById("logic-windowbar").innerHTML = [
      '<div class="logic-windowbar__side">',
      "</div>",
      '<div class="logic-transport logic-transport--session">',
      '  <div class="logic-transport__buttons">',
      '    <button class="logic-transport-btn logic-transport-btn--record" type="button" disabled><span class="logic-shape logic-shape--record"></span></button>',
      '    <button class="logic-transport-btn" type="button" disabled><span class="logic-shape logic-shape--stop"></span></button>',
      "  </div>",
      "</div>",
      '<div class="logic-windowbar__side logic-windowbar__side--right"></div>'
    ].join("");
    document.getElementById("logic-arrange-corner").innerHTML = "";
    document.getElementById("logic-ruler").innerHTML = "";
    document.getElementById("logic-track-headers").innerHTML = "";
    document.getElementById("logic-track-lanes").classList.add("is-empty");
    document.getElementById("logic-track-lanes").innerHTML = [
      '<div class="track-view__empty logic-track-empty">',
      "  <strong>Session data is unavailable.</strong>",
      '  <p class="muted">Open a valid session from the landing page.</p>',
      "</div>"
    ].join("");
  }

  const sessionId = data.resolveSessionIdFromLocation(window.location);
  const detail = sessionId ? data.getSessionById(sessionId) : null;

  if (!detail) {
    renderNotFound(sessionId);
    bindTrackResizer();
    return;
  }

  const timeline = buildTimeline(detail);

  document.title = detail.summary.title + " · Session";
  renderWindowBar(detail);
  renderArrangeCorner(detail);
  renderRuler(timeline);
  renderTrackHeaders(timeline);
  bindTrackEditors();
  renderTrackLanes(timeline);
  bindTrackResizer();
})();
