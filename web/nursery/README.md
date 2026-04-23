# 幼儿园筛选地图页面

## 本地运行

1. 在仓库根目录执行：

```bash
python3 -m http.server 8080
```

2. 浏览器打开：

`http://localhost:8080/web/nursery/index.html`

## 地图配置

在 `web/nursery/constants.js` 中设置 `BAIDU_MAP_AK`：

- 可使用本地测试 AK 进行开发。
- 不要提交真实生产 AK。
- 若 AK 无效或配置不完整，页面会自动降级为列表模式。

## 数据源

- 默认读取：`data/chaoyang.json`
- 页面必须通过本地 HTTP 服务访问，不支持直接 `file://` 打开。
