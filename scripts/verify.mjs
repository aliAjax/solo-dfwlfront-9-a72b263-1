import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

// 用法：先 `esbuild src/priceLog.ts --bundle --format=esm --outfile=node_modules/.cache/price-verify/priceLog.js`
// 或直接运行 `npm run verify:logic`（已包含打包步骤）。
const bundlePath = process.env.PRICE_LOG_BUNDLE ||
  new URL("../node_modules/.cache/price-verify/priceLog.js", import.meta.url).pathname;
const { createPriceStore, DEFAULT_PRICES } = await import(pathToFileURL(bundlePath).href);

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    _dump: () => map,
  };
}

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

// 用例 1：全新 store 带种子数据
{
  const storage = memoryStorage();
  const store = createPriceStore(storage);
  check("首次打开有种子数据", () => {
    assert.equal(store.records.value.length, 2);
    assert.equal(store.records.value[0].fuel, "92号汽油");
  });

  // 用例 2：新增调价
  const created = store.addAdjustment({
    fuel: "92号汽油",
    price: 7.99,
    operator: "测试员",
    effectiveDate: "2026-09-12",
    notes: "新增验证",
  });
  check("保存调价后新记录排最前且为生效中", () => {
    assert.equal(store.records.value.length, 3);
    assert.equal(store.records.value[0].id, created.id);
    assert.equal(store.records.value[0].status, "生效中");
    assert.equal(store.records.value[0].price, 7.99);
    assert.equal(store.records.value[0].notes, "新增验证");
  });

  // 用例 3：空备注兜底
  store.addAdjustment({
    fuel: "柴油",
    price: 7.3,
    operator: "测试员",
    effectiveDate: "2026-09-12",
  });
  check("备注为空时写入兜底文案", () => {
    assert.equal(store.records.value[0].notes, "暂无备注");
  });

  // 用例 4：按油品筛选
  check("按油品筛选（92号汽油）", () => {
    const rows = store.filterRecords("92号汽油", "全部状态");
    assert.ok(rows.length >= 2);
    assert.ok(rows.every((r) => r.fuel === "92号汽油"));
  });

  // 用例 5：按状态筛选
  check("按状态筛选（待确认）", () => {
    const rows = store.filterRecords("全部油品", "待确认");
    assert.ok(rows.length >= 1);
    assert.ok(rows.every((r) => r.status === "待确认"));
  });

  // 用例 6：油品 + 状态联合筛选
  check("油品+状态联合筛选（柴油/生效中）", () => {
    const rows = store.filterRecords("柴油", "生效中");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].price, 7.3);
  });

  // 用例 7：无匹配 -> 空数组（页面据此显示筛选空提示）
  check("筛选无匹配返回空数组", () => {
    const rows = store.filterRecords("98号汽油", "全部状态");
    assert.deepEqual(rows, []);
  });

  // 用例 8：恢复默认价 -> 产生已回退记录
  const target = store.records.value.find((r) => r.fuel === "92号汽油" && r.price === 7.99);
  const before = store.records.value.length;
  const restored = store.restoreDefault(target);
  check("恢复默认价成功并留下已回退记录", () => {
    assert.equal(restored, true);
    assert.equal(store.records.value.length, before + 1);
    const rollback = store.records.value[0];
    assert.equal(rollback.status, "已回退");
    assert.equal(rollback.fuel, "92号汽油");
    assert.equal(rollback.price, DEFAULT_PRICES["92号汽油"]);
    assert.match(rollback.notes, /7\.99.*7\.55/);
  });

  // 用例 9：重复恢复 -> 拒绝、不新增记录
  const rollbackRecord = store.records.value[0];
  const beforeAgain = store.records.value.length;
  const again = store.restoreDefault(rollbackRecord);
  check("已是默认价时重复恢复被拒绝且不产生记录", () => {
    assert.equal(again, false);
    assert.equal(store.records.value.length, beforeAgain);
    assert.equal(store.isAtDefault(rollbackRecord), true);
  });

  // 用例 9.5：已回退记录不能再流转成生效中
  check("已回退是终态：流转被拒绝且状态保持已回退", () => {
    assert.equal(store.flowStatus(rollbackRecord.id), false);
    assert.equal(store.records.value[0].status, "已回退");
  });

  // 用例 9.6：正常状态链 生效中 → 待确认 → 已回退 仍可流转（仅最新记录）
  const fresh98 = store.addAdjustment({
    fuel: "98号汽油",
    price: 9.5,
    operator: "测试员",
    effectiveDate: "2026-09-12",
  });
  check("正常状态链：生效中 → 待确认 → 已回退（仅最新记录）", () => {
    const find98 = () => store.records.value.find((r) => r.id === fresh98.id);
    assert.equal(find98().status, "生效中");
    assert.equal(store.flowStatus(fresh98.id), true);
    assert.equal(find98().status, "待确认");
    assert.equal(store.flowStatus(fresh98.id), true);
    assert.equal(find98().status, "已回退");
    // 到达终态后继续流转仍被拒绝
    assert.equal(store.flowStatus(fresh98.id), false);
    assert.equal(find98().status, "已回退");
  });

  // 用例 9.7：历史（非最新）记录不能再流转状态
  check("历史记录流转被拒绝且状态不变", () => {
    // 给 98号汽油再来一次调价，上一条变为历史记录
    const newer98 = store.addAdjustment({
      fuel: "98号汽油",
      price: 9.3,
      operator: "测试员",
      effectiveDate: "2026-09-12",
    });
    const old98 = store.records.value.find((r) => r.id === fresh98.id);
    assert.equal(store.isCurrent(old98), false);
    assert.equal(old98.status, "已回退");
    assert.equal(store.flowStatus(old98.id), false);
    assert.equal(store.records.value.find((r) => r.id === fresh98.id).status, "已回退");
    // 最新记录依然可以正常流转
    assert.equal(store.flowStatus(newer98.id), true);
    assert.equal(store.records.value.find((r) => r.id === newer98.id).status, "待确认");
  });

  // 用例 10：历史记录（非最新）重复恢复被拒绝；最新记录可恢复
  check("历史记录重复恢复被拒绝（7.18 已被 7.30 覆盖）", () => {
    const oldDiesel = store.records.value.find((r) => r.fuel === "柴油" && r.price === 7.18);
    assert.equal(store.restoreDefault(oldDiesel), false);
  });
  check("对最新柴油记录恢复默认价（7.30 -> 7.05）", () => {
    const diesel = store.records.value.find((r) => r.fuel === "柴油" && r.price === 7.3);
    assert.equal(store.restoreDefault(diesel), true);
    assert.equal(store.records.value[0].notes, "恢复默认挂牌价：¥7.30 → ¥7.05");
    // 恢复后再次操作同一最新记录（已是默认价）仍被拒绝
    assert.equal(store.restoreDefault(store.records.value[0]), false);
  });

  // 用例 11：持久化 —— 刷新后数据仍在
  const reloaded = createPriceStore(storage);
  check("数据已写入存储并在重新加载后保留", () => {
    assert.ok(reloaded.records.value.some((r) => r.status === "已回退"));
    assert.ok(reloaded.records.value.some((r) => r.notes === "新增验证"));
    assert.equal(reloaded.records.value.length, store.records.value.length);
  });
}

// 用例 12：完全无数据（模拟用户删光所有记录）
{
  const storage = memoryStorage();
  storage.setItem("dfwlfront-9-price", "[]");
  const store = createPriceStore(storage);
  check("空存储下记录为空且筛选为空", () => {
    assert.deepEqual(store.records.value, []);
    assert.deepEqual(store.filterRecords("全部油品", "全部状态"), []);
  });
}

// 用例 13：存储损坏 -> 容错为空数组
{
  const storage = memoryStorage();
  storage.setItem("dfwlfront-9-price", "{not-json");
  const store = createPriceStore(storage);
  check("损坏的存储数据被容错为空列表", () => {
    assert.deepEqual(store.records.value, []);
  });
}

console.log(`\n全部 ${passed} 组用例通过 ✅`);
