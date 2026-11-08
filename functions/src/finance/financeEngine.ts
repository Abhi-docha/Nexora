/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * NEXORA Enterprise Operations Cloud - Deterministic Financial Foundation Engine
 * Provides integer minor-unit arithmetic, GAAP-conscious formulas, and auditable metrics.
 */

export interface Money {
  cents: number;
  currency: string;
}

export interface RevenueTransaction {
  id: string;
  orgId: string;
  date: string;
  customerId?: string;
  customerName?: string;
  amountCents: number;
  currency: string;
  status: 'PAID' | 'PENDING' | 'REFUNDED' | 'VOID';
  isRecurring?: boolean;
  recurringInterval?: 'monthly' | 'annual';
  cogsCents?: number;
  description: string;
}

export interface ExpenseTransaction {
  id: string;
  orgId: string;
  date: string;
  vendorId?: string;
  vendorName?: string;
  category: string;
  amountCents: number;
  currency: string;
  paymentStatus: 'PAID' | 'PENDING' | 'CANCELLED';
  description: string;
}

export interface InvoiceRecord {
  id: string;
  invoiceNumber: string;
  orgId: string;
  customerId: string;
  customerName: string;
  issueDate: string;
  dueDate: string;
  totalAmountCents: number;
  paidAmountCents: number;
  currency: string;
  status: 'DRAFT' | 'SENT' | 'PAID' | 'OVERDUE' | 'CANCELLED';
  isRecurring?: boolean;
}

export interface BillRecord {
  id: string;
  billNumber: string;
  orgId: string;
  vendorId: string;
  vendorName: string;
  issueDate: string;
  dueDate: string;
  totalAmountCents: number;
  paidAmountCents: number;
  currency: string;
  status: 'PENDING' | 'PAID' | 'OVERDUE' | 'CANCELLED';
}

export interface CashAccountRecord {
  id: string;
  orgId: string;
  accountName: string;
  balanceCents: number;
  currency: string;
  lastReconciledAt?: string;
  isVerified: boolean;
}

export interface BudgetRecord {
  id: string;
  orgId: string;
  period: string;
  department: string;
  allocatedCents: number;
  spentCents: number;
  currency: string;
}

export interface FinancialMetricResult<T> {
  value: T;
  formatted: string;
  formula: string;
  currency: string;
  recordCount: number;
  sourceRecordIds: string[];
  isInsufficientData: boolean;
  missingDataReason?: string;
}

// -----------------------------------------------------------------------------
// ARITHMETIC & FORMATTING HELPERS
// -----------------------------------------------------------------------------

