import { computed, ref } from "vue";

export const FUELS = ["92号汽油", "95号汽油", "98号汽油", "柴油"] as const;
export type Fuel = (typeof FUELS)[number];

export const STATUSES = ["生效中", "待确认", "已回退"] as const;
export type PriceStatus = (typeof STATUSES)[number];

/** 各油品的默认挂牌价（元/升），恢复时回退到这张表 */
export const DEFAULT_PRICES: Record<Fuel, number> = {
  "92号汽油": 7.55,
  "95号汽油": 8.05,
  "98号汽油": 9.02,
  柴油: 7.05,
};

export type PriceRecord = {
  id: string;
  fuel: Fuel;
  price: number;
  operator: string;
  effectiveDate: string;
  status: PriceStatus;
  notes: string;
  createdAt: string;
};

export type AdjustmentInput = {
  fuel: Fuel;
  price: number;
  operator: string;
  effectiveDate: string;
  notes?: string;
};

export type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

const STORAGE_KEY = "dfwlfront-9-price";

const SEED_RECORDS: PriceRecord[] = [
  {
    id: "seed-1",
    fuel: "92号汽油",
    price: 7.62,
    operator: "站长",
    effectiveDate: "2026-09-10",
    status: "生效中",
    notes: "正常调价",
    createdAt: "2026-09-10T08:30:00.000Z",
  },
  {
    id: "seed-2",
    fuel: "柴油",
    price: 7.18,
    operator: "值班经理",
    effectiveDate: "2026-09-11",
    status: "待确认",
    notes: "等待复核",
    createdAt: "2026-09-11T08:30:00.000Z",
  },
];

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function defaultStorage(): StorageLike | null {
  if (typeof localStorage === "undefined") return null;
  return localStorage;
}

function loadRecords(storage: StorageLike | null): PriceRecord[] {
  if (!storage) return SEED_RECORDS.map((record) => ({ ...record }));
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return SEED_RECORDS.map((record) => ({ ...record }));
  try {
    const parsed = JSON.parse(raw) as PriceRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function createPriceStore(storage?: StorageLike | null) {
  const backend = storage === undefined ? defaultStorage() : storage;
  const records = ref<PriceRecord[]>(loadRecords(backend));

  function persist() {
    backend?.setItem(STORAGE_KEY, JSON.stringify(records.value));
  }

  /** 保存一次调价，新记录插到历史最前面 */
  function addAdjustment(input: AdjustmentInput): PriceRecord {
    const record: PriceRecord = {
      id:
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `rec-${Date.now()}-${Math.round(performance.now() * 1000)}`,
      fuel: input.fuel,
      price: round2(input.price),
      operator: input.operator,
      effectiveDate: input.effectiveDate,
      status: "生效中",
      notes: input.notes?.trim() || "暂无备注",
      createdAt: new Date().toISOString(),
    };
    records.value = [record, ...records.value];
    persist();
    return record;
  }

  function isAtDefault(record: PriceRecord): boolean {
    return round2(record.price) === DEFAULT_PRICES[record.fuel];
  }

  /** 该记录是否为对应油品的最新一条（即当前挂牌价） */
  function isCurrent(record: PriceRecord): boolean {
    return records.value.find((item) => item.fuel === record.fuel)?.id === record.id;
  }

  /**
   * 恢复默认挂牌价：留下一条「已回退」记录。
   * 以下情况拒绝恢复并返回 false，避免重复回退：
   * 1. 当前价已经是默认价；
   * 2. 该记录不是油品的最新记录（更早的历史记录）。
   */
  function restoreDefault(record: PriceRecord): boolean {
    const defaultPrice = DEFAULT_PRICES[record.fuel];
    if (!isCurrent(record) || round2(record.price) === defaultPrice) return false;
    const rollback: PriceRecord = {
      id:
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `rec-${Date.now()}-${Math.round(performance.now() * 1000)}`,
      fuel: record.fuel,
      price: defaultPrice,
      operator: record.operator,
      effectiveDate: new Date().toISOString().slice(0, 10),
      status: "已回退",
      notes: `恢复默认挂牌价：¥${round2(record.price).toFixed(2)} → ¥${defaultPrice.toFixed(2)}`,
      createdAt: new Date().toISOString(),
    };
    records.value = [rollback, ...records.value];
    persist();
    return true;
  }

  /**
   * 状态流转：生效中 → 待确认 → 已回退（终态）。
   * 已回退记录不允许再流转回生效中，返回 false 且不改状态。
   */
  function flowStatus(id: string): boolean {
    const target = records.value.find((record) => record.id === id);
    if (!target || target.status === "已回退") return false;
    target.status = target.status === "生效中" ? "待确认" : "已回退";
    persist();
    return true;
  }

  function removeRecord(id: string) {
    records.value = records.value.filter((record) => record.id !== id);
    persist();
  }

  type FuelFilter = "全部油品" | Fuel;
  type StatusFilter = "全部状态" | PriceStatus;

  function filterRecords(fuel: FuelFilter, status: StatusFilter): PriceRecord[] {
    return records.value.filter((record) => {
      const fuelMatched = fuel === "全部油品" || record.fuel === fuel;
      const statusMatched = status === "全部状态" || record.status === status;
      return fuelMatched && statusMatched;
    });
  }

  const statusCounts = computed(() =>
    STATUSES.map((status) => ({
      status,
      value: records.value.filter((record) => record.status === status).length,
    })),
  );

  return {
    records,
    addAdjustment,
    restoreDefault,
    isAtDefault,
    isCurrent,
    flowStatus,
    removeRecord,
    filterRecords,
    statusCounts,
  };
}

export type PriceStore = ReturnType<typeof createPriceStore>;

let singleton: PriceStore | undefined;

export function usePriceStore(): PriceStore {
  if (!singleton) singleton = createPriceStore();
  return singleton;
}
