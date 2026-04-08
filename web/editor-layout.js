(function (global) {
  function escapeAttribute(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll('"', "&quot;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }

  function normalizeColumns(value) {
    const parsed = Number.parseInt(String(value || ""), 10);

    if (!Number.isFinite(parsed) || parsed < 1) {
      return 1;
    }

    return parsed;
  }

  function renderRulerGrid(columns) {
    const totalColumns = normalizeColumns(columns);
    const cells = Array.from({ length: totalColumns }, function () {
      return '<div class="logic-ruler__cell"></div>';
    }).join("");

    return '<div class="logic-ruler__grid">' + cells + "</div>";
  }

  function renderEmptyLaneCanvas(className) {
    const classes = String(className || "logic-playground-empty-canvas").trim();

    return '<div class="' + escapeAttribute(classes) + '" style="grid-column:1 / -1;"></div>';
  }

  global.logicEditorLayout = {
    renderRulerGrid,
    renderEmptyLaneCanvas
  };
}(window));
