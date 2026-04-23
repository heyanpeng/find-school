import {
  BAIDU_MAP_AK,
  DATA_URL,
  DEFAULT_FILTERS,
  MONTH_COST_BUCKETS,
} from "./constants.js";
import {
  closeInfoWindow,
  createMap,
  getMapBoundsFilter,
  loadBaiduMap,
  openInfoWindow,
  panToNursery,
  renderMarkers,
} from "./map.js";

const dom = {
  filterPanel: document.getElementById("filterPanel"),
  panelCollapseBtn: document.getElementById("panelCollapseBtn"),
  exportTxtBtn: document.getElementById("exportTxtBtn"),
  copyTxtBtn: document.getElementById("copyTxtBtn"),
  districtSelect: document.getElementById("districtSelect"),
  keywordInput: document.getElementById("keywordInput"),
  onlyHasOddsInput: document.getElementById("onlyHasOddsInput"),
  onlyStarredInput: document.getElementById("onlyStarredInput"),
  starredCountText: document.getElementById("starredCountText"),
  clearStarredBtn: document.getElementById("clearStarredBtn"),
  onlyShowStarredNamesInput: document.getElementById("onlyShowStarredNamesInput"),
  onlyNearHomeInput: document.getElementById("onlyNearHomeInput"),
  homeRadiusSelect: document.getElementById("homeRadiusSelect"),
  homePointActionBtn: document.getElementById("homePointActionBtn"),
  mapBoundsOnlyInput: document.getElementById("mapBoundsOnlyInput"),
  showDistrictBoundaryInput: document.getElementById("showDistrictBoundaryInput"),
  resetBtn: document.getElementById("resetBtn"),
  resultCount: document.getElementById("resultCount"),
  homeLocationText: document.getElementById("homeLocationText"),
  streetFacet: document.getElementById("streetFacet"),
  applyStatusFacet: document.getElementById("applyStatusFacet"),
  inclusiveFacet: document.getElementById("inclusiveFacet"),
  levelFacet: document.getElementById("levelFacet"),
  natureFacet: document.getElementById("natureFacet"),
  monthCostFacet: document.getElementById("monthCostFacet"),
  superviseFacet: document.getElementById("superviseFacet"),
};

const state = {
  allItems: [],
  currentMapItems: [],
  currentExportItems: [],
  selectedUid: null,
  filters: structuredClone(DEFAULT_FILTERS),
  mapEnabled: false,
  BMap: null,
  map: null,
  hasInitialViewport: false,
  starredUids: new Set(),
  homeLocation: null,
  pickingHomePoint: false,
  suppressNextMapClick: false,
};

const STAR_STORAGE_KEY = "nursery-starred-uids-v1";
const HOME_LOCATION_STORAGE_KEY = "nursery-home-location-v1";
const QUICK_FILTERS_STORAGE_KEY = "nursery-quick-filters-v1";
const PANEL_COLLAPSE_STORAGE_KEY = "nursery-panel-collapsed-v1";
const HOME_RADIUS_MIN = 1;
const HOME_RADIUS_MAX = 20;
const BEIJING_DISTRICTS = [
  "东城区",
  "西城区",
  "朝阳区",
  "丰台区",
  "石景山区",
  "海淀区",
  "门头沟区",
  "房山区",
  "通州区",
  "顺义区",
  "昌平区",
  "大兴区",
  "怀柔区",
  "平谷区",
  "密云区",
  "延庆区",
];

function normalizeDistrict(value, fallback = "朝阳区") {
  const v = String(value ?? "").trim();
  return BEIJING_DISTRICTS.includes(v) ? v : fallback;
}

function normalizeHomeRadius(value, fallback = 3) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const intVal = Math.round(n);
  return Math.min(HOME_RADIUS_MAX, Math.max(HOME_RADIUS_MIN, intVal));
}

