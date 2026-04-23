let baiduScriptLoading = null;
let activeInfoOverlay = null;
const districtBoundaryCache = new Map();
let boundaryRenderSeq = 0;

function closeActiveInfoOverlay({ fireOnClose = true } = {}) {
  if (!activeInfoOverlay) return;
  const { map, overlay, onClose, item, restoreMapInteractions } = activeInfoOverlay;
  activeInfoOverlay = null;
  if (typeof restoreMapInteractions === "function") {
    try {
      restoreMapInteractions();
    } catch (_) {
      // Ignore interaction restore failures from stale map runtimes.
    }
  }
  try {
    map.removeOverlay(overlay);
  } catch (_) {
    // Ignore stale overlay removal.
  }
  if (fireOnClose && typeof onClose === "function") onClose(item);
}

export function closeInfoWindow({ fireOnClose = true } = {}) {
  closeActiveInfoOverlay({ fireOnClose });
}

function formatNurseryName(name) {
  return String(name ?? "--").replace(/^北京市朝阳区/, "").trim();
}

function formatNurseryFullName(name) {
  return String(name ?? "--").trim();
}

function distanceKm(lng1, lat1, lng2, lat2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function formatDistanceText(km) {
  if (!Number.isFinite(km)) return "--";
  if (km < 1) return `${Math.round(km * 1000)} 米`;
  return `${km.toFixed(2)} 公里`;
}

function measureTextWidth(text, font = '11px "PingFang SC", "Microsoft YaHei", sans-serif') {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return Math.max(80, String(text).length * 11);
  ctx.font = font;
  return Math.ceil(ctx.measureText(text).width);
}

function getMarkerAnchor(icon) {
  if (!icon) return { x: 10, y: 25 };

  const anchor =
    (typeof icon.getAnchor === "function" && icon.getAnchor()) ||
    icon.anchor ||
    null;
  if (anchor && typeof anchor.width === "number" && typeof anchor.height === "number") {
    return { x: anchor.width, y: anchor.height };
  }

  const size =
    (typeof icon.getSize === "function" && icon.getSize()) ||
    icon.size ||
    null;
  if (size && typeof size.width === "number" && typeof size.height === "number") {
    return { x: Math.round(size.width / 2), y: size.height };
  }

  return { x: 10, y: 25 };
}

function loadScriptWithCallback(ak, { timeoutMs = 10000, webgl = false } = {}) {
  return new Promise((resolve, reject) => {
    const callbackName = `onBMapLoaded_${Date.now()}`;
    let settled = false;

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };

    window[callbackName] = () => {
      delete window[callbackName];
      if (webgl && window.BMapGL) return finish(resolve, window.BMapGL);
      if (window.BMap) return finish(resolve, window.BMap);
      finish(reject, new Error("Baidu map callback fired but runtime missing"));
    };

    const script = document.createElement("script");
    const version = webgl ? "1.0" : "3.0";
    const typeParam = webgl ? "&type=webgl" : "";
    script.src = `https://api.map.baidu.com/api?v=${version}${typeParam}&ak=${encodeURIComponent(
      ak
    )}&callback=${callbackName}`;
    script.async = true;
    script.onerror = () => {
      delete window[callbackName];
      finish(reject, new Error("Baidu map script load failed"));
    };
    document.head.appendChild(script);

    const timer = window.setTimeout(() => {
      delete window[callbackName];
      finish(reject, new Error("Baidu map load timeout"));
    }, timeoutMs);
  });
}

export async function loadBaiduMap(ak) {
  if (window.BMapGL) return window.BMapGL;
  if (window.BMap) return window.BMap;

  if (!ak || ak.includes("__REPLACE")) {
    throw new Error("Missing Baidu map AK");
  }

  if (!baiduScriptLoading) {
    baiduScriptLoading = loadScriptWithCallback(ak, { webgl: true })
      .catch(() => loadScriptWithCallback(ak, { webgl: false }))
      .catch((error) => {
        baiduScriptLoading = null;
        throw error;
      });
  }

  return baiduScriptLoading;
}