export function formatCurrency(cents: number, currency = 'USD', locale = 'en-US'): string {
  const amount = cents / 100;
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currency.toUpperCase(),
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    const symbol = currency === 'INR' ? '₹' : currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : '$';
    return `${symbol}${amount.toLocaleString(locale, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  }
}

export function safeDivide(numerator: number, denominator: number): number | null {
  if (!denominator || denominator === 0 || !isFinite(denominator)) {
    return null;
  }
  return numerator / denominator;
}

// -----------------------------------------------------------------------------
// DETERMINISTIC FINANCIAL METRIC CALCULATORS
// -----------------------------------------------------------------------------

/**
 * Calculates Monthly Recurring Revenue (MRR) strictly from verified active recurring contracts/invoices.
 * Normalizes annual recurring contracts to monthly (/ 12).
 */
export function calculateMRR(
  transactions: RevenueTransaction[],
  currency = 'USD'
): FinancialMetricResult<number> {
  const eligible = transactions.filter(
    (tx) => tx.currency === currency && tx.status === 'PAID' && tx.isRecurring === true
  );

  if (eligible.length === 0) {
    return {
      value: 0,
      formatted: formatCurrency(0, currency),
      formula: 'SUM(monthly_recurring_revenue) + SUM(annual_recurring_revenue / 12)',
      currency,
      recordCount: 0,
      sourceRecordIds: [],
      isInsufficientData: true,
      missingDataReason: 'No paid recurring revenue transactions found for currency ' + currency,
    };
  }

  let totalMonthlyCents = 0;
  const sourceIds: string[] = [];

  for (const tx of eligible) {
    sourceIds.push(tx.id);
    if (tx.recurringInterval === 'annual') {
      totalMonthlyCents += Math.round(tx.amountCents / 12);
    } else {
      totalMonthlyCents += tx.amountCents;
    }
  }

  return {
    value: totalMonthlyCents,
    formatted: formatCurrency(totalMonthlyCents, currency) + ' / mo',
    formula: 'SUM(monthly_recurring_revenue) + SUM(annual_recurring_revenue / 12)',
    currency,
    recordCount: eligible.length,
    sourceRecordIds: sourceIds,
    isInsufficientData: false,
  };
}

/**
 * Calculates Annual Recurring Revenue (ARR) as MRR * 12.
 */
export function calculateARR(
  mrrResult: FinancialMetricResult<number>
): FinancialMetricResult<number> {
  const arrCents = mrrResult.value * 12;
  return {
    value: arrCents,
    formatted: formatCurrency(arrCents, mrrResult.currency) + ' / yr',
    formula: 'MRR * 12',
    currency: mrrResult.currency,
    recordCount: mrrResult.recordCount,
    sourceRecordIds: mrrResult.sourceRecordIds,
    isInsufficientData: mrrResult.isInsufficientData,
    missingDataReason: mrrResult.missingDataReason,
  };
}

/**
 * Calculates Operating Cashflow strictly from cash in (paid revenue receipts) minus cash out (paid expenses/bills).
 */
export function calculateCashflow(
  revenues: RevenueTransaction[],
  expenses: ExpenseTransaction[],
  currency = 'USD'
): FinancialMetricResult<{ cashInCents: number; cashOutCents: number; netCashflowCents: number }> {
  const cashInTxs = revenues.filter((r) => r.currency === currency && r.status === 'PAID');
  const cashOutTxs = expenses.filter((e) => e.currency === currency && e.paymentStatus === 'PAID');

  const cashInCents = cashInTxs.reduce((sum, r) => sum + r.amountCents, 0);
  const cashOutCents = cashOutTxs.reduce((sum, e) => sum + e.amountCents, 0);
  const netCents = cashInCents - cashOutCents;

  const isInsufficient = cashInTxs.length === 0 && cashOutTxs.length === 0;

  return {
    value: { cashInCents, cashOutCents, netCashflowCents: netCents },
    formatted: formatCurrency(netCents, currency),
    formula: 'Actual Cash Inflows (Paid Receipts) - Actual Cash Outflows (Settled Expenses)',
    currency,
    recordCount: cashInTxs.length + cashOutTxs.length,
    sourceRecordIds: [...cashInTxs.map((r) => r.id), ...cashOutTxs.map((e) => e.id)],
    isInsufficientData: isInsufficient,
    missingDataReason: isInsufficient ? 'No settled cash transactions recorded' : undefined,
  };
}

/**
 * Calculates Accounts Receivable (A/R) from unpaid invoice balances.
 */
export function calculateReceivables(
  invoices: InvoiceRecord[],
  currency = 'USD'
): FinancialMetricResult<number> {
  const activeInvoices = invoices.filter(
    (inv) => inv.currency === currency && (inv.status === 'SENT' || inv.status === 'OVERDUE')
  );

  let totalOutstandingCents = 0;
  const sourceIds: string[] = [];

  for (const inv of activeInvoices) {
    const balance = Math.max(0, inv.totalAmountCents - (inv.paidAmountCents || 0));
    if (balance > 0) {
      totalOutstandingCents += balance;
      sourceIds.push(inv.id);
    }
  }

  return {
    value: totalOutstandingCents,
    formatted: formatCurrency(totalOutstandingCents, currency),
    formula: 'SUM(Invoice Total - Paid Amount) for SENT and OVERDUE invoices',
    currency,
    recordCount: sourceIds.length,
    sourceRecordIds: sourceIds,
    isInsufficientData: sourceIds.length === 0,
    missingDataReason: sourceIds.length === 0 ? 'No open unpaid customer invoice balances' : undefined,
  };
}

/**
 * Calculates Accounts Payable (A/P) from unpaid vendor bill balances.
 */
export function calculatePayables(
  bills: BillRecord[],
  currency = 'USD'
): FinancialMetricResult<number> {
  const activeBills = bills.filter(
    (b) => b.currency === currency && (b.status === 'PENDING' || b.status === 'OVERDUE')
  );

  let totalOutstandingCents = 0;
  const sourceIds: string[] = [];

  for (const b of activeBills) {
    const balance = Math.max(0, b.totalAmountCents - (b.paidAmountCents || 0));
    if (balance > 0) {
      totalOutstandingCents += balance;
      sourceIds.push(b.id);
    }
  }

  return {
    value: totalOutstandingCents,
    formatted: formatCurrency(totalOutstandingCents, currency),
    formula: 'SUM(Bill Total - Paid Amount) for PENDING and OVERDUE vendor bills',
    currency,
    recordCount: sourceIds.length,
    sourceRecordIds: sourceIds,
    isInsufficientData: sourceIds.length === 0,
    missingDataReason: sourceIds.length === 0 ? 'No open unpaid vendor bills' : undefined,
  };
}

/**
 * Calculates Monthly Net Cash Burn Rate.
 */
export function calculateBurnRate(
  cashOutflowCents: number,
  cashInflowCents: number,
  monthsCount = 1,
  currency = 'USD'
): FinancialMetricResult<number> {
  const safeMonths = Math.max(1, monthsCount);
  const netOutflowCents = Math.max(0, cashOutflowCents - cashInflowCents);
  const monthlyBurnCents = Math.round(netOutflowCents / safeMonths);

  return {
    value: monthlyBurnCents,
    formatted: formatCurrency(monthlyBurnCents, currency) + ' / mo',
    formula: 'MAX(0, Total Cash Outflows - Cash Inflows) / Observed Months',
    currency,
    recordCount: 1,
    sourceRecordIds: [],
    isInsufficientData: monthlyBurnCents === 0 && cashOutflowCents === 0,
    missingDataReason: cashOutflowCents === 0 ? 'No expense outflows recorded to calculate burn rate' : undefined,
  };
}

/**
 * Calculates Cash Runway in Months based on verifiable current cash balance and positive burn rate.
 * Declines to calculate if cash is zero or burn rate is zero.
 */
export function calculateRunway(
  cashBalanceCents: number,
  monthlyBurnCents: number
): FinancialMetricResult<number | null> {
  if (cashBalanceCents <= 0) {
    return {
      value: 0,
      formatted: '0 Months (Zero or Negative Cash Balance)',
      formula: 'Current Verified Cash Balance / Monthly Net Burn',
      currency: 'USD',
      recordCount: 0,
      sourceRecordIds: [],
      isInsufficientData: true,
      missingDataReason: 'Current verified cash balance is zero or negative',
    };
  }

  if (monthlyBurnCents <= 0) {
    return {
      value: null,
      formatted: 'Profitable / Net Positive Cashflow (Infinite Runway)',
      formula: 'Current Verified Cash Balance / Monthly Net Burn',
      currency: 'USD',
      recordCount: 0,
      sourceRecordIds: [],
      isInsufficientData: false,
      missingDataReason: 'Organization is cashflow positive or has zero net burn; runway formula is not applicable',
    };
  }

  const runwayMonths = Math.round((cashBalanceCents / monthlyBurnCents) * 10) / 10;

  return {
    value: runwayMonths,
    formatted: `${runwayMonths.toFixed(1)} Months`,
    formula: 'Current Verified Cash Balance / Monthly Net Burn',
    currency: 'USD',
    recordCount: 1,
    sourceRecordIds: [],
    isInsufficientData: false,
  };
}

/**
 * Calculates Gross Margin Percentage: (Recognized Revenue - COGS) / Recognized Revenue.
 */
export function calculateGrossMargin(
  revenueCents: number,
  cogsCents: number
): FinancialMetricResult<number | null> {
  if (revenueCents <= 0) {
    return {
      value: null,
      formatted: 'Undefined (Zero Recognized Revenue)',
      formula: '(Recognized Revenue - Cost of Goods Sold) / Recognized Revenue',
      currency: '%',
      recordCount: 0,
      sourceRecordIds: [],
      isInsufficientData: true,
      missingDataReason: 'Revenue is zero or negative; denominator cannot be zero',
    };
  }

  const grossProfitCents = revenueCents - cogsCents;
  const marginRatio = grossProfitCents / revenueCents;
  const marginPercent = Math.round(marginRatio * 1000) / 10;

  return {
    value: marginPercent,
    formatted: `${marginPercent.toFixed(1)}%`,
    formula: '(Recognized Revenue - COGS) / Recognized Revenue',
    currency: '%',
    recordCount: 1,
    sourceRecordIds: [],
    isInsufficientData: false,
  };
}