function loadQuickFilters() {
  try {
    const raw = window.localStorage.getItem(QUICK_FILTERS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return {
      district: normalizeDistrict(parsed.district, "朝阳区"),
      onlyHasOdds: Boolean(parsed.onlyHasOdds),
      onlyStarred: Boolean(parsed.onlyStarred),
      onlyShowStarredNames: Boolean(parsed.onlyShowStarredNames),
      onlyNearHome: Boolean(parsed.onlyNearHome),
      mapBoundsOnly: Boolean(parsed.mapBoundsOnly),
      showDistrictBoundary: parsed.showDistrictBoundary !== false,
      homeRadiusKm: normalizeHomeRadius(parsed.homeRadiusKm, 3),
    };
  } catch {
    return {};
  }
}

function saveQuickFilters() {
  const payload = {
    district: normalizeDistrict(state.filters.district, "朝阳区"),
    onlyHasOdds: Boolean(state.filters.onlyHasOdds),
    onlyStarred: Boolean(state.filters.onlyStarred),
    onlyShowStarredNames: Boolean(state.filters.onlyShowStarredNames),
    onlyNearHome: Boolean(state.filters.onlyNearHome),
    mapBoundsOnly: Boolean(state.filters.mapBoundsOnly),
    showDistrictBoundary: state.filters.showDistrictBoundary !== false,
    homeRadiusKm: normalizeHomeRadius(state.filters.homeRadiusKm, 3),
  };
  window.localStorage.setItem(QUICK_FILTERS_STORAGE_KEY, JSON.stringify(payload));
}

function loadPanelCollapsed() {
  try {
    const raw = window.localStorage.getItem(PANEL_COLLAPSE_STORAGE_KEY);
    return raw === "1";
  } catch {
    return false;
  }
}

function savePanelCollapsed(collapsed) {
  try {
    window.localStorage.setItem(PANEL_COLLAPSE_STORAGE_KEY, collapsed ? "1" : "0");
  } catch {
    // Ignore localStorage write errors (private mode or quota issues).
  }
}

function initHomeRadiusOptions() {
  if (!dom.homeRadiusSelect) return;
  dom.homeRadiusSelect.innerHTML = "";
  for (let km = HOME_RADIUS_MIN; km <= HOME_RADIUS_MAX; km += 1) {
    const option = document.createElement("option");
    option.value = String(km);
    option.textContent = String(km);
    dom.homeRadiusSelect.appendChild(option);
  }
}

function syncQuickFilterControlsFromState() {
  if (dom.districtSelect) {
    dom.districtSelect.value = normalizeDistrict(state.filters.district, "朝阳区");
  }
  dom.onlyHasOddsInput.checked = Boolean(state.filters.onlyHasOdds);
  dom.onlyStarredInput.checked = Boolean(state.filters.onlyStarred);
  dom.onlyShowStarredNamesInput.checked = Boolean(state.filters.onlyShowStarredNames);
  dom.onlyNearHomeInput.checked = Boolean(state.filters.onlyNearHome);
  dom.mapBoundsOnlyInput.checked = Boolean(state.filters.mapBoundsOnly);
  dom.showDistrictBoundaryInput.checked = state.filters.showDistrictBoundary !== false;
  dom.homeRadiusSelect.value = String(normalizeHomeRadius(state.filters.homeRadiusKm, 3));
}

function loadStarredUids() {
  try {
    const raw = window.localStorage.getItem(STAR_STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.map((v) => String(v)));
  } catch {
    return new Set();
  }
}

function saveStarredUids() {
  window.localStorage.setItem(STAR_STORAGE_KEY, JSON.stringify([...state.starredUids]));
}

function setStarredCountText() {
  if (!dom.starredCountText) return;
  dom.starredCountText.textContent = String(state.starredUids.size);
}

function loadHomeLocation() {
  try {
    const raw = window.localStorage.getItem(HOME_LOCATION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      Number.isFinite(parsed.lng) &&
      Number.isFinite(parsed.lat)
    ) {
      return { lng: Number(parsed.lng), lat: Number(parsed.lat) };
    }
    return null;
  } catch {
    return null;
  }
}

function saveHomeLocation() {
  if (!state.homeLocation) {
    window.localStorage.removeItem(HOME_LOCATION_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(HOME_LOCATION_STORAGE_KEY, JSON.stringify(state.homeLocation));
}

function setMapCursor(cursor) {
  if (!state.map || typeof state.map.setDefaultCursor !== "function") return;
  state.map.setDefaultCursor(cursor);
}

function refreshHomePointActionButton() {
  if (!dom.homePointActionBtn) return;
  dom.homePointActionBtn.textContent = state.homeLocation ? "清除" : "设置";
}

function setHomeLocationText() {
  if (!state.homeLocation) {
    dom.homeLocationText.textContent = "我家位置：未设置";
    dom.onlyNearHomeInput.disabled = true;
    if (state.filters.onlyNearHome) {
      state.filters.onlyNearHome = false;
    }
    dom.onlyNearHomeInput.checked = false;
    refreshHomePointActionButton();
    return;
  }
  dom.onlyNearHomeInput.disabled = false;
  dom.homeLocationText.textContent = `我家位置：${state.homeLocation.lng.toFixed(6)}, ${state.homeLocation.lat.toFixed(6)}`;
  refreshHomePointActionButton();
}

function applyHomeLocation(lng, lat) {
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
  state.homeLocation = { lng: Number(lng), lat: Number(lat) };
  state.pickingHomePoint = false;
  saveHomeLocation();
  setMapCursor("default");
  setHomeLocationText();
  saveQuickFilters();
  render();
}

function clearHomeLocation() {
  state.homeLocation = null;
  state.pickingHomePoint = false;
  setMapCursor("default");
  saveHomeLocation();
  setHomeLocationText();
  saveQuickFilters();
  render();
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

function toggleStar(uid) {
  const key = String(uid);
  if (state.starredUids.has(key)) {
    state.starredUids.delete(key);
    saveStarredUids();
    return false;
  }
  state.starredUids.add(key);
  saveStarredUids();
  return true;
}

function debounce(fn, wait = 300) {
  let timer = 0;
  return (...args) => {
    clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), wait);
  };
}

function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeLngLat(lng, lat) {
  if (lng == null || lat == null) return null;
  // Already geographic coordinates.
  if (Math.abs(lng) <= 180 && Math.abs(lat) <= 90) return { lng, lat };

  // Likely Baidu Mercator meters; convert to geographic coordinates when projection is available.
  const Projection = state.BMap?.MercatorProjection;
  if (typeof Projection === "function") {
    try {
      const projection = new Projection();
      const point = new state.BMap.Point(lng, lat);
      if (typeof projection.pointToLngLat === "function") {
        const ll = projection.pointToLngLat(point);
        const nLng = toNumber(ll?.lng);
        const nLat = toNumber(ll?.lat);
        if (nLng != null && nLat != null) return { lng: nLng, lat: nLat };
      }
      if (typeof projection.inverse === "function") {
        const ll = projection.inverse(point);
        const nLng = toNumber(ll?.lng);
        const nLat = toNumber(ll?.lat);
        if (nLng != null && nLat != null) return { lng: nLng, lat: nLat };
      }
    } catch {
      // Fall through to null.
    }
  }
  return null;
}

function getMapEventLngLat(event) {
  const candidates = [event?.point, event?.latlng, event];
  for (const c of candidates) {
    if (!c) continue;
    const lng = toNumber(c.lng);
    const lat = toNumber(c.lat);
    const normalized = normalizeLngLat(lng, lat);
    if (normalized) return normalized;
  }
  return null;
}

function getMonthCostBucket(value) {
  if (value == null) return "未知";
  if (value <= 750) return "<=750";
  if (value <= 1500) return "751-1500";
  if (value <= 3000) return "1501-3000";
  return ">3000";
}

function normalizeNursery(item, communityName) {
  const monthCostNum = toNumber(item.monthCostBa);
  const longitudeNum = toNumber(item.longitude);
  const latitudeNum = toNumber(item.latitude);
  const oddsChildNum = toNumber(item.oddsChild) ?? 0;

  return {
    ...item,
    uid: `${communityName}-${item.nurseryId ?? Math.random().toString(16).slice(2)}`,
    communityName: item.communityName || communityName || "--",
    streetCodeName: item.streetCodeName || "--",
    monthCostNum,
    monthCostBucket: getMonthCostBucket(monthCostNum),
    oddsChildNum,
    longitudeNum,
    latitudeNum,
    hasGeo: longitudeNum != null && latitudeNum != null,
  };
}

function flattenData(raw) {
  return Object.entries(raw).flatMap(([communityName, list]) =>
    (list || []).map((item) => normalizeNursery(item, communityName))
  );
}

function buildFacetItems(items, key, overrides = null) {
  const bucket = new Map();
  const source = overrides || items.map((it) => it[key] ?? "未填写");
  source.forEach((v) => bucket.set(v, (bucket.get(v) || 0) + 1));
  return [...bucket.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => String(a.value).localeCompare(String(b.value), "zh-CN"));
}

function matchOneOf(value, selected) {
  return selected.length === 0 || selected.includes(value ?? "未填写");
}

function containsKeyword(item, keyword) {
  if (!keyword) return true;
  const lower = keyword.toLowerCase();
  return [item.nurseryName, item.detailedAddress, item.nurseryCharacteristic]
    .filter(Boolean)
    .some((v) => String(v).toLowerCase().includes(lower));
}

function applyFilters(items, filters) {
  const districtPassed = normalizeDistrict(filters.district, "朝阳区") === "朝阳区";
  return items.filter((item) => {
    const nearHomePassed =
      !filters.onlyNearHome ||
      (state.homeLocation &&
        item.hasGeo &&
        distanceKm(
          state.homeLocation.lng,
          state.homeLocation.lat,
          item.longitudeNum,
          item.latitudeNum
        ) <= Number(filters.homeRadiusKm || 0));

    const basePassed =
      districtPassed &&
      containsKeyword(item, filters.keyword.trim()) &&
      matchOneOf(item.streetCodeName, filters.streets) &&
      matchOneOf(item.applyStatusLabel, filters.applyStatusLabels) &&
      matchOneOf(item.inclusiveClassFlagLabel, filters.inclusiveFlags) &&
      matchOneOf(item.nurseryLevelLabel, filters.nurseryLevels) &&
      matchOneOf(item.nurseryNatureLabel, filters.nurseryNatures) &&
      matchOneOf(item.superviseLevelLabel || "未填写", filters.superviseLevels) &&
      matchOneOf(item.monthCostBucket, filters.monthCostBuckets) &&
      (!filters.onlyStarred || state.starredUids.has(String(item.uid))) &&
      nearHomePassed &&
      (!filters.onlyHasOdds || item.oddsChildNum > 0);

    return basePassed;
  });
}

function sortItems(items) {
  const list = [...items];
  const byName = (a, b) => String(a.nurseryName ?? "").localeCompare(String(b.nurseryName ?? ""), "zh-CN");

  const superviseWeight = { A: 3, B: 2, C: 1 };
  list.sort((a, b) => {
    const wa = superviseWeight[a.superviseLevelLabel] || 0;
    const wb = superviseWeight[b.superviseLevelLabel] || 0;
    return b.oddsChildNum - a.oddsChildNum || wb - wa || byName(a, b);
  });
  return list;
}

function setArrayFilterValue(field, value, checked) {
  const current = state.filters[field];
  if (!Array.isArray(current)) return;
  if (checked && !current.includes(value)) current.push(value);
  if (!checked) state.filters[field] = current.filter((v) => v !== value);
}

function renderFacet(container, options, selectedValues, onChange) {
  container.innerHTML = "";
  options.forEach(({ value, count }) => {
    const id = `${container.id}-${String(value).replaceAll(/\s+/g, "_")}`;
    const line = document.createElement("label");
    line.className = "facet-item";
    line.innerHTML = `
      <input id="${id}" type="checkbox" ${selectedValues.includes(value) ? "checked" : ""}/>
      <span>${value}</span>
      <span class="count">${count}</span>
    `;
    line.querySelector("input").addEventListener("change", (event) => onChange(value, event.target.checked));
    container.appendChild(line);
  });
}

function buildFacetState(items) {
  return {
    streets: buildFacetItems(items, "streetCodeName"),
    applyStatusLabels: buildFacetItems(items, "applyStatusLabel"),
    inclusiveFlags: buildFacetItems(items, "inclusiveClassFlagLabel"),
    nurseryLevels: buildFacetItems(items, "nurseryLevelLabel"),
    nurseryNatures: buildFacetItems(items, "nurseryNatureLabel"),
    monthCostBuckets: MONTH_COST_BUCKETS.map((value) => ({
      value,
      count: items.filter((it) => it.monthCostBucket === value).length,
    })),
    superviseLevels: buildFacetItems(items, "superviseLevelLabel", items.map((it) => it.superviseLevelLabel || "未填写")),
  };
}

function renderFilters(facets) {
  renderFacet(dom.streetFacet, facets.streets, state.filters.streets, (value, checked) => {
    setArrayFilterValue("streets", value, checked);
    render();
  });

  renderFacet(dom.applyStatusFacet, facets.applyStatusLabels, state.filters.applyStatusLabels, (value, checked) => {
    setArrayFilterValue("applyStatusLabels", value, checked);
    render();
  });

  renderFacet(dom.inclusiveFacet, facets.inclusiveFlags, state.filters.inclusiveFlags, (value, checked) => {
    setArrayFilterValue("inclusiveFlags", value, checked);
    render();
  });

  renderFacet(dom.levelFacet, facets.nurseryLevels, state.filters.nurseryLevels, (value, checked) => {
    setArrayFilterValue("nurseryLevels", value, checked);
    render();
  });

  renderFacet(dom.natureFacet, facets.nurseryNatures, state.filters.nurseryNatures, (value, checked) => {
    setArrayFilterValue("nurseryNatures", value, checked);
    render();
  });

  renderFacet(dom.monthCostFacet, facets.monthCostBuckets, state.filters.monthCostBuckets, (value, checked) => {
    setArrayFilterValue("monthCostBuckets", value, checked);
    render();
  });

  renderFacet(dom.superviseFacet, facets.superviseLevels, state.filters.superviseLevels, (value, checked) => {
    setArrayFilterValue("superviseLevels", value, checked);
    render();
  });
}

function setSummary(total, mapCount) {
  dom.resultCount.textContent = `共 ${total} 所（地图可见 ${mapCount} 所）`;
  document.title = `找学校 - ${mapCount}/${total}`;
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function formatExportDate(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(
    date.getHours()
  )}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

function createExportFileName(date = new Date()) {
  return `找学校-筛选结果-${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}-${pad2(
    date.getHours()
  )}${pad2(date.getMinutes())}${pad2(date.getSeconds())}.txt`;
}

function normalizeExportText(value, fallback = "--") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function buildExportText(items) {
  const now = new Date();
  const enabledQuickFilters = [];
  if (state.filters.onlyHasOdds) enabledQuickFilters.push("仅看有富余学位");
  if (state.filters.onlyStarred) enabledQuickFilters.push("仅看星标幼儿园");
  if (state.filters.onlyShowStarredNames) enabledQuickFilters.push("仅看星标幼儿园名称");
  if (state.filters.onlyNearHome) enabledQuickFilters.push(`仅看我家附近(${state.filters.homeRadiusKm}公里)`);
  if (state.filters.mapBoundsOnly) enabledQuickFilters.push("仅看当前地图范围");

  const lines = [
    "找学校 - 幼儿园筛选结果",
    `导出时间：${formatExportDate(now)}`,
    `筛选区域：${normalizeDistrict(state.filters.district, "朝阳区")}`,
    `关键字：${normalizeExportText(state.filters.keyword, "无")}`,
    `快捷筛选：${enabledQuickFilters.length ? enabledQuickFilters.join("、") : "无"}`,
    `结果数量：共 ${items.length} 所`,
    "========================================",
    "",
  ];

  if (!items.length) {
    lines.push("（当前筛选条件下没有符合条件的幼儿园）");
    return lines.join("\n");
  }

  items.forEach((item, index) => {
    lines.push(`${String(index + 1).padStart(3, "0")}. ${normalizeExportText(item.nurseryName)}`);
    lines.push(
      `   招生状态：${normalizeExportText(item.applyStatusLabel)}；富余学位：${Number.isFinite(item.oddsChildNum) ? item.oddsChildNum : "--"}；基础月费：${
        item.monthCostBa ? `${item.monthCostBa}/月` : "--"
      }`
    );
    lines.push(
      `   办园属性：${normalizeExportText(item.nurseryNatureLabel)} / ${normalizeExportText(item.nurseryLevelLabel)} / ${normalizeExportText(
        item.inclusiveClassFlagLabel
      )}`
    );
    lines.push(`   区域：${normalizeExportText(item.streetCodeName)} · ${normalizeExportText(item.communityName)}`);
    lines.push(`   地址：${normalizeExportText(item.detailedAddress)}`);
    lines.push(`   电话：${normalizeExportText(item.enrollTelephone)}`);
    lines.push(`   特色：${normalizeExportText(item.nurseryCharacteristic, "--").replace(/\s+/g, " ")}`);
    lines.push("");
  });
  return lines.join("\n");
}

function downloadTextFile(content, filename) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return true;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "readonly");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  return copied;
}

function flashButtonText(button, text, durationMs = 1200) {
  if (!button) return;
  const original = button.dataset.originalText || button.textContent;
  if (!button.dataset.originalText) button.dataset.originalText = original;
  button.textContent = text;
  window.setTimeout(() => {
    button.textContent = original;
  }, durationMs);
}

function toggleStarAndRefresh(item) {
  const next = toggleStar(item.uid);
  render();
  const stillVisible = state.currentMapItems.find((x) => String(x.uid) === String(item.uid));
  if (state.mapEnabled && stillVisible) {
    openInfoWindow({
      BMap: state.BMap,
      map: state.map,
      homeLocation: state.homeLocation,
      item: {
        ...stillVisible,
        isStarred: next,
        onToggleStar: toggleStarAndRefresh,
      },
      onClose: (closedItem) => {
        if (state.selectedUid !== closedItem?.uid) return;
        state.selectedUid = null;
        render();
      },
    });
  }
}

function render() {
  setStarredCountText();
  const onlyShowStarredNames =
    Boolean(state.filters.onlyShowStarredNames) || Boolean(dom.onlyShowStarredNamesInput?.checked);
  const noMapFiltered = applyFilters(state.allItems, state.filters);
  const sortedNoMapFiltered = sortItems(noMapFiltered);
  // Keep facet options stable from full dataset so multi-select doesn't collapse options.
  const facets = buildFacetState(state.allItems);
  renderFilters(facets);

  let mapItems = sortedNoMapFiltered.filter((item) => item.hasGeo);
  if (state.mapEnabled && state.filters.mapBoundsOnly) {
    mapItems = getMapBoundsFilter({ BMap: state.BMap, map: state.map, items: mapItems });
  }
  state.currentMapItems = mapItems;
  state.currentExportItems = state.mapEnabled && state.filters.mapBoundsOnly ? mapItems : sortedNoMapFiltered;
  setSummary(sortedNoMapFiltered.length, mapItems.length);

  if (state.mapEnabled) {
    const enrichedItems = () =>
      state.currentMapItems.map((item) => ({
        ...item,
        isStarred: state.starredUids.has(String(item.uid)),
      }));
    const drawMarkers = (onMarkerClick) =>
      renderMarkers({
        BMap: state.BMap,
        map: state.map,
        items: enrichedItems(),
        district: state.filters.district,
        showDistrictBoundary: state.filters.showDistrictBoundary !== false,
        homeLocation: state.homeLocation,
        onlyNearHome: state.filters.onlyNearHome,
        homeRadiusKm: state.filters.homeRadiusKm,
        onlyShowStarredNames,
        selectedUid: state.selectedUid,
        onMarkerClick,
      });

    const handleMarkerClick = (item) => {
      if (state.pickingHomePoint) {
        applyHomeLocation(item.longitudeNum, item.latitudeNum);
        return;
      }
      state.suppressNextMapClick = true;
      state.selectedUid = item.uid;
      // Draw selected state first; then open info window so first click always shows popup.
      drawMarkers(handleMarkerClick);
      openInfoWindow({
        BMap: state.BMap,
        map: state.map,
        homeLocation: state.homeLocation,
        item: {
          ...item,
          isStarred: state.starredUids.has(String(item.uid)),
          onToggleStar: toggleStarAndRefresh,
        },
        onClose: (closedItem) => {
          if (state.selectedUid !== closedItem?.uid) return;
          state.selectedUid = null;
          render();
        },
      });
    };

    drawMarkers(handleMarkerClick);

    if (!state.hasInitialViewport && !state.selectedUid && mapItems.length > 0) {
      const points = mapItems.map((item) => new state.BMap.Point(item.longitudeNum, item.latitudeNum));
      state.map.setViewport(points);
      state.hasInitialViewport = true;
    }
  }
}

function applyPanelCollapsedDomState(collapsed) {
  if (!dom.filterPanel || !dom.panelCollapseBtn) return;
  dom.filterPanel.classList.toggle("is-collapsed", collapsed);
  dom.panelCollapseBtn.setAttribute("aria-expanded", String(!collapsed));
  dom.panelCollapseBtn.setAttribute("aria-label", collapsed ? "展开筛选面板" : "收起筛选面板");
  const textNode = dom.panelCollapseBtn.querySelector(".collapse-btn-text");
  if (textNode) {
    textNode.textContent = collapsed ? "展开" : "收起";
  }
}

function setPanelCollapsed(collapsed) {
  applyPanelCollapsedDomState(collapsed);
  savePanelCollapsed(collapsed);
}

function hydratePanelCollapsedStateOnStartup() {
  if (!dom.filterPanel || !dom.panelCollapseBtn) return;
  const collapsed = loadPanelCollapsed();
  if (!collapsed) {
    applyPanelCollapsedDomState(false);
    return;
  }
  // Avoid first-frame "expand then collapse" flicker when persisted state is collapsed.
  dom.filterPanel.classList.add("no-collapse-transition");
  applyPanelCollapsedDomState(true);
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      dom.filterPanel?.classList.remove("no-collapse-transition");
    });
  });
}

