# 幼儿园筛选地图页面

## 本地运行

1. 在仓库根目录执行：

```bash
python3 -m http.server 8080
```

2. 浏览器打开：

`http://localhost:8080/web/index.html`

## 地图配置

项目通过 `web/config.js` 注入运行时配置（默认空值，不含真实密钥）。

### 本地开发（环境变量）

在仓库根目录执行：

```bash
export BAIDU_MAP_AK="你的百度地图AK"
cat > web/config.js <<EOF
window.__APP_CONFIG__ = window.__APP_CONFIG__ || {};
window.__APP_CONFIG__.BAIDU_MAP_AK = "${BAIDU_MAP_AK}";
EOF
```

### GitHub Pages（推荐）

1. 打开仓库 Settings -> Secrets and variables -> Actions
2. 新增仓库 Secret：`BAIDU_MAP_AK`
3. 推送到 `main` 后，工作流会自动把 Secret 注入发布产物中的 `config.js`

- 可使用本地测试 AK 进行开发。
- 不要把真实生产 AK 直接写入仓库源码。
- 若 AK 无效或未配置，页面会自动降级为列表模式。

## 数据源

- 默认读取：`web/data/chaoyang.json`
- 页面必须通过本地 HTTP 服务访问，不支持直接 `file://` 打开。
