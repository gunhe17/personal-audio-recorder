(function () {
  const ui = window.RecorderUI;
  const data = window.RECORDER_MOCK;

  if (!ui || !data) {
    return;
  }

  function statusMeta(status) {
    switch (status) {
      case "recording":
        return { tone: "is-red", label: "Recording" };
      case "completed":
        return { tone: "is-green", label: "Completed" };
      case "failed":
        return { tone: "is-red", label: "Failed" };
      case "hot":
        return { tone: "is-amber", label: "Hot" };
      case "live":
        return { tone: "is-red", label: "Live" };
      case "disabled":
        return { tone: "is-amber", label: "Disabled" };
      case "prepared":
      default:
        return { tone: "is-cyan", label: "Prepared" };
    }
  }

  function renderDropdown(slotId, selectedValue, options) {
    const slot = document.getElementById(slotId);

    if (!slot) {
      return;
    }

    slot.innerHTML = [
      '<div class="dropdown-select" data-dropdown-select>',
      '  <button class="dropdown-select__trigger" type="button" aria-expanded="false">',
      '    <span class="dropdown-select__value">' + selectedValue + "</span>",
      '    <span class="dropdown-select__chevron" aria-hidden="true"></span>',
      "  </button>",
      '  <div class="dropdown-select__menu" role="listbox">',
      options
        .map(function (option, index) {
          const selectedClass = index === 0 ? " is-selected" : "";

          return [
            '    <button class="dropdown-select__option' + selectedClass + '" type="button" data-value="' + option.value + '">',
            "      <strong>" + option.label + "</strong>",
            "      <small>" + option.description + "</small>",
            "    </button>"
          ].join("");
        })
        .join(""),
      "  </div>",
      "</div>"
    ].join("");
  }

  function renderLiveStateStrip(session) {
    const slot = document.getElementById("live-state-strip");

    if (!slot) {
      return;
    }

    const state = statusMeta(session.status);

    slot.innerHTML = [
      '<div class="state-strip">',
      '  <div class="state-strip__row">',
      '    <div class="cluster">',
      '      <span class="status-pill ' + state.tone + '"><span class="signal-dot"></span>' + state.label + "</span>",
      '      <span class="status-pill is-cyan"><span class="signal-dot"></span>' + session.profileName.toUpperCase() + "</span>",
      '      <span class="status-pill is-green"><span class="signal-dot"></span>Disk ' + session.freeDisk + "</span>",
      "    </div>",
      '    <strong class="mono" data-session-duration="' + session.durationSeconds + '">' + ui.formatDuration(session.durationSeconds) + "</strong>",
      "  </div>",
      '  <div class="state-strip__data">',
      '    <div class="meta-box"><label>Device</label><strong>' + session.deviceName + "</strong></div>",
      '    <div class="meta-box"><label>Profile</label><strong>' + session.profileName + "</strong></div>",
      '    <div class="meta-box"><label>Target</label><strong>' + session.storageTarget + "</strong></div>",
      '    <div class="meta-box"><label>Armed Tracks</label><strong>' + String(session.armedTracks) + "</strong></div>",
      "  </div>",
      "</div>"
    ].join("");
  }

  function renderMeterBank(tracks) {
    const slot = document.getElementById("meter-bank-slot");

    if (!slot) {
      return;
    }

    slot.innerHTML = [
      '<div class="meter-bank">',
      tracks
        .slice(0, 8)
        .map(function (track) {
          return [
            '<article class="meter-tile">',
            '  <div class="meter-tile__top">',
            '    <div class="meter-tile__label"><strong>USB ' + String(track.usbChannel).padStart(2, "0") + "</strong><span>" + track.label + "</span></div>",
            '    <span class="mono" data-live-meter-text>' + track.peakDb.toFixed(1) + "</span>",
            "  </div>",
            '  <div class="meter-track">',
            '    <div class="meter-hold" data-live-meter-hold style="top: ' + String(100 - Math.min(92, track.meterPercent + 10)) + '%"></div>',
            '    <div class="meter-bar" data-live-meter style="height: ' + String(track.meterPercent) + '%"></div>',
            "  </div>",
            '  <div class="meter-scale"><span>-48</span><span>-12</span><span>0</span></div>',
            "</article>"
          ].join("");
        })
        .join(""),
      "</div>"
    ].join("");
  }

  function renderTrackList(tracks) {
    const slot = document.getElementById("track-list");

    if (!slot) {
      return;
    }

    slot.innerHTML = tracks
      .map(function (track) {
        const status = statusMeta(track.status);

        return [
          '<div class="track-row">',
          '  <div class="track-row__channel">USB ' + String(track.usbChannel).padStart(2, "0") + "</div>",
          '  <input class="field__control" type="text" value="' + track.label + '" />',
          '  <label class="toggle"><input ' + (track.armed ? "checked " : "") + 'type="checkbox" />Armed</label>',
          '  <div class="mono">' + (track.armed ? track.peakDb.toFixed(1) + " dB" : "Muted") + "</div>",
          '  <div class="mini-meter"><div class="mini-meter__fill" style="width: ' + String(track.meterPercent) + '%"></div></div>',
          '  <span class="status-pill ' + status.tone + '"><span class="signal-dot"></span>' + status.label + "</span>",
          "</div>"
        ].join("");
      })
      .join("");
  }

  function renderStats(session) {
    const slot = document.getElementById("stat-grid");

    if (!slot) {
      return;
    }

    slot.innerHTML = [
      { label: "Free Disk", value: session.freeDisk },
      { label: "Armed Tracks", value: String(session.armedTracks) },
      { label: "Sample Rate", value: Math.round(session.sampleRate / 1000) + "k" },
      { label: "Drop Count", value: String(session.dropCount) }
    ]
      .map(function (stat) {
        return [
          '<div class="stat-card">',
          "  <label>" + stat.label + "</label>",
          "  <strong>" + stat.value + "</strong>",
          "</div>"
        ].join("");
      })
      .join("");
  }

  function renderOwnerLibrary(ownerView, sessions) {
    const panel = document.getElementById("owner-panel");
    const library = document.getElementById("owner-library");
    const ownerPill = document.getElementById("owner-view-pill");

    if (!panel || !library) {
      return;
    }

    if (!ownerView) {
      panel.hidden = true;

      if (ownerPill) {
        ownerPill.className = "status-pill is-amber";
        ownerPill.innerHTML = '<span class="signal-dot"></span>Owner View Disabled';
      }

      return;
    }

    panel.hidden = false;
    library.hidden = false;

    if (ownerPill) {
      ownerPill.className = "status-pill is-green";
      ownerPill.innerHTML = '<span class="signal-dot"></span>Owner View Enabled';
    }

    library.innerHTML = sessions
      .filter(function (session) {
        return session.status !== "recording";
      })
      .map(function (session) {
        const status = statusMeta(session.status);
        const exportPill = session.storageTarget === "client_download"
          ? '<span class="status-pill is-amber"><span class="signal-dot"></span>' + session.exportStatus + "</span>"
          : '<span class="status-pill is-green"><span class="signal-dot"></span>retained</span>';

        return [
          '<article class="session-card">',
          '  <div class="card-head">',
          '    <div class="session-card__meta"><strong>' + session.title + '</strong><span class="mono">' + session.id + "</span></div>",
          '    <span class="status-pill ' + status.tone + '"><span class="signal-dot"></span>' + status.label + "</span>",
          "  </div>",
          '  <div class="session-card__list">',
          '    <div class="meta-row"><span>Storage target</span><strong class="mono">' + session.storageTarget + "</strong></div>",
          '    <div class="meta-row"><span>Tracks</span><strong class="mono">' + String(session.trackCount) + "</strong></div>",
          '    <div class="meta-row"><span>Export</span><strong class="mono">' + session.exportStatus + "</strong></div>",
          "  </div>",
          '  <div class="session-actions">',
          '    <a class="button button--secondary" href="' + data.buildSessionHref(session.id) + '">Open Detail</a>',
          exportPill,
          "  </div>",
          "</article>"
        ].join("");
      })
      .join("");
  }

  function bindDurationTick() {
    const durationNodes = document.querySelectorAll("[data-session-duration]");
    let seconds = data.currentSession.durationSeconds;

    window.setInterval(function () {
      seconds += 1;

      durationNodes.forEach(function (node) {
        node.textContent = ui.formatDuration(seconds);
      });
    }, 1000);
  }

  function bindLiveMeters() {
    const tiles = Array.from(document.querySelectorAll("[data-live-meter]"));

    if (!tiles.length) {
      return;
    }

    window.setInterval(function () {
      tiles.forEach(function (bar) {
        const hold = bar.parentElement.querySelector("[data-live-meter-hold]");
        const text = bar.parentElement.parentElement.querySelector("[data-live-meter-text]");
        const current = Number(bar.style.height.replace("%", "")) || 42;
        let next = current + (Math.random() - 0.44) * 16;

        next = Math.max(18, Math.min(94, next));
        bar.style.height = next.toFixed(1) + "%";

        if (hold) {
          const holdTop = Math.max(6, 100 - Math.min(96, next + 8));
          hold.style.top = holdTop.toFixed(1) + "%";
        }

        if (text) {
          const db = -1 * ((100 - next) / 100 * 42);
          text.textContent = db.toFixed(1);
        }
      });
    }, 260);
  }

  document.getElementById("session-title-input").value = data.currentSession.title;

  renderDropdown("device-dropdown-slot", data.currentSession.deviceName, [
    { value: "X-USB ASIO Driver", label: "X-USB ASIO Driver", description: "32 inputs, ASIO backend, preferred for X32." },
    { value: "TF Rack USB", label: "TF Rack USB", description: "34 input path for TF-family routing." },
    { value: "MacBook Microphone", label: "MacBook Microphone", description: "2 input fallback device, not suitable for production multitrack." }
  ]);

  renderDropdown("profile-dropdown-slot", data.currentSession.profileName, [
    { value: "x32-32", label: "x32-32", description: "Expected 32 inputs, 48kHz preferred, X32 routing profile." },
    { value: "tf-34", label: "tf-34", description: "Expected 34 inputs, TF-family USB mapping profile." }
  ]);

  renderLiveStateStrip(data.currentSession);
  renderMeterBank(data.currentTracks);
  renderTrackList(data.currentTracks);
  renderStats(data.currentSession);
  renderOwnerLibrary(data.ownerView, data.sessions);

  ui.bindDropdowns();
  ui.bindSegmentedGroups();
  bindDurationTick();
  bindLiveMeters();
})();