function bindEvents() {
  const debouncedRender = debounce(() => {
    render();
  });
  const bindScrollVisibleScrollbar = (element, idleMs = 420) => {
    if (!element) return;
    let scrollTimer = null;
    element.addEventListener(
      "scroll",
      () => {
        element.classList.add("is-scrolling");
        if (scrollTimer) window.clearTimeout(scrollTimer);
        scrollTimer = window.setTimeout(() => {
          element.classList.remove("is-scrolling");
        }, idleMs);
      },
      { passive: true }
    );
  };

  bindScrollVisibleScrollbar(dom.filterPanel, 420);
  document.querySelectorAll(".facet-list").forEach((node) => bindScrollVisibleScrollbar(node, 360));

  if (dom.panelCollapseBtn) {
    dom.panelCollapseBtn.addEventListener("click", () => {
      const nextCollapsed = !dom.filterPanel?.classList.contains("is-collapsed");
      setPanelCollapsed(nextCollapsed);
    });
  }

  if (dom.exportTxtBtn) {
    dom.exportTxtBtn.addEventListener("click", () => {
      const text = buildExportText(state.currentExportItems || []);
      downloadTextFile(text, createExportFileName());
      flashButtonText(dom.exportTxtBtn, "已导出");
    });
  }

  if (dom.copyTxtBtn) {
    dom.copyTxtBtn.addEventListener("click", async () => {
      const text = buildExportText(state.currentExportItems || []);
      try {
        const copied = await copyTextToClipboard(text);
        flashButtonText(dom.copyTxtBtn, copied ? "已复制" : "复制失败", copied ? 1200 : 1600);
      } catch {
        flashButtonText(dom.copyTxtBtn, "复制失败", 1600);
      }
    });
  }

  dom.keywordInput.addEventListener("input", (event) => {
    state.filters.keyword = event.target.value;
    debouncedRender();
  });

  dom.districtSelect.addEventListener("change", (event) => {
    state.filters.district = normalizeDistrict(event.target.value, "朝阳区");
    saveQuickFilters();
    render();
  });

  dom.onlyHasOddsInput.addEventListener("change", (event) => {
    state.filters.onlyHasOdds = event.target.checked;
    saveQuickFilters();
    render();
  });

  dom.onlyStarredInput.addEventListener("change", (event) => {
    state.filters.onlyStarred = event.target.checked;
    saveQuickFilters();
    render();
  });

  dom.clearStarredBtn.addEventListener("click", () => {
    state.starredUids = new Set();
    saveStarredUids();
    if (state.filters.onlyStarred || state.filters.onlyShowStarredNames) {
      state.selectedUid = null;
      closeInfoWindow({ fireOnClose: false });
    }
    render();
  });

  dom.onlyShowStarredNamesInput.addEventListener("change", (event) => {
    state.filters.onlyShowStarredNames = event.target.checked;
    saveQuickFilters();
    render();
  });

  dom.onlyNearHomeInput.addEventListener("change", (event) => {
    state.filters.onlyNearHome = event.target.checked;
    saveQuickFilters();
    render();
  });

  dom.homeRadiusSelect.addEventListener("change", (event) => {
    state.filters.homeRadiusKm = normalizeHomeRadius(event.target.value, 3);
    saveQuickFilters();
    if (state.filters.onlyNearHome) render();
  });

  dom.homePointActionBtn.addEventListener("click", () => {
    if (state.homeLocation) {
      clearHomeLocation();
      return;
    }
    if (!state.mapEnabled) {
      dom.homeLocationText.textContent = "我家位置：地图不可用，无法设置";
      return;
    }
    state.pickingHomePoint = true;
    setMapCursor("crosshair");
    dom.homeLocationText.textContent = "我家位置：请在地图上点击一个位置";
  });

  dom.mapBoundsOnlyInput.addEventListener("change", (event) => {
    state.filters.mapBoundsOnly = event.target.checked;
    saveQuickFilters();
    render();
  });

  dom.showDistrictBoundaryInput.addEventListener("change", (event) => {
    state.filters.showDistrictBoundary = event.target.checked;
    saveQuickFilters();
    render();
  });

  dom.resetBtn.addEventListener("click", () => {
    state.filters = structuredClone(DEFAULT_FILTERS);
    state.filters.district = "朝阳区";
    state.filters.homeRadiusKm = 3;
    state.selectedUid = null;
    dom.districtSelect.value = "朝阳区";
    dom.keywordInput.value = "";
    dom.onlyHasOddsInput.checked = false;
    dom.onlyStarredInput.checked = false;
    dom.onlyShowStarredNamesInput.checked = false;
    dom.onlyNearHomeInput.checked = false;
    dom.homeRadiusSelect.value = String(normalizeHomeRadius(3, 3));
    dom.mapBoundsOnlyInput.checked = false;
    dom.showDistrictBoundaryInput.checked = true;
    saveQuickFilters();
    render();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (state.selectedUid == null) {
      closeInfoWindow({ fireOnClose: false });
      return;
    }
    state.selectedUid = null;
    closeInfoWindow({ fireOnClose: false });
    render();
  });
}

