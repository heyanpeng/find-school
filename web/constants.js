export const DATA_URL = "./data/chaoyang.json";

const runtimeConfig = globalThis.__APP_CONFIG__ ?? {};
export const BAIDU_MAP_AK = String(runtimeConfig.BAIDU_MAP_AK ?? "").trim();

export const MONTH_COST_BUCKETS = ["<=750", "751-1500", "1501-3000", ">3000", "未知"];

export const DEFAULT_FILTERS = {
  district: "朝阳区",
  keyword: "",
  streets: [],
  applyStatusLabels: [],
  inclusiveFlags: [],
  nurseryLevels: [],
  nurseryNatures: [],
  superviseLevels: [],
  monthCostBuckets: [],
  onlyHasOdds: false,
  onlyStarred: false,
  onlyShowStarredNames: false,
  onlyNearHome: false,
  homeRadiusKm: 3,
  mapBoundsOnly: false,
  showDistrictBoundary: true,
};
