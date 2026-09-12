<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import {
  DEFAULT_PRICES,
  FUELS,
  STATUSES,
  usePriceStore,
  type Fuel,
  type PriceRecord,
} from "./priceLog";

const stack = ["Vue3", "Vite", "TypeScript", "Pinia", "Naive UI"];
const fuelFilters = ["全部油品", ...FUELS] as const;
const statusFilters = ["全部状态", ...STATUSES] as const;

const store = usePriceStore();

const form = reactive({
  fuel: "" as Fuel | "",
  price: "" as number | "",
  operator: "",
  effectiveDate: new Date().toISOString().slice(0, 10),
});
const note = ref("");
const fuelFilter = ref<(typeof fuelFilters)[number]>("全部油品");
const statusFilter = ref<(typeof statusFilters)[number]>("全部状态");

const filteredRecords = computed(() =>
  store.filterRecords(fuelFilter.value, statusFilter.value),
);

const hasAnyRecord = computed(() => store.records.value.length > 0);

const metrics = computed(() => {
  const all = store.records.value;
  const pending = all.filter((record) => record.status === "待确认").length;
  const latestByFuel = new Map<Fuel, PriceRecord>();
  for (const record of all) {
    if (!latestByFuel.has(record.fuel)) latestByFuel.set(record.fuel, record);
  }
  const latestPrices = [...latestByFuel.values()].map((record) => record.price);
  const avg = latestPrices.length
    ? (latestPrices.reduce((acc, price) => acc + price, 0) / latestPrices.length).toFixed(2)
    : "0.00";
  return [
    { label: "调价记录", value: all.length },
    { label: "待确认", value: pending },
    { label: "最新均价", value: `¥${avg}` },
  ];
});

function submit() {
  if (!form.fuel || form.price === "" || !form.operator || !form.effectiveDate) return;
  store.addAdjustment({
    fuel: form.fuel,
    price: Number(form.price),
    operator: form.operator,
    effectiveDate: form.effectiveDate,
    notes: note.value,
  });
  resetForm();
}

function resetForm() {
  form.fuel = "";
  form.price = "";
  form.operator = "";
  form.effectiveDate = new Date().toISOString().slice(0, 10);
  note.value = "";
}

function restore(record: PriceRecord) {
  store.restoreDefault(record);
}

function defaultPriceLabel(record: PriceRecord) {
  return DEFAULT_PRICES[record.fuel].toFixed(2);
}

function formatTime(iso: string) {
  return iso.replace("T", " ").slice(0, 16);
}

const maxChart = computed(() =>
  Math.max(1, ...store.statusCounts.value.map((row) => row.value)),
);
const statusCounts = store.statusCounts;
</script>

<template>
  <main class="app">
    <div class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">石油行业前端最小闭环</p>
          <h1>油品价格维护</h1>
          <p class="subtitle">维护挂牌价、保存每次调价记录，并支持一键恢复默认挂牌价（自动留下回退记录）。</p>
        </div>
        <div class="stack">
          <span v-for="item in stack" :key="item" class="tag">{{ item }}</span>
        </div>
      </header>

      <section class="metrics">
        <article v-for="metric in metrics" :key="metric.label" class="metric">
          <span>{{ metric.label }}</span>
          <strong>{{ metric.value }}</strong>
        </article>
      </section>

      <section class="workspace">
        <form class="panel" @submit.prevent="submit">
          <h2>调整油品价格</h2>
          <div class="form-grid">
            <label>
              油品
              <select v-model="form.fuel" required>
                <option value="">请选择</option>
                <option v-for="fuel in FUELS" :key="fuel" :value="fuel">{{ fuel }}</option>
              </select>
            </label>
            <label>
              挂牌价（元/升）
              <input v-model.number="form.price" type="number" step="0.01" min="0" required />
            </label>
            <label>
              操作员
              <input v-model="form.operator" type="text" required />
            </label>
            <label>
              生效日期
              <input v-model="form.effectiveDate" type="date" required />
            </label>
            <label>
              备注
              <textarea v-model="note" placeholder="填写处理说明或现场备注" />
            </label>
            <button type="submit">保存价格</button>
          </div>

          <div class="default-prices">
            <h3>默认挂牌价</h3>
            <ul>
              <li v-for="fuel in FUELS" :key="fuel">
                <span>{{ fuel }}</span>
                <strong>¥{{ DEFAULT_PRICES[fuel].toFixed(2) }}</strong>
              </li>
            </ul>
          </div>
        </form>

        <section class="list-panel">
          <div class="toolbar">
            <h2>调价记录</h2>
            <div class="filters">
              <select v-model="fuelFilter">
                <option v-for="item in fuelFilters" :key="item" :value="item">{{ item }}</option>
              </select>
              <select v-model="statusFilter">
                <option v-for="item in statusFilters" :key="item" :value="item">{{ item }}</option>
              </select>
            </div>
          </div>

          <div class="record-grid">
            <div v-if="filteredRecords.length === 0" class="empty">
              <template v-if="hasAnyRecord">
                没有符合「{{ fuelFilter }} / {{ statusFilter }}」的调价记录，请调整筛选条件。
              </template>
              <template v-else>暂无调价记录，提交左侧表单完成第一次调价吧。</template>
            </div>

            <article v-for="record in filteredRecords" :key="record.id" class="record">
              <div class="record-head">
                <p class="record-title">{{ record.fuel }} / ¥{{ record.price.toFixed(2) }}</p>
                <span class="status" :class="`status-${record.status}`">{{ record.status }}</span>
              </div>
              <div class="details">
                <span>操作员: {{ record.operator }}</span>
                <span>生效日期: {{ record.effectiveDate }}</span>
                <span>记录时间: {{ formatTime(record.createdAt) }}</span>
                <span>默认价: ¥{{ defaultPriceLabel(record) }}</span>
              </div>
              <p class="note" :class="{ rollback: record.status === '已回退' }">{{ record.notes }}</p>
              <div class="actions">
                <button
                  v-if="store.isCurrent(record) && !store.isAtDefault(record)"
                  type="button"
                  @click="restore(record)"
                >
                  恢复默认价
                </button>
                <button
                  v-else
                  type="button"
                  disabled
                  :title="store.isCurrent(record) ? '当前已是默认挂牌价，无需重复恢复' : '历史记录不可重复恢复，仅最新挂牌价可操作'"
                >
                  {{ store.isCurrent(record) ? "已是默认价" : "历史记录" }}
                </button>
                <button class="secondary" type="button" @click="store.flowStatus(record.id)">
                  流转状态
                </button>
                <button class="danger" type="button" @click="store.removeRecord(record.id)">
                  删除
                </button>
              </div>
            </article>
          </div>

          <div class="mini-chart">
            <div v-for="row in statusCounts" :key="row.status" class="bar">
              <span>{{ row.status }}</span>
              <div class="bar-track">
                <div class="bar-fill" :style="{ width: `${(row.value / maxChart) * 100}%` }" />
              </div>
              <strong>{{ row.value }}</strong>
            </div>
          </div>
        </section>
      </section>
    </div>
  </main>
</template>
