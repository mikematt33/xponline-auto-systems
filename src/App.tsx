import React, { useState, useEffect, useCallback } from "react";
import {
  parseCSV,
  aggregateData,
  type AggregatedData,
  ORDERED_SIZES_KEYS,
} from "./utils/csvParser";

const STORAGE_KEY = "xponline_state_v1";

interface PersistedState {
  data: AggregatedData | null;
  fileName: string | null;
  darkMode: boolean;
  checkedCells: Record<string, number>; // Changed to number for partial counts
  activeTab: "sort" | "earnings";
  // Earnings Settings
  shopifyPercent?: string;
  shopifyFixed?: string;
  blankCosts?: string;
  shippingCost?: string;
}

function App() {
  const [data, setData] = useState<AggregatedData | null>(null);

  const [loading, setLoading] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);

  // Dark Mode State - Default to true
  const [darkMode, setDarkMode] = useState(true);

  // Tab State
  const [activeTab, setActiveTab] = useState<"sort" | "earnings">("sort");

  // Checklist State: Key = "rowName_size", Value = count done
  const [checkedCells, setCheckedCells] = useState<Record<string, number>>({});

  // Earnings Settings - Strings to allow clean editing (empty state)
  const [shopifyPercent, setShopifyPercent] = useState<string>("2.9");
  const [shopifyFixed, setShopifyFixed] = useState<string>("0.30");
  const [blankCosts, setBlankCosts] = useState<string>("0");
  const [shippingCost, setShippingCost] = useState<string>("0");

  // Filter & Sort State (Sort Order System)
  const [sortField, setSortField] = useState<"name" | "total">("name");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  // Earnings Sort State
  const [earningsSortField, setEarningsSortField] = useState<
    "date" | "earnings"
  >("date");
  const [earningsSortDirection, setEarningsSortDirection] = useState<
    "asc" | "desc"
  >("desc");

  // Init flag to prevent overwriting local storage on initial mount
  const [isInitialized, setIsInitialized] = useState(false);

  // Helper to safely get count handling legacy boolean
  const getCellCount = (rowName: string, size: string, totalQty: number) => {
    const key = `${rowName}_${size}`;
    const val = checkedCells[key];
    // Handle legacy boolean true -> totalQty, false -> 0 (from old saves)
    if (val === (true as unknown)) return totalQty;
    if (typeof val === "number") return val;
    return 0;
  };

  // Load from LocalStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const parsed: any = JSON.parse(saved); // Use any to relax strict type checking during load

        // Restore Date objects in data.orders
        if (parsed.data) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          parsed.data.orders = parsed.data.orders.map((o: any) => ({
            ...o,
            date: new Date(o.date),
          }));
        }

        setData(parsed.data);
        setFileName(parsed.fileName);
        setDarkMode(parsed.darkMode); // Restore theme preference
        setCheckedCells(parsed.checkedCells || {});
        setActiveTab(parsed.activeTab || "sort");
        if (parsed.shopifyPercent !== undefined)
          setShopifyPercent(parsed.shopifyPercent.toString());
        if (parsed.shopifyFixed !== undefined)
          setShopifyFixed(parsed.shopifyFixed.toString());
        if (parsed.blankCosts !== undefined)
          setBlankCosts(parsed.blankCosts.toString());
        if (parsed.shippingCost !== undefined)
          setShippingCost(parsed.shippingCost.toString());
      } catch (e) {
        console.error("Failed to load local storage", e);
      }
    }
    setIsInitialized(true);
  }, []); // Only run once on mount

  // Save to LocalStorage on change
  useEffect(() => {
    if (!isInitialized) return;

    // Debounce save slightly if needed, but for now direct save is okay for small data.
    const toSave: PersistedState = {
      data,
      fileName,
      darkMode,
      checkedCells,
      activeTab,
      shopifyPercent,
      shopifyFixed,
      blankCosts,
      shippingCost,
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
    } catch (e) {
      console.warn("Storage quota exceeded or error", e);
    }
  }, [
    data,
    fileName,
    darkMode,
    checkedCells,
    activeTab,
    shopifyPercent,
    shopifyFixed,
    blankCosts,
    shippingCost,
    isInitialized,
  ]);

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [darkMode]);

  const toggleDarkMode = () => {
    setDarkMode(!darkMode);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    processFile(file);
    // Reset file input so same file can be selected again if needed
    e.target.value = "";
  };

  const processFile = async (file: File) => {
    setLoading(true);
    setFileName(file.name);
    try {
      const { items, orders } = await parseCSV(file);
      const aggregated = aggregateData(items, orders); // Pass orders
      setData(aggregated);
      // We do NOT clear checkedCells here automatically, to allow keeping progress if re-uploading same file.
      // But if it's a totally different file, keys might mismatch. That's acceptable behavior for now.
    } catch (err) {
      console.error(err);
      alert("Error parsing CSV");
    } finally {
      setLoading(false);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  };
  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) =>
    e.preventDefault();

  const toggleCellCheck = (
    rowKey: string,
    size: string,
    totalQty: number,
    delta: number,
  ) => {
    const key = `${rowKey}_${size}`;
    setCheckedCells((prev) => {
      // Resolve current numeric value
      const currentVal = prev[key];
      let current = 0;
      if (typeof currentVal === "number") current = currentVal;
      else if (currentVal === (true as unknown)) current = totalQty;

      let next = current + delta;
      if (next > totalQty) next = totalQty; // Cap at max
      if (next < 0) next = 0; // Cap at min

      // Return updated state
      return {
        ...prev,
        [key]: next,
      };
    });
  };

  // Processing logic for View 1 (Sort Order)
  const getProcessedProducts = useCallback(() => {
    if (!data) return [];

    // Convert to array
    const entries = Object.entries(data.products).map(([name, sizes]) => ({
      name,
      sizes,
      total: ORDERED_SIZES_KEYS.reduce(
        (acc, size) => acc + (sizes[size] || 0),
        0,
      ),
    }));

    // Sort
    entries.sort((a, b) => {
      let cmp = 0;
      if (sortField === "name") {
        cmp = a.name.localeCompare(b.name);
      } else {
        cmp = a.total - b.total;
      }
      return sortDirection === "asc" ? cmp : -cmp;
    });

    return entries;
  }, [data, sortField, sortDirection]);

  // Export Logic
  const exportData = (withProgress: boolean) => {
    if (!data) return;

    const processed = getProcessedProducts();

    // Header
    // If withProgress, let's format it as "Qty (Done)" or similar?
    // Or just export the raw data.
    // User asked for "a blank" and "with checked items".
    // Blank = just the counts.
    // Checked = counts + indication of what's done.
    // Let's modify the values in the CSV cells if withProgress is true.

    let csvContent = "data:text/csv;charset=utf-8,";
    const header = ["Product / Color", ...ORDERED_SIZES_KEYS, "Total"];
    csvContent += header.join(",") + "\n";

    processed.forEach((item) => {
      const rowData = [item.name.replace(/,/g, "")]; // Simple escape

      ORDERED_SIZES_KEYS.forEach((size) => {
        const qty = item.sizes[size] || 0;
        let cellVal = qty.toString();

        if (withProgress && qty > 0) {
          const key = `${item.name}_${size}`;
          // Get count using direct lookup or legacy bool handling logic (duplicated here for simplicity or use helper)
          const val = checkedCells[key];
          let count = 0;
          if (typeof val === "number") count = val;
          else if (val === (true as unknown)) count = qty;

          if (count >= qty) {
            cellVal = `DONE (${qty})`;
          } else if (count > 0) {
            cellVal = `${count} / ${qty}`;
          }
        }

        // CSV Injection protection / formatting
        rowData.push(cellVal);
      });

      rowData.push(item.total.toString());
      csvContent += rowData.join(",") + "\n";
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute(
      "download",
      `xponline_inventory_${withProgress ? "progress" : "blank"}.csv`,
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Processing logic for View 2 (Earnings)
  const getProcessedOrders = useCallback(() => {
    if (!data) return [];

    const currentShopifyPercent = parseFloat(shopifyPercent) || 0;
    const currentShopifyFixed = parseFloat(shopifyFixed) || 0;

    // Merge with shipping data if available
    const orders = data.orders.map((o) => {
      // Calculate Shopify Fee: (Total * % + Fixed)
      const shopifyFeeVal =
        o.total * (currentShopifyPercent / 100) + currentShopifyFixed;

      return {
        ...o,
        // Net per order (pre-global expenses like shipping/blanks)
        // Just deducting per-transaction fees here clearly
        shopifyFee: shopifyFeeVal,
        netAfterFees: o.subtotal - shopifyFeeVal, // Used for sorting or display
      };
    });

    // Sort
    orders.sort((a, b) => {
      let cmp = 0;
      if (earningsSortField === "date") {
        cmp = a.date.getTime() - b.date.getTime();
      } else {
        cmp = a.netAfterFees - b.netAfterFees;
      }
      return earningsSortDirection === "asc" ? cmp : -cmp;
    });

    return orders;
  }, [
    data,
    earningsSortField,
    earningsSortDirection,
    shopifyPercent,
    shopifyFixed,
  ]);

  // Quick View Stats Calculation
  const getQuickStats = () => {
    if (!data) return null;

    const processed = getProcessedProducts();
    const uniqueProducts = processed.length;
    const totalItems = data.grandTotal;

    const topProduct = processed.reduce(
      (prev, current) => (prev.total > current.total ? prev : current),
      processed[0] || { name: "-", total: 0 },
    );

    const colorEntries = Object.entries(data.colorTotals).map(
      ([color, sizes]) => ({
        color,
        total: ORDERED_SIZES_KEYS.reduce((acc, s) => acc + (sizes[s] || 0), 0),
      }),
    );
    const topColor = colorEntries.reduce(
      (prev, current) => (prev.total > current.total ? prev : current),
      colorEntries[0] || { color: "-", total: 0 },
    );

    return { uniqueProducts, totalItems, topProduct, topColor };
  };

  const getEarningsStats = (orders: ReturnType<typeof getProcessedOrders>) => {
    // According to user:
    // "add up subtotal" -> totalSubtotal
    // "input shipping + shopify + blank, then subtract from subtotal" -> net

    const currentShippingCost = parseFloat(shippingCost) || 0;
    const currentBlankCosts = parseFloat(blankCosts) || 0;

    // We sum existing per-order calculations
    const totalSubtotal = orders.reduce((acc, o) => acc + o.subtotal, 0);
    const totalShopify = orders.reduce((acc, o) => acc + o.shopifyFee, 0);

    // Net = Subtotal - Shipping(Global) - Shopify - Blanks(Global)
    const netProfit =
      totalSubtotal - currentShippingCost - totalShopify - currentBlankCosts;

    return {
      totalSubtotal,
      totalShipping: currentShippingCost,
      totalShopify,
      netProfit,
      totalBlank: currentBlankCosts,
    };
  };

  const getProgressStats = () => {
    if (!data) return { checkedCount: 0, totalCount: 0, percent: 0 };

    let checkedCount = 0;
    const totalCount = data.grandTotal;

    Object.entries(data.products).forEach(([name, sizes]) => {
      ORDERED_SIZES_KEYS.forEach((size) => {
        const qty = sizes[size] || 0;
        if (qty > 0) {
          const key = `${name}_${size}`;
          const val = checkedCells[key];
          let done = 0;
          if (typeof val === "number") done = val;
          else if (val === (true as unknown)) done = qty;

          checkedCount += Math.min(done, qty);
        }
      });
    });

    return {
      checkedCount,
      totalCount,
      percent: totalCount > 0 ? (checkedCount / totalCount) * 100 : 0,
    };
  };

  const stats = getQuickStats();
  const earningsStats = data ? getEarningsStats(getProcessedOrders()) : null;
  const progressStats = getProgressStats();

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 font-sans p-8 transition-colors duration-200">
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white">
              xponline Auto Systems
            </h1>
            <p className="text-gray-500 dark:text-gray-400 mt-1">
              Management Dashboard
            </p>
          </div>
          <button
            onClick={toggleDarkMode}
            className="p-2 rounded-lg bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
            title="Toggle Theme"
          >
            {darkMode ? (
              /* Sun Icon */
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-6 w-6 text-yellow-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
                />
              </svg>
            ) : (
              /* Moon Icon */
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-6 w-6 text-gray-700"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
                />
              </svg>
            )}
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex space-x-4 border-b border-gray-200 dark:border-gray-700">
          <button
            onClick={() => setActiveTab("sort")}
            className={`py-3 px-6 font-medium text-sm transition-colors border-b-2 ${activeTab === "sort" ? "border-blue-500 text-blue-600 dark:text-blue-400" : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"}`}
          >
            Sort Order System
          </button>
          <button
            onClick={() => setActiveTab("earnings")}
            className={`py-3 px-6 font-medium text-sm transition-colors border-b-2 ${activeTab === "earnings" ? "border-blue-500 text-blue-600 dark:text-blue-400" : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"}`}
          >
            Auto Earnings Calculator
          </button>
        </div>

        {/* Global Loading */}
        {loading && (
          <div className="text-center py-12 text-gray-500 dark:text-gray-400 animate-pulse">
            Loading...
          </div>
        )}

        {/* TAB 1: Sort Order System */}
        {activeTab === "sort" && (
          <div className="space-y-8 animate-fade-in">
            {/* Upload (Only if no data) */}
            {!data && (
              <div
                className="bg-white dark:bg-gray-800 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-12 text-center hover:border-blue-500 dark:hover:border-blue-400 transition-colors cursor-pointer shadow-sm group"
                onDrop={handleDrop}
                onDragOver={handleDragOver}
              >
                <input
                  type="file"
                  accept=".csv"
                  onChange={handleFileUpload}
                  className="hidden"
                  id="fileInput"
                />
                <label
                  htmlFor="fileInput"
                  className="cursor-pointer w-full h-full block"
                >
                  <div className="space-y-2">
                    <div className="text-gray-600 dark:text-gray-300">
                      <span className="font-medium text-blue-600 dark:text-blue-400 hover:text-blue-500">
                        Upload Orders CSV
                      </span>{" "}
                      to start
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Drag & Drop or Click
                    </p>
                  </div>
                </label>
              </div>
            )}

            {data && stats && (
              <>
                {/* Quick View Cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                  <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700">
                    <div className="text-sm font-medium text-gray-500 dark:text-gray-400">
                      Total Items
                    </div>
                    <div className="mt-2 text-3xl font-bold text-gray-900 dark:text-white">
                      {stats.totalItems}
                    </div>
                  </div>
                  <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700">
                    <div className="text-sm font-medium text-gray-500 dark:text-gray-400">
                      Unique Products
                    </div>
                    <div className="mt-2 text-3xl font-bold text-gray-900 dark:text-white">
                      {stats.uniqueProducts}
                    </div>
                  </div>
                  <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700">
                    <div className="text-sm font-medium text-gray-500 dark:text-gray-400">
                      Top Selling Item
                    </div>
                    <div
                      className="mt-2 text-xl font-bold text-gray-900 dark:text-white truncate"
                      title={stats.topProduct?.name}
                    >
                      {stats.topProduct?.name || "-"}
                    </div>
                    <div className="text-sm text-green-600 dark:text-green-400 font-semibold">
                      {stats.topProduct?.total || 0} units
                    </div>
                  </div>
                  <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700">
                    <div className="text-sm font-medium text-gray-500 dark:text-gray-400">
                      Most Popular Color
                    </div>
                    <div className="mt-2 text-xl font-bold text-gray-900 dark:text-white capitalize">
                      {stats.topColor?.color || "-"}
                    </div>
                    <div className="text-sm text-green-600 dark:text-green-400 font-semibold">
                      {stats.topColor?.total || 0} units
                    </div>
                  </div>
                </div>

                {/* Progress Bar */}
                <div className="bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      Checklist Progress
                    </span>
                    <span className="text-sm font-bold text-gray-900 dark:text-white">
                      {progressStats.percent.toFixed(1)}% (
                      {progressStats.checkedCount} / {progressStats.totalCount})
                    </span>
                  </div>
                  <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5">
                    <div
                      className="bg-green-500 h-2.5 rounded-full transition-all duration-500 ease-out shadow-[0_0_10px_rgba(34,197,94,0.5)]"
                      style={{ width: `${progressStats.percent}%` }}
                    ></div>
                  </div>
                </div>

                {/* Controls */}
                <div className="flex flex-wrap gap-4 items-center bg-white dark:bg-gray-800 p-4 rounded-lg shadow border border-gray-200 dark:border-gray-700">
                  <div className="flex-1 flex flex-col md:flex-row md:items-center gap-2">
                    {fileName && (
                      <span className="text-sm text-gray-500 font-mono text-ellipsis overflow-hidden whitespace-nowrap max-w-[200px]">
                        {fileName}
                      </span>
                    )}
                    <label className="text-xs text-blue-600 dark:text-blue-400 cursor-pointer hover:underline border border-blue-200 dark:border-blue-800 px-3 py-1.5 rounded bg-blue-50 dark:bg-blue-900/30 text-center">
                      Change Source
                      <input
                        type="file"
                        accept=".csv"
                        onChange={handleFileUpload}
                        className="hidden"
                      />
                    </label>
                  </div>

                  {/* Exports */}
                  <div className="flex gap-2 border-r border-gray-200 dark:border-gray-700 pr-4 mr-2">
                    <button
                      onClick={() => exportData(false)}
                      className="px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-gray-700 rounded hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                    >
                      Export Clean
                    </button>
                    <button
                      onClick={() => exportData(true)}
                      className="px-3 py-1.5 text-xs font-medium text-white bg-green-600 rounded hover:bg-green-700 transition-colors shadow-sm"
                    >
                      Export Progress
                    </button>
                  </div>

                  <div>
                    <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mr-2">
                      Sort By
                    </label>
                    <select
                      className="p-2 border border-gray-300 dark:border-gray-600 rounded bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white outline-none"
                      value={sortField}
                      onChange={(e) =>
                        setSortField(e.target.value as "name" | "total")
                      }
                    >
                      <option value="name">Name</option>
                      <option value="total">Total Quantity</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mr-2">
                      Order
                    </label>
                    <select
                      className="p-2 border border-gray-300 dark:border-gray-600 rounded bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white outline-none"
                      value={sortDirection}
                      onChange={(e) =>
                        setSortDirection(e.target.value as "asc" | "desc")
                      }
                    >
                      <option value="asc">Ascending</option>
                      <option value="desc">Descending</option>
                    </select>
                  </div>
                </div>

                {/* DROP STUFF TABLE */}
                <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700">
                  <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
                    <h2 className="text-lg font-semibold text-gray-800 dark:text-white">
                      Items Breakdown
                    </h2>
                    <p className="text-xs text-gray-500 mt-1">
                      Left-click to add (+1), Right-click to remove (-1).
                    </p>
                  </div>
                  <div>
                    <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 relative">
                      <thead className="bg-gray-100 dark:bg-gray-700">
                        <tr>
                          <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 dark:text-gray-300 uppercase tracking-wider sticky left-0 top-0 bg-gray-100 dark:bg-gray-700 z-30 w-1/3 shadow-[1px_0_0_0_rgba(0,0,0,0.05)] dark:shadow-none">
                            Product / Color
                          </th>
                          {ORDERED_SIZES_KEYS.map((size) => (
                            <th
                              key={size}
                              className="px-6 py-3 text-center text-xs font-bold text-gray-500 dark:text-gray-300 uppercase tracking-wider w-24 sticky top-0 bg-gray-100 dark:bg-gray-700 z-20"
                            >
                              {size}
                            </th>
                          ))}
                          <th className="px-6 py-3 text-center text-xs font-bold text-gray-500 dark:text-gray-300 uppercase tracking-wider w-24 sticky top-0 bg-gray-100 dark:bg-gray-700 z-20">
                            Total
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                        {getProcessedProducts().map((item, idx) => (
                          <tr
                            key={item.name}
                            className={
                              idx % 2 === 0
                                ? "bg-white dark:bg-gray-800"
                                : "bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600"
                            }
                          >
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-100 sticky left-0 bg-inherit border-r border-gray-100 dark:border-gray-700 shadow-[1px_0_0_0_rgba(0,0,0,0.05)] dark:shadow-none">
                              {item.name}
                            </td>
                            {ORDERED_SIZES_KEYS.map((size) => {
                              const qty = item.sizes[size] || 0;
                              const current = getCellCount(
                                item.name,
                                size,
                                qty,
                              );
                              const hasQty = qty > 0;
                              const isMax = current >= qty;
                              const isPartial = current > 0 && current < qty;

                              return (
                                <td
                                  key={size}
                                  onClick={(e) => {
                                    if (!hasQty) return;
                                    e.preventDefault();
                                    toggleCellCheck(item.name, size, qty, 1);
                                  }}
                                  onContextMenu={(e) => {
                                    if (!hasQty) return;
                                    e.preventDefault();
                                    toggleCellCheck(item.name, size, qty, -1);
                                  }}
                                  className={`px-6 py-4 whitespace-nowrap text-sm text-center relative transition-all duration-200 select-none
                                                ${
                                                  hasQty
                                                    ? "cursor-pointer " +
                                                      (isMax
                                                        ? "bg-green-100 dark:!bg-green-900/40 text-green-700 dark:!text-green-300 font-semibold"
                                                        : isPartial
                                                          ? "bg-yellow-50 dark:!bg-yellow-900/20 text-yellow-700 dark:!text-yellow-400 font-medium"
                                                          : "font-bold text-blue-600 dark:!text-blue-400 bg-blue-50 dark:!bg-blue-900/20 hover:bg-blue-100 dark:hover:!bg-blue-800/30")
                                                    : "text-gray-300 dark:text-gray-600 cursor-default"
                                                }
                                            `}
                                  title={
                                    hasQty
                                      ? "Click buttons or Cell (+1 Left, -1 Right click)"
                                      : ""
                                  }
                                >
                                  <div className="flex items-center justify-center gap-2">
                                    {hasQty && (
                                      <div className="flex items-center gap-1.5 z-10">
                                        {/* Visual Decrement */}
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            toggleCellCheck(
                                              item.name,
                                              size,
                                              qty,
                                              -1,
                                            );
                                          }}
                                          className="w-5 h-5 flex items-center justify-center rounded bg-white/50 hover:bg-red-200 text-red-600 dark:bg-black/20 dark:hover:bg-red-900/50 dark:text-red-400 text-xs font-bold transition-colors shadow-sm"
                                          aria-label="Decrease"
                                        >
                                          -
                                        </button>

                                        <div className="flex items-center gap-1 select-none pointer-events-none">
                                          <span
                                            className={
                                              isMax
                                                ? "line-through text-green-700/50 dark:text-green-300/50 text-xs"
                                                : ""
                                            }
                                          >
                                            {current}
                                          </span>
                                          <span className="text-gray-400 text-xs">
                                            /
                                          </span>
                                          <span>{qty}</span>
                                        </div>

                                        {/* Visual Increment */}
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            toggleCellCheck(
                                              item.name,
                                              size,
                                              qty,
                                              1,
                                            );
                                          }}
                                          className="w-5 h-5 flex items-center justify-center rounded bg-white/50 hover:bg-blue-200 text-blue-600 dark:bg-black/20 dark:hover:bg-blue-900/50 dark:text-blue-400 text-xs font-bold transition-colors shadow-sm"
                                          aria-label="Increase"
                                        >
                                          +
                                        </button>
                                      </div>
                                    )}
                                    {!hasQty && <span>-</span>}
                                  </div>
                                </td>
                              );
                            })}
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-center font-bold text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-700">
                              {item.total}
                            </td>
                          </tr>
                        ))}
                        {/* Totals Row */}
                        <tr className="bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-white font-bold border-t-2 border-gray-200 dark:border-gray-700">
                          <td className="px-6 py-4 whitespace-nowrap text-sm sticky left-0 bg-gray-100 dark:bg-gray-900 shadow-[1px_0_0_0_rgba(0,0,0,0.1)] dark:shadow-[1px_0_0_0_rgba(255,255,255,0.1)]">
                            TOTALS
                          </td>
                          {ORDERED_SIZES_KEYS.map((size) => (
                            <td
                              key={size}
                              className="px-6 py-4 whitespace-nowrap text-sm text-center"
                            >
                              {data.totals[size]}
                            </td>
                          ))}
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-center text-green-400">
                            {data.grandTotal}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* WHAT TO ORDER TABLE */}
                <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700">
                  <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 flex justify-between items-center">
                    <h2 className="text-lg font-semibold text-gray-800 dark:text-white">
                      What to Order (By Color)
                    </h2>
                  </div>
                  <div>
                    <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 relative">
                      <thead className="bg-gray-100 dark:bg-gray-700">
                        <tr>
                          <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 dark:text-gray-300 uppercase tracking-wider sticky left-0 top-0 bg-gray-100 dark:bg-gray-700 z-30 w-1/3 shadow-[1px_0_0_0_rgba(0,0,0,0.05)] dark:shadow-none">
                            Color Family
                          </th>
                          {ORDERED_SIZES_KEYS.map((size) => (
                            <th
                              key={size}
                              className="px-6 py-3 text-center text-xs font-bold text-gray-500 dark:text-gray-300 uppercase tracking-wider w-24 sticky top-0 bg-gray-100 dark:bg-gray-700 z-20"
                            >
                              {size}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                        {Object.entries(data.colorTotals)
                          .sort()
                          .map(([color, sizes], idx) => (
                            <tr
                              key={color}
                              className={
                                idx % 2 === 0
                                  ? "bg-white dark:bg-gray-800"
                                  : "bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600"
                              }
                            >
                              <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-100 capitalize sticky left-0 bg-inherit border-r border-gray-100 dark:border-gray-700 shadow-[1px_0_0_0_rgba(0,0,0,0.05)] dark:shadow-none">
                                {color}
                              </td>
                              {ORDERED_SIZES_KEYS.map((size) => (
                                <td
                                  key={size}
                                  className={`px-6 py-4 whitespace-nowrap text-sm text-center ${
                                    sizes[size] > 0
                                      ? "font-bold text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20"
                                      : "text-gray-300 dark:text-gray-600"
                                  }`}
                                >
                                  {sizes[size] || "-"}
                                </td>
                              ))}
                            </tr>
                          ))}
                        <tr className="bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-white font-bold border-t-2 border-gray-200 dark:border-gray-700">
                          <td className="px-6 py-4 whitespace-nowrap text-sm sticky left-0 bg-gray-100 dark:bg-gray-900 shadow-[1px_0_0_0_rgba(0,0,0,0.1)] dark:shadow-[1px_0_0_0_rgba(255,255,255,0.1)]">
                            TOTALS
                          </td>
                          {ORDERED_SIZES_KEYS.map((size) => (
                            <td
                              key={size}
                              className="px-6 py-4 whitespace-nowrap text-sm text-center"
                            >
                              {data.totals[size]}
                            </td>
                          ))}
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* TAB 2: Earnings Calculator */}
        {activeTab === "earnings" && (
          <div className="space-y-8 animate-fade-in">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {/* Input 1: Main Orders */}
              <div className="bg-white dark:bg-gray-800 p-6 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm relative">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                  Step 1: Orders Data
                </h3>
                {data ? (
                  <div>
                    <div className="text-sm text-green-600 dark:text-green-400 font-medium flex items-center mb-2">
                      <svg
                        className="w-5 h-5 mr-2"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                          d="M5 13l4 4L19 7"
                        ></path>
                      </svg>
                      Loaded from {fileName} ({data.orders.length} orders)
                    </div>
                    <label className="text-xs text-blue-600 dark:text-blue-400 cursor-pointer hover:underline">
                      Change Source
                      <input
                        type="file"
                        accept=".csv"
                        onChange={handleFileUpload}
                        className="hidden"
                      />
                    </label>
                  </div>
                ) : (
                  <div className="text-sm text-gray-500">
                    Please upload the orders CSV in the first tab or here.
                    <div className="mt-4">
                      <input
                        type="file"
                        accept=".csv"
                        onChange={handleFileUpload}
                        className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 dark:file:bg-gray-700 dark:file:text-gray-300"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Input 2: Shipping Orders -> Replaced with Manual Input */}
              <div className="bg-white dark:bg-gray-800 p-6 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                  Step 2: Shipping Cost
                </h3>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Total Shipping Cost ($)
                </label>
                <input
                  type="text"
                  value={shippingCost}
                  onChange={(e) => {
                    // Allow typing numbers or dots, or empty
                    const val = e.target.value;
                    if (val === "" || /^\d*\.?\d*$/.test(val)) {
                      setShippingCost(val);
                    }
                  }}
                  onBlur={() => {
                    if (shippingCost === "" || shippingCost === ".")
                      setShippingCost("0");
                  }}
                  className="w-full p-2 rounded border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                  placeholder="0.00"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Total combined shipping cost for this batch (labels etc)
                </p>
              </div>
            </div>

            {/* Step 3: Cost Configuration */}
            <div className="bg-white dark:bg-gray-800 p-6 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                Step 3: Cost Constraints
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Total Blank Costs ($)
                  </label>
                  <input
                    type="text"
                    value={blankCosts}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === "" || /^\d*\.?\d*$/.test(val))
                        setBlankCosts(val);
                    }}
                    onBlur={() => {
                      if (blankCosts === "" || blankCosts === ".")
                        setBlankCosts("0");
                    }}
                    className="w-full p-2 rounded border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                    placeholder="0.00"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Total COGS for this batch
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Shopify Fee (%)
                  </label>
                  <input
                    type="text"
                    value={shopifyPercent}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === "" || /^\d*\.?\d*$/.test(val))
                        setShopifyPercent(val);
                    }}
                    onBlur={() => {
                      if (shopifyPercent === "" || shopifyPercent === ".")
                        setShopifyPercent("0");
                    }}
                    className="w-full p-2 rounded border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">Default: 2.9%</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Shopify Fixed Fee ($)
                  </label>
                  <input
                    type="text"
                    value={shopifyFixed}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === "" || /^\d*\.?\d*$/.test(val))
                        setShopifyFixed(val);
                    }}
                    onBlur={() => {
                      if (shopifyFixed === "" || shopifyFixed === ".")
                        setShopifyFixed("0");
                    }}
                    className="w-full p-2 rounded border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">Default: $0.30</p>
                </div>
              </div>
            </div>

            {/* Aggregated Earnings Table & Stats */}
            {data && (
              <>
                {/* Earnings Stats */}
                {earningsStats && (
                  <div className="bg-white dark:bg-gray-800 rounded-xl overflow-hidden shadow border border-gray-200 dark:border-gray-700">
                    <div className="bg-gray-50 dark:bg-gray-700 px-6 py-4 border-b border-gray-200 dark:border-gray-600">
                      <h3 className="font-semibold text-gray-800 dark:text-white">
                        Financial Summary
                      </h3>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-5 divide-y md:divide-y-0 md:divide-x divide-gray-200 dark:divide-gray-600">
                      {/* Subtotal */}
                      <div className="p-6 text-center">
                        <div className="text-xs font-medium uppercase text-gray-500 dark:text-gray-400 mb-1">
                          Total Subtotal
                        </div>
                        <div className="text-2xl font-bold text-gray-900 dark:text-white">
                          ${earningsStats.totalSubtotal.toFixed(2)}
                        </div>
                      </div>
                      {/* Shipping */}
                      <div className="p-6 text-center bg-red-50/50 dark:bg-red-900/10">
                        <div className="text-xs font-medium uppercase text-gray-500 dark:text-gray-400 mb-1">
                          - Shipping Cost
                        </div>
                        <div className="text-xl font-bold text-red-600 dark:text-red-400">
                          ${earningsStats.totalShipping.toFixed(2)}
                        </div>
                      </div>
                      {/* Shopify */}
                      <div className="p-6 text-center bg-red-50/50 dark:bg-red-900/10">
                        <div className="text-xs font-medium uppercase text-gray-500 dark:text-gray-400 mb-1">
                          - Shopify Key
                        </div>
                        <div className="text-xl font-bold text-red-600 dark:text-red-400">
                          ${earningsStats.totalShopify.toFixed(2)}
                        </div>
                      </div>
                      {/* Blanks */}
                      <div className="p-6 text-center bg-red-50/50 dark:bg-red-900/10">
                        <div className="text-xs font-medium uppercase text-gray-500 dark:text-gray-400 mb-1">
                          - Blank Cost
                        </div>
                        <div className="text-xl font-bold text-red-600 dark:text-red-400">
                          ${parseFloat(blankCosts || "0").toFixed(2)}
                        </div>
                      </div>
                      {/* Total Profit */}
                      <div className="p-6 text-center bg-green-50/50 dark:bg-green-900/10">
                        <div className="text-xs font-medium uppercase text-gray-500 dark:text-gray-400 mb-1">
                          Net Earning
                        </div>
                        <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                          ${earningsStats.netProfit.toFixed(2)}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Filters */}
                <div className="flex flex-wrap gap-4 items-center bg-white dark:bg-gray-800 p-4 rounded-lg shadow border border-gray-200 dark:border-gray-700 justify-end">
                  <div>
                    <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mr-2">
                      Sort By
                    </label>
                    <select
                      className="p-2 border border-gray-300 dark:border-gray-600 rounded bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white outline-none"
                      value={earningsSortField}
                      onChange={(e) =>
                        setEarningsSortField(
                          e.target.value as "date" | "earnings",
                        )
                      }
                    >
                      <option value="date">Date</option>
                      <option value="earnings">Net Earnings</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mr-2">
                      Order
                    </label>
                    <select
                      className="p-2 border border-gray-300 dark:border-gray-600 rounded bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white outline-none"
                      value={earningsSortDirection}
                      onChange={(e) =>
                        setEarningsSortDirection(
                          e.target.value as "asc" | "desc",
                        )
                      }
                    >
                      <option value="asc">Ascending</option>
                      <option value="desc">Descending</option>
                    </select>
                  </div>
                </div>

                {/* Table */}
                <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700">
                  <div>
                    <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 relative">
                      <thead className="bg-gray-100 dark:bg-gray-700 sticky top-0 z-10 shadow-sm">
                        <tr>
                          <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                            Date
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                            Order
                          </th>
                          <th className="px-6 py-3 text-right text-xs font-bold text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                            Revenue
                          </th>
                          <th className="px-6 py-3 text-right text-xs font-bold text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                            Shipping Cost
                          </th>
                          <th className="px-6 py-3 text-right text-xs font-bold text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                            Net Earnings
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                        {getProcessedOrders().map((order, idx) => (
                          <tr
                            key={order.name}
                            className={
                              idx % 2 === 0
                                ? "bg-white dark:bg-gray-800"
                                : "bg-gray-50 dark:bg-gray-700"
                            }
                          >
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
                              {order.date.toLocaleDateString()}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">
                              {order.name}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-600 dark:text-gray-300">
                              ${order.total.toFixed(2)}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-red-500 dark:text-red-400">
                              {order.shippingCost > 0
                                ? `-$${order.shippingCost.toFixed(2)}`
                                : "-"}
                            </td>
                            <td
                              className={`px-6 py-4 whitespace-nowrap text-sm text-right font-bold ${order.netEarnings >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}
                            >
                              ${order.netEarnings.toFixed(2)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
