import { chromium } from "playwright";

const BASE = "http://127.0.0.1:5199/";
const shot = (name) => page.screenshot({ path: `/tmp/shots/${name}.png`, fullPage: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH,
  args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 1360, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(BASE, { waitUntil: "networkidle" });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: "networkidle" });

let step = 0;
function ok(msg) {
  step++;
  console.log(`  ${step}. ✓ ${msg}`);
}

// 1. 初始种子数据
await page.waitForSelector(".record");
let count = await page.locator(".record").count();
ok(`初始展示种子数据（${count} 条记录）`);

// 2. 新增调价
await page.selectOption("select", "95号汽油");
await page.fill('input[type="number"]', "8.50");
await page.fill('input[type="text"]', "E2E测试员");
await page.fill('input[type="date"]', "2026-09-12");
await page.fill("textarea", "E2E自动化调价");
await shot("01-before-add");
await page.getByRole("button", { name: "保存价格" }).click();
await page.waitForTimeout(150);

const firstTitle = await page.locator(".record-title").first().textContent();
if (!firstTitle.includes("95号汽油") || !firstTitle.includes("8.50"))
  throw new Error(`新增后首条记录异常: ${firstTitle}`);
const firstStatus = await page.locator(".record .status").first().textContent();
if (firstStatus.trim() !== "生效中") throw new Error(`新增状态异常: ${firstStatus}`);
const firstNote = await page.locator(".record .note").first().textContent();
if (!firstNote.includes("E2E自动化调价")) throw new Error("备注未保存");
ok("新增调价：95号汽油 ¥8.50 生效中，备注已保存");

// 3. 按油品筛选
const selects = page.locator(".filters select");
await selects.first().selectOption("95号汽油");
await page.waitForTimeout(100);
let visible = await page.locator(".record-title").allTextContents();
if (visible.length !== 1 || !visible[0].includes("95号汽油"))
  throw new Error(`油品筛选异常: ${JSON.stringify(visible)}`);
ok("按油品筛选：仅显示 95号汽油 1 条");

// 4. 叠加状态筛选 -> 无匹配空提示
await selects.last().selectOption("待确认");
await page.waitForTimeout(100);
let emptyText = await page.locator(".empty").textContent();
if (!emptyText.includes("没有符合") || !emptyText.includes("调整筛选条件"))
  throw new Error(`筛选空提示异常: ${emptyText}`);
ok("无匹配时显示筛选空提示（引导调整筛选条件）");
await shot("02-filter-empty");

// 清除状态筛选
await selects.last().selectOption("全部状态");
await page.waitForTimeout(100);
if ((await page.locator(".record").count()) !== 1) throw new Error("清除筛选后记录未恢复");
ok("清除状态筛选后记录重新出现");

// 5. 恢复默认价
await page.getByRole("button", { name: "恢复默认价" }).first().click();
await page.waitForTimeout(150);
const rollbackTitle = await page.locator(".record-title").first().textContent();
const rollbackStatus = await page.locator(".record .status").first().textContent();
const rollbackNote = await page.locator(".record .note").first().textContent();
if (!rollbackTitle.includes("8.05")) throw new Error(`回退后价格异常: ${rollbackTitle}`);
if (rollbackStatus.trim() !== "已回退") throw new Error(`回退状态异常: ${rollbackStatus}`);
if (!rollbackNote.includes("8.50") || !rollbackNote.includes("8.05"))
  throw new Error(`回退记录说明异常: ${rollbackNote}`);
ok("恢复默认价：新增 95号汽油 ¥8.05「已回退」记录，含价格变化说明");

// 6. 重复恢复防护
const topCard = page.locator(".record").first();
const topBtn = topCard.getByRole("button").first();
const oldBtn = page.locator(".record").nth(1).getByRole("button").first();
if ((await topBtn.textContent()) !== "已是默认价" || (await topBtn.isEnabled()) !== false)
  throw new Error("回退后最新记录按钮应禁用并显示「已是默认价」");
if ((await oldBtn.textContent()) !== "历史记录" || (await oldBtn.isEnabled()) !== false)
  throw new Error("旧记录按钮应禁用并显示「历史记录」");

// 已回退是终态：回退卡的「流转状态」必须禁用，不能再变回生效中
const topFlowBtn = topCard.getByRole("button", { name: "流转状态" });
if ((await topFlowBtn.isEnabled()) !== false)
  throw new Error("已回退记录的流转状态按钮应禁用");
const rollbackCards = await page.locator(".record").allTextContents();
const n95Rollback = rollbackCards.filter(
  (t) => t.includes("95号汽油") && t.includes("已回退") && t.includes("8.05"),
).length;
if (n95Rollback !== 1) throw new Error(`回退记录数量异常: ${n95Rollback}`);
ok("重复恢复防护：最新记录「已是默认价」禁用，旧记录「历史记录」禁用，无重复回退记录");
ok("状态边界：已回退卡「流转状态」按钮禁用，不会再变回生效中");

// 正常记录的流转链仍然可用：生效中 -> 待确认
const liveCard = page.locator(".record").nth(1);
const liveFlowBtn = liveCard.getByRole("button", { name: "流转状态" });
if (!(await liveFlowBtn.isEnabled())) throw new Error("生效中记录的流转按钮应可用");
await liveFlowBtn.click();
await page.waitForTimeout(100);
const liveStatus = await liveCard.locator(".status").textContent();
if (liveStatus.trim() !== "待确认") throw new Error(`正常流转异常: ${liveStatus}`);
// 再点一次 -> 已回退，之后按钮禁用
await liveCard.getByRole("button", { name: "流转状态" }).click();
await page.waitForTimeout(100);
if ((await liveCard.locator(".status").textContent()).trim() !== "已回退")
  throw new Error("待确认流转后应为已回退");
if (await liveCard.getByRole("button", { name: "流转状态" }).isEnabled())
  throw new Error("到达已回退后流转按钮应禁用");
ok("正常状态链保持可用：生效中 → 待确认 → 已回退后按钮禁用");
await shot("03-restored");

// 7. 刷新持久化
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector(".record");
const afterReload = await page.locator(".record-title").first().textContent();
const afterReloadStatus = await page.locator(".record .status").first().textContent();
if (!afterReload.includes("8.05") || afterReloadStatus.trim() !== "已回退")
  throw new Error(`刷新后数据异常: ${afterReload} ${afterReloadStatus}`);
ok("刷新后数据保留：首条仍为 95号汽油 ¥8.05 已回退");

// 8. 清空全部 -> 全局空数据提示
await page.locator(".filters select").first().selectOption("全部油品");
await page.locator(".filters select").last().selectOption("全部状态");
let guard = 0;
while ((await page.getByRole("button", { name: "删除" }).count()) > 0 && guard < 50) {
  await page.getByRole("button", { name: "删除" }).first().click();
  await page.waitForTimeout(60);
  guard++;
}
const globalEmpty = await page.locator(".empty").textContent();
if (!globalEmpty.includes("暂无调价记录"))
  throw new Error(`全局空提示异常: ${globalEmpty}`);
ok("清空全部记录后显示全局空数据提示（暂无调价记录）");
await shot("04-no-data");

// 9. 空状态刷新后仍为空
await page.reload({ waitUntil: "networkidle" });
const emptyAfterReload = await page.locator(".empty").textContent();
if (!emptyAfterReload.includes("暂无调价记录")) throw new Error("刷新后空提示丢失");
ok("刷新后仍为空数据提示");

if (errors.length) throw new Error(`页面报错: ${errors.join("; ")}`);
await browser.close();
console.log("\n全部 E2E 场景通过 ✅");
