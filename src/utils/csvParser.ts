import Papa from "papaparse";

export interface CSVRow {
  "Lineitem quantity": string;
  "Lineitem name": string;
  Name: string; // Order #
  "Created at": string;
  Total: string;
  Subtotal: string;
  [key: string]: string;
}

export interface ParsedItem {
  id: string; // generated unique id for key
  productName: string;
  color: string;
  size: string;
  quantity: number;
}

export interface Order {
  id: string;
  name: string; // #1234
  date: Date;
  total: number;
  subtotal: number;
  shippingCost: number; // To be filled from second CSV
  netEarnings: number;
}

export interface AggregatedData {
  products: Record<string, Record<string, number>>; // Key: "Product - Color", Value: { "XS": 0, "SMALL": 5 ... }
  colorTotals: Record<string, Record<string, number>>; // Key: "black", "white", etc.
  totals: Record<string, number>; // Key: Size, Value: total count
  grandTotal: number;
  orders: Order[]; // Aggregated unique orders
}

const SIZE_MAPPING: Record<string, string> = {
  XS: "XS",
  XSMALL: "XS",

  S: "SMALL",
  SMALL: "SMALL",
  SM: "SMALL",

  M: "MEDIUM",
  MEDIUM: "MEDIUM",
  MD: "MEDIUM",

  L: "LARGE",
  LARGE: "LARGE",
  LG: "LARGE",

  XL: "XL",
  XLARGE: "XL",

  "2XL": "2XL",
  XXL: "2XL",
  "2X": "2XL",
  XXXL: "3XL",
  "3XL": "3XL",
  "3X": "3XL",
};

const ORDERED_SIZES = ["XS", "SMALL", "MEDIUM", "LARGE", "XL", "2XL", "3XL"];

// Helper to categorize colors into families
const detectColorFamily = (color: string): string => {
  const lower = color.toLowerCase();

  // Specific mappings based on images/data
  if (lower.includes("black")) return "black";
  if (lower.includes("white")) return "white";
  if (lower.includes("brown")) return "brown";
  if (lower.includes("storm")) return "storm";
  if (lower.includes("blue")) return "blue";

  return color; // Fallback
};

export const parseCSV = (
  file: File,
): Promise<{ items: ParsedItem[]; orders: Order[] }> => {
  return new Promise((resolve, reject) => {
    Papa.parse<CSVRow>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const items: ParsedItem[] = [];
        const ordersMap = new Map<string, Order>();

        results.data.forEach((row, index) => {
          // 1. Parse Line Items
          const quantity = parseInt(row["Lineitem quantity"], 10);
          const rawName = row["Lineitem name"];

          if (rawName && !isNaN(quantity)) {
            // Name Parsing
            const parts = rawName.split(" - ");
            let productName = rawName;
            let color = "Unknown";
            let size = "Unknown";

            if (parts.length >= 2) {
              const suffix = parts.pop()!;
              productName = parts.join(" - ");

              const suffixParts = suffix.split("/").map((s) => s.trim());

              if (suffixParts.length === 2) {
                const [partA, partB] = suffixParts;
                const sizeA = normalizeSize(partA);
                const sizeB = normalizeSize(partB);

                if (sizeA) {
                  size = sizeA;
                  color = partB;
                } else if (sizeB) {
                  size = sizeB;
                  color = partA;
                } else {
                  color = suffix;
                }
              } else {
                const s = normalizeSize(suffix);
                if (s) {
                  size = s;
                  color = "Standard";
                } else {
                  color = suffix;
                  size = "One Size"; // Assumption
                }
              }
            }

            items.push({
              id: `${index}-${rawName}`,
              productName,
              color,
              size,
              quantity,
            });
          }

          // 2. Parse Order Info (Unique by Name/ID)
          const orderName = row["Name"];
          if (orderName && !ordersMap.has(orderName)) {
            // Only processed rows that are actual order headers usually have the Total.
            // In Shopify CSVs, the first row of an order has the financial info, subsequent rows (line items) often have empty Total/Date.
            // BUT, sometimes they are filled. We should check if Total is present.
            // Based on the user's provided CSV snippet:
            // #1238, ..., 35.8, ...
            // The subsequent lines for multi-item orders might be empty or not.
            // In the snippet provided: #1239 has 2 lines.
            // Line 1: 12/26/2025 18:48, ..., 66.81 (Total)
            // Line 2: Empty date, Empty Total.
            // So valid row is the one with 'Created at' or 'Total'.

            if (row["Created at"]) {
              const total = parseFloat(row["Total"] || "0");
              const subtotal = parseFloat(row["Subtotal"] || "0");
              ordersMap.set(orderName, {
                id: orderName,
                name: orderName,
                date: new Date(row["Created at"]),
                total,
                subtotal,
                shippingCost: 0,
                netEarnings: total, // Initial net is total until shipping is subtracted
              });
            }
          }
        });

        resolve({ items, orders: Array.from(ordersMap.values()) });
      },
      error: (err) => {
        reject(err);
      },
    });
  });
};