async function loadRawData() {
  const response = await fetch(DATA_URL);
  if (!response.ok) {
    throw new Error(`加载数据失败: ${response.status}`);
  }
  return response.json();
}

async function initMapSafe() {
  try {
    state.BMap = await loadBaiduMap(BAIDU_MAP_AK);
    if (state.homeLocation) {
      const normalizedHome = normalizeLngLat(state.homeLocation.lng, state.homeLocation.lat);
      if (normalizedHome) {
        state.homeLocation = normalizedHome;
        saveHomeLocation();
        setHomeLocationText();
      }
    }
    state.map = createMap(state.BMap, "mapContainer");
    state.mapEnabled = true;
    const debounceMapFilterRender = debounce(() => render(), 120);

    state.map.addEventListener("moveend", () => {
      if (state.filters.mapBoundsOnly) debounceMapFilterRender();
    });
    state.map.addEventListener("zoomend", () => {
      if (state.filters.mapBoundsOnly) debounceMapFilterRender();
    });
    state.map.addEventListener("click", (event) => {
      if (state.suppressNextMapClick) {
        state.suppressNextMapClick = false;
        return;
      }
      if (!state.pickingHomePoint) {
        if (state.selectedUid != null) {
          state.selectedUid = null;
          closeInfoWindow({ fireOnClose: false });
          render();
        } else {
          closeInfoWindow({ fireOnClose: false });
        }
        return;
      }
      const lngLat = getMapEventLngLat(event);
      if (!lngLat) return;
      applyHomeLocation(lngLat.lng, lngLat.lat);
    });
  } catch (error) {
    state.mapEnabled = false;
    state.filters.mapBoundsOnly = false;
    dom.mapBoundsOnlyInput.checked = false;
    dom.mapBoundsOnlyInput.disabled = true;
    const mapContainer = document.getElementById("mapContainer");
    mapContainer.innerHTML = "<div style='padding:12px;color:#b45309;'>地图加载失败，当前使用列表模式</div>";
  }
}

async function bootstrap() {
  initHomeRadiusOptions();
  const quickFilters = loadQuickFilters();
  state.filters = { ...state.filters, ...quickFilters };
  state.starredUids = loadStarredUids();
  setStarredCountText();
  state.homeLocation = loadHomeLocation();
  setHomeLocationText();
  syncQuickFilterControlsFromState();
  bindEvents();
  const raw = await loadRawData();
  state.allItems = flattenData(raw);
  render();
  await initMapSafe();
  render();
}

hydratePanelCollapsedStateOnStartup();

bootstrap().catch((error) => {
  dom.resultCount.textContent = `页面初始化失败：${error.message}`;
});