export function createMap(BMap, containerId) {
  // Match official page zoom range to reduce large-step zoom jumps.
  const map = new BMap.Map(containerId, { maxZoom: 17 });
  const center = new BMap.Point(116.404, 39.915);
  map.centerAndZoom(center, 12);
  map.enableScrollWheelZoom(true);
  // Prefer smooth wheel zoom when current runtime supports it.
  if (typeof map.enableContinuousZoom === "function") {
    map.enableContinuousZoom();
  }
  if (typeof map.enablePinchToZoom === "function") {
    map.enablePinchToZoom();
  }
  if (typeof map.enableInertialDragging === "function") {
    map.enableInertialDragging();
  }
  const anchor = BMap.ANCHOR_BOTTOM_RIGHT ?? window.BMAP_ANCHOR_BOTTOM_RIGHT;
  const controlType = BMap.NAVIGATION_CONTROL_SMALL ?? window.BMAP_NAVIGATION_CONTROL_SMALL;
  map.addControl(
    new BMap.NavigationControl({
      anchor,
      type: controlType,
      enableGeolocation: false,
    })
  );
  return map;
}

export function renderMarkers({
  BMap,
  map,
  items,
  district = "朝阳区",
  showDistrictBoundary = true,
  selectedUid,
  onMarkerClick,
  homeLocation,
  onlyNearHome = false,
  homeRadiusKm = 3,
  onlyShowStarredNames = false,
}) {
  map.clearOverlays();
  activeInfoOverlay = null;
  const currentBoundarySeq = ++boundaryRenderSeq;

  const addBoundaryOverlays = (boundaryPaths) => {
    if (!Array.isArray(boundaryPaths) || boundaryRenderSeq !== currentBoundarySeq) return;
    boundaryPaths.forEach((path) => {
      const points = String(path)
        .split(";")
        .map((pair) => pair.trim())
        .filter(Boolean)
        .map((pair) => {
          const [lng, lat] = pair.split(",");
          const nLng = Number(lng);
          const nLat = Number(lat);
          return Number.isFinite(nLng) && Number.isFinite(nLat) ? new BMap.Point(nLng, nLat) : null;
        })
        .filter(Boolean);
      if (points.length < 3) return;
      const polygon = new BMap.Polygon(points, {
        strokeColor: "#6fa9ff",
        strokeWeight: 2,
        strokeOpacity: 0.85,
        fillColor: "#5d87ff",
        fillOpacity: 0.05,
      });
      map.addOverlay(polygon);
    });
  };

  const districtName = String(district || "").trim();
  if (showDistrictBoundary && districtName && typeof BMap.Boundary === "function") {
    const cached = districtBoundaryCache.get(districtName);
    if (cached) {
      addBoundaryOverlays(cached);
    } else {
      const boundary = new BMap.Boundary();
      boundary.get(districtName, (result) => {
        const boundaries = Array.isArray(result?.boundaries) ? result.boundaries : [];
        districtBoundaryCache.set(districtName, boundaries);
        addBoundaryOverlays(boundaries);
      });
    }
  }

  if (
    onlyNearHome &&
    homeLocation &&
    Number.isFinite(homeLocation.lng) &&
    Number.isFinite(homeLocation.lat)
  ) {
    const centerPoint = new BMap.Point(homeLocation.lng, homeLocation.lat);
    const radiusMeters = Math.max(0.1, Number(homeRadiusKm) || 3) * 1000;
    const circle = new BMap.Circle(centerPoint, radiusMeters, {
      strokeColor: "#ffb347",
      strokeWeight: 3,
      strokeOpacity: 0.95,
      fillColor: "#ff9d3a",
      fillOpacity: 0.2,
    });
    map.addOverlay(circle);
  }

  const points = items.filter((item) => item.hasGeo);
  points.forEach((item) => {
    const point = new BMap.Point(item.longitudeNum, item.latitudeNum);
    const marker = new BMap.Marker(point);
    if (typeof marker.setOpacity === "function") {
      marker.setOpacity(onlyShowStarredNames && !item.isStarred ? 0.35 : 1);
    }
    const shouldShowLabel = !onlyShowStarredNames || item.isStarred || item.uid === selectedUid;
    if (shouldShowLabel) {
      const labelText = `${item.isStarred ? "★ " : ""}${formatNurseryName(item.nurseryName)}`;
      const labelWidth = measureTextWidth(labelText) + 12;
      const anchor = getMarkerAnchor(marker.getIcon());
      const label = new BMap.Label(labelText, {
        // Place label right below marker hotspot.
        offset: new BMap.Size(-Math.round(labelWidth / 2), 2),
      });
      label.setStyle({
        border: "none",
        background: "rgba(11,18,32,0.78)",
        color: "#e7f0ff",
        padding: "2px 6px",
        borderRadius: "6px",
        fontSize: "11px",
        lineHeight: "1.4",
        width: `${labelWidth}px`,
        textAlign: "center",
        maxWidth: "none",
        whiteSpace: "nowrap",
        wordBreak: "normal",
        overflow: "visible",
        boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
      });
      marker.setLabel(label);
    }

    if (item.uid === selectedUid) {
      marker.setTop(true);
    }

    marker.addEventListener("click", () => onMarkerClick(item));
    map.addOverlay(marker);
  });

  if (homeLocation && Number.isFinite(homeLocation.lng) && Number.isFinite(homeLocation.lat)) {
    const homePoint = new BMap.Point(homeLocation.lng, homeLocation.lat);
    let homeMarker = null;
    try {
      const homeIconSvg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44">
          <circle cx="22" cy="22" r="18" fill="rgba(255,153,51,0.22)"/>
          <circle cx="22" cy="22" r="13" fill="#ff9d3a" stroke="#fff6da" stroke-width="2"/>
          <path d="M14 23 L22 16 L30 23 L30 31 L25 31 L25 26 L19 26 L19 31 L14 31 Z" fill="#fff7e5"/>
        </svg>
      `.trim();
      const homeIcon = new BMap.Icon(
        `data:image/svg+xml;charset=utf-8,${encodeURIComponent(homeIconSvg)}`,
        new BMap.Size(44, 44),
        { anchor: new BMap.Size(22, 22) }
      );
      homeMarker = new BMap.Marker(homePoint, { icon: homeIcon });
    } catch (_) {
      homeMarker = new BMap.Marker(homePoint);
    }
    if (!homeMarker) {
      homeMarker = new BMap.Marker(homePoint);
    }
    const homeLabel = new BMap.Label("我家", { offset: new BMap.Size(12, -10) });
    homeLabel.setStyle({
      border: "none",
      background: "rgba(255,157,58,0.92)",
      color: "#10203b",
      fontWeight: "700",
      borderRadius: "8px",
      padding: "2px 8px",
      fontSize: "12px",
      lineHeight: "1.4",
      boxShadow: "0 2px 8px rgba(0,0,0,0.22)",
    });
    homeMarker.setLabel(homeLabel);
    homeMarker.setTop(true);
    map.addOverlay(homeMarker);
  }
}

export function openInfoWindow({ BMap, map, item, onClose, homeLocation = null }) {
  if (!item?.hasGeo) return;

  closeActiveInfoOverlay({ fireOnClose: true });

  const point = new BMap.Point(item.longitudeNum, item.latitudeNum);
  const monthCost = item.monthCostBa ? `${item.monthCostBa}/月` : "--";
  const feeText = item.nurseryCost || "--";
  const characteristicText = item.nurseryCharacteristic ? String(item.nurseryCharacteristic).trim() : "--";
  const hasCharacteristic = characteristicText !== "--";
  const statusLabel = item.applyStatusLabel ?? "--";
  const statusColor =
    statusLabel.includes("有富余") ? "#22c55e" : statusLabel.includes("已招满") ? "#ef4444" : "#f59e0b";
  const hasHomeLocation =
    homeLocation &&
    Number.isFinite(homeLocation.lng) &&
    Number.isFinite(homeLocation.lat) &&
    Number.isFinite(item.longitudeNum) &&
    Number.isFinite(item.latitudeNum);
  const homeDistanceText = hasHomeLocation
    ? formatDistanceText(
      distanceKm(homeLocation.lng, homeLocation.lat, item.longitudeNum, item.latitudeNum)
    )
    : null;
  const starBtnId = `nursery-star-${String(item.uid ?? "").replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  const closeBtnId = `nursery-close-${String(item.uid ?? "").replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  const characteristicId = `nursery-characteristic-${String(item.uid ?? "").replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  const characteristicToggleId = `nursery-characteristic-toggle-${String(item.uid ?? "").replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  const html = `
    <div style="position: relative; transform: translate(-50%, calc(-100% - 28px));">
      <div class="nursery-info-panel" style="
        width: 332px;
        font-size: 12px;
        color: #dbe7ff;
        user-select: text;
        -webkit-user-select: text;
        position: relative;
        background: linear-gradient(155deg, rgba(11,18,32,0.98), rgba(22,35,64,0.96));
        border: 1px solid rgba(115,159,255,0.35);
        border-radius: 12px;
        padding: 12px;
        box-shadow: 0 10px 30px rgba(6, 10, 22, 0.45);
        line-height: 1.45;
      ">
        <button
          id="${closeBtnId}"
          title="关闭"
          style="
            position: absolute;
            top: 8px;
            right: 8px;
            border: none;
            background: transparent;
            color: #b7c7e7;
            width: 26px;
            height: 26px;
            font-size: 22px;
            line-height: 1;
            cursor: pointer;
          "
        >×</button>
        <button
          id="${starBtnId}"
          title="${item.isStarred ? "取消星标" : "设为星标"}"
          style="
            position: absolute;
            top: 10px;
            right: 42px;
            border: 1px solid ${item.isStarred ? "rgba(255,221,87,0.58)" : "rgba(142,166,209,0.38)"};
            background: ${item.isStarred ? "rgba(255,221,87,0.14)" : "rgba(255,255,255,0.04)"};
            color: ${item.isStarred ? "#ffd84d" : "#d6e2ff"};
            border-radius: 50%;
            width: 26px;
            height: 26px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            font-size: 17px;
            line-height: 1;
            cursor: pointer;
          "
        >
          ${item.isStarred ? "★" : "☆"}
        </button>
        <div style="font-size: 15px; font-weight: 700; color: #f4f8ff; margin-bottom: 8px; padding-right: 72px;">
          ${formatNurseryFullName(item.nurseryName)}
        </div>
        <div style="display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px;">
          <span style="padding: 2px 8px; border-radius: 999px; background: rgba(35, 76, 153, 0.55); color: #cfe3ff;">
            ${item.nurseryNatureLabel ?? "--"}
          </span>
          <span style="padding: 2px 8px; border-radius: 999px; background: rgba(49, 101, 195, 0.45); color: #dbe9ff;">
            ${item.nurseryLevelLabel ?? "--"}
          </span>
          <span style="padding: 2px 8px; border-radius: 999px; background: rgba(27, 89, 71, 0.48); color: #bcffe8;">
            ${item.inclusiveClassFlagLabel ?? "--"}
          </span>
          <span style="padding: 2px 8px; border-radius: 999px; background: rgba(255,255,255,0.09); color: ${statusColor};">
            ${statusLabel}
          </span>
        </div>
        <div style="display: grid; grid-template-columns: 72px 1fr; gap: 6px 8px;">
          <div style="color:#8ea6d1;">基础月费</div><div>${monthCost}</div>
          <div style="color:#8ea6d1;">费用说明</div><div>${feeText}</div>
          <div style="color:#8ea6d1;">富余学位</div><div>${item.oddsChildNum}</div>
          <div style="color:#8ea6d1;">所属社区</div><div>${item.communityName ?? "--"}</div>
          <div style="color:#8ea6d1;">联系电话</div><div>${item.enrollTelephone ?? "--"}</div>
          <div style="color:#8ea6d1;">详细地址</div><div>${item.detailedAddress ?? "--"}</div>
          <div style="color:#8ea6d1;">办园特色</div>
          <div>
            <div
              id="${characteristicId}"
              style="
                white-space: pre-wrap;
                overflow: hidden;
                display: -webkit-box;
                -webkit-box-orient: vertical;
                -webkit-line-clamp: 2;
              "
            >${characteristicText}</div>
            ${hasCharacteristic ? `<button
              id="${characteristicToggleId}"
              type="button"
              style="
                margin-top: 4px;
                border: none;
                background: transparent;
                color: #9ec8ff;
                cursor: pointer;
                padding: 0;
                font-size: 12px;
              "
            >更多</button>` : ""}
          </div>
          ${homeDistanceText ? `<div style="color:#8ea6d1;">距离我家</div><div>${homeDistanceText}</div>` : ""}
        </div>
      </div>
    </div>
  `;

  function NurseryInfoOverlay(pointValue, popupHtml) {
    this._point = pointValue;
    this._html = popupHtml;
    this._div = null;
  }

  NurseryInfoOverlay.prototype = new BMap.Overlay();
  NurseryInfoOverlay.prototype.initialize = function initialize(mapInstance) {
    const div = document.createElement("div");
    div.style.position = "absolute";
    div.style.zIndex = "999999";
    div.style.pointerEvents = "auto";
    div.innerHTML = this._html;
    mapInstance.getPanes().floatPane.appendChild(div);
    this._div = div;
    return div;
  };
  NurseryInfoOverlay.prototype.draw = function draw() {
    if (!this._div) return;
    const pixel = map.pointToOverlayPixel(this._point);
    this._div.style.left = `${pixel.x}px`;
    this._div.style.top = `${pixel.y}px`;
  };

  const overlay = new NurseryInfoOverlay(point, html);
  let mapInteractionSuspended = false;
  const mapInteractionPairs = [
    ["disableDragging", "enableDragging"],
    ["disableScrollWheelZoom", "enableScrollWheelZoom"],
    ["disableDoubleClickZoom", "enableDoubleClickZoom"],
    ["disableContinuousZoom", "enableContinuousZoom"],
    ["disablePinchToZoom", "enablePinchToZoom"],
    ["disableInertialDragging", "enableInertialDragging"],
  ];
  const suspendMapInteractions = () => {
    if (mapInteractionSuspended) return;
    mapInteractionSuspended = true;
    mapInteractionPairs.forEach(([disableName]) => {
      if (typeof map[disableName] === "function") {
        try {
          map[disableName]();
        } catch (_) {
          // Ignore unsupported map runtime methods.
        }
      }
    });
  };
  const restoreMapInteractions = () => {
    if (!mapInteractionSuspended) return;
    mapInteractionSuspended = false;
    mapInteractionPairs.forEach(([, enableName]) => {
      if (typeof map[enableName] === "function") {
        try {
          map[enableName]();
        } catch (_) {
          // Ignore unsupported map runtime methods.
        }
      }
    });
  };
  // Keep map interaction fully disabled while popup is open,
  // so text selection inside popup won't be interrupted by map gestures.
  suspendMapInteractions();
  map.addOverlay(overlay);
  activeInfoOverlay = { map, overlay, item, onClose, restoreMapInteractions };

  window.setTimeout(() => {
    const infoPanel = overlay?._div?.querySelector(".nursery-info-panel");
    if (infoPanel) {
      const stopMapEvents = (event) => {
        // Keep browser text selection/copy behavior, only block map interaction events.
        event.stopPropagation();
      };
      const stopMapWheel = (event) => {
        event.preventDefault();
        event.stopPropagation();
      };
      [
        "mousedown",
        "mousemove",
        "mouseup",
        "click",
        "dblclick",
        "contextmenu",
        "selectstart",
        "touchstart",
        "touchmove",
        "touchend",
        "touchcancel",
        "pointerdown",
        "pointermove",
        "pointerup",
        "pointercancel",
      ].forEach((name) => {
        infoPanel.addEventListener(name, stopMapEvents, { passive: true });
      });
      infoPanel.addEventListener("wheel", stopMapWheel, { passive: false });
    }

    const closeBtn = document.getElementById(closeBtnId);
    if (closeBtn) {
      closeBtn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        restoreMapInteractions();
        closeActiveInfoOverlay({ fireOnClose: true });
      });
    }
    const starBtn = document.getElementById(starBtnId);
    if (starBtn && typeof item.onToggleStar === "function") {
      starBtn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        item.onToggleStar(item);
      });
    }
    const characteristicEl = document.getElementById(characteristicId);
    const toggleEl = document.getElementById(characteristicToggleId);
    if (characteristicEl && toggleEl) {
      let expanded = false;
      toggleEl.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        expanded = !expanded;
        if (expanded) {
          characteristicEl.style.display = "block";
          characteristicEl.style.webkitLineClamp = "unset";
          toggleEl.textContent = "收起";
        } else {
          characteristicEl.style.display = "-webkit-box";
          characteristicEl.style.webkitLineClamp = "2";
          toggleEl.textContent = "更多";
        }
      });
    }
  }, 0);
}

export function panToNursery({ BMap, map, item }) {
  if (!item?.hasGeo) return;
  const point = new BMap.Point(item.longitudeNum, item.latitudeNum);
  const targetZoom = 15;
  if (map.getZoom() < targetZoom) {
    if (typeof map.zoomTo === "function") {
      try {
        map.zoomTo(targetZoom, { noAnimation: false, zoomCenter: point });
      } catch (_) {
        map.zoomTo(targetZoom);
      }
    } else if (typeof map.centerAndZoom === "function") {
      try {
        map.centerAndZoom(point, targetZoom, { noAnimation: false });
      } catch (_) {
        map.centerAndZoom(point, targetZoom);
      }
    } else {
      map.setZoom(targetZoom);
    }
  }
  try {
    map.panTo(point, { noAnimation: false });
  } catch (_) {
    map.panTo(point);
  }
}

export function getMapBoundsFilter({ BMap, map, items }) {
  const bounds = map.getBounds();
  return items.filter((item) => {
    if (!item.hasGeo) return false;
    const point = new BMap.Point(item.longitudeNum, item.latitudeNum);
    return bounds.containsPoint(point);
  });
}

export function getDistanceToMapCenter({ BMap, map, item }) {
  if (!item.hasGeo) return Number.POSITIVE_INFINITY;
  const center = map.getCenter();
  const point = new BMap.Point(item.longitudeNum, item.latitudeNum);
  return map.getDistance(center, point);
}