// Parser for the "Shipping Costs" file
export interface ShippingRow {
  [key: string]: string;
}
export const parseShippingCSV = (file: File): Promise<Map<string, number>> => {
  return new Promise((resolve, reject) => {
    Papa.parse<ShippingRow>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const costs = new Map<string, number>();
        // We need to guess the columns or use standard ones.
        // Common Shopify "Shipping labels" export columns: "Order", "Cost", "Price", "Amount"
        // The user PDF link suggests "shipping_charges" report.
        // Assuming columns: "Order name" or "Order", and "Shipping charge" or "Cost".
        // Let's try to detect.

        // If the user uses the "Shipping labels" export from Shopify (Orders -> Shipping Labels -> Export),
        // it might look different.
        // Re-reading user request: "The only real shipping price is from the shipping labels that I buy per order...
        // Shopify analytics reports has a place called “Shipping charges by order id”".

        // Let's assume the user exports that report.
        // Typical Headers in Report Export: "Order id", "Order name", "Shipping charge", "Date".

        const headers = results.meta.fields || [];
        // Find "Order name" or "Order" or "Name"
        const nameKey = headers.find((h) =>
          /order\s*name|order\s*id|name/i.test(h),
        );
        // Find cost key
        const costKey = headers.find((h) =>
          /shipping\s*charge|cost|amount|price|label/i.test(h),
        );

        if (!nameKey || !costKey) {
          console.warn("Could not auto-detect fields", headers);
          // Fallback to manual check of first row if needed, or just reject?
          // Let's look for any column with '#' in values for Name?
          // For now, partial resolve.
        }

        results.data.forEach((row) => {
          const name = nameKey ? row[nameKey] : "";
          const costVal = costKey ? row[costKey] : "0";

          if (name && costVal) {
            // Normalize Name: "#1234" vs "1234"
            // Store normalized (with #)
            let normalizedName = name.trim();
            if (!normalizedName.startsWith("#"))
              normalizedName = "#" + normalizedName;

            const cost = parseFloat(costVal.replace(/[^0-9.-]+/g, ""));
            if (!isNaN(cost)) {
              costs.set(normalizedName, cost);
            }
          }
        });
        resolve(costs);
      },
      error: reject,
    });
  });
};

const normalizeSize = (str: string): string | null => {
  if (!str) return null;
  const upper = str.toUpperCase();
  if (SIZE_MAPPING[upper]) return SIZE_MAPPING[upper];
  return null;
};

export const aggregateData = (
  items: ParsedItem[],
  orders: Order[],
): AggregatedData => {
  const products: Record<string, Record<string, number>> = {};
  const colorTotals: Record<string, Record<string, number>> = {};
  const totals: Record<string, number> = {};
  let grandTotal = 0;

  ORDERED_SIZES.forEach((s) => (totals[s] = 0));

  items.forEach((item) => {
    if (!ORDERED_SIZES.includes(item.size)) return; // Only aggregate standard sizes in this grid

    const rowKey = `${item.productName} - ${item.color}`;

    // Product Row
    if (!products[rowKey]) {
      products[rowKey] = {};
      ORDERED_SIZES.forEach((s) => (products[rowKey][s] = 0));
    }
    products[rowKey][item.size] += item.quantity;

    // Color Family Row
    const colorFamily = detectColorFamily(item.color);
    if (!colorTotals[colorFamily]) {
      colorTotals[colorFamily] = {};
      ORDERED_SIZES.forEach((s) => (colorTotals[colorFamily][s] = 0));
    }
    colorTotals[colorFamily][item.size] += item.quantity;

    // Totals
    totals[item.size] += item.quantity;
    grandTotal += item.quantity;
  });

  return { products, colorTotals, totals, grandTotal, orders };
};

export const ORDERED_SIZES_KEYS = ORDERED_SIZES;
