import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, CreditCard, Receipt, ShieldCheck } from 'lucide-react';
import { apiFetch } from '../lib/api';
import {
  calculateInvoiceBreakdown,
  formatCurrencyCents,
  PLATFORM_PLANS,
  type UsageMetrics,
} from '../lib/platformLogic';
import type { InvoiceRecord, PlanDefinition, PlanTierId } from '../types';

interface BillingOverview {
  plans: PlanDefinition[];
  currentPlanId: PlanTierId;
  billingCycle: 'monthly' | 'annual';
  usage: UsageMetrics;
  invoices: InvoiceRecord[];
}

export const BillingPortal: React.FC<{ onPlanChanged?: () => Promise<void> }> = ({
  onPlanChanged,
}) => {
  const [data, setData] = useState<BillingOverview | null>(null);
  const [cycle, setCycle] = useState<'monthly' | 'annual'>('monthly');
  const [provider, setProvider] = useState<'stripe' | 'razorpay'>('stripe');
  const [couponCode, setCouponCode] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState<string | null>(null);
  const [couponMessage, setCouponMessage] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadBilling = useCallback(async () => {
    try {
      const res = await apiFetch<BillingOverview>('/api/billing/overview');
      setData(res);
      setCycle(res.billingCycle);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load billing portal.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadBilling();
  }, [loadBilling]);

  const handleValidateCoupon = async () => {
    setCouponMessage(null);
    setError(null);
    try {
      const res = await apiFetch<{ valid: boolean; code: string; percentOff: number; fixedOffCents: number }>(
        '/api/billing/validate-coupon',
        { method: 'POST', body: JSON.stringify({ code: couponCode }) },
      );
      setAppliedCoupon(res.code);
      setCouponMessage(
        res.percentOff > 0
          ? `Applied ${res.code} (${res.percentOff}% discount)`
          : `Applied ${res.code} (${formatCurrencyCents(res.fixedOffCents)} off)`,
      );
    } catch (err) {
      setAppliedCoupon(null);
      setError(err instanceof Error ? err.message : 'Invalid promo code.');
    }
  };

  const handleCheckout = async (planId: PlanTierId) => {
    setError(null);
    setFeedback(null);
    try {
      const res = await apiFetch<{
        invoiceNumber: string;
        webhookVerified: boolean;
      }>('/api/billing/checkout', {
        method: 'POST',
        body: JSON.stringify({
          planId,
          billingCycle: cycle,
          couponCode: appliedCoupon,
          provider,
        }),
      });
      setFeedback(
        `Plan switched to ${PLATFORM_PLANS[planId].name} (${cycle}). Invoice ${res.invoiceNumber} settled after signed ${provider} webhook verification.`,
      );
      await loadBilling();
      await onPlanChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Checkout failed.');
    }
  };

  const handleRefund = async (invoiceId: string) => {
    setError(null);
    try {
      await apiFetch(`/api/billing/invoices/${invoiceId}/refund`, { method: 'POST' });
      setFeedback('Refund issued and recorded in audit log.');
      await loadBilling();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Refund failed.');
    }
  };

  if (loading || !data) {
    return <div className="h-64 bg-white border border-slate-200 rounded-lg animate-pulse" />;
  }

  const currentPlan = PLATFORM_PLANS[data.currentPlanId];
  const liveBreakdown = calculateInvoiceBreakdown({
    planId: data.currentPlanId,
    billingCycle: cycle,
    usage: data.usage,
    couponCode: appliedCoupon,
  });

  const usageMeters = [
    { label: 'API Requests', used: data.usage.apiRequests, limit: currentPlan.includedApiRequests, unit: '' },
    { label: 'AI Builder Tokens', used: data.usage.aiTokens, limit: currentPlan.includedAiTokens, unit: '' },
    { label: 'Storage & DBs', used: data.usage.storageGb, limit: currentPlan.includedStorageGb, unit: ' GB' },
    { label: 'Hosting Bandwidth', used: data.usage.bandwidthGb, limit: currentPlan.includedBandwidthGb, unit: ' GB' },
  ];

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-bold text-slate-900">
            Unified Billing &amp; Subscriptions
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Shared metering across API Marketplace, AI App Builder, Cloud Hosting, and Enterprise Data Cloud.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-md">
            {(['monthly', 'annual'] as const).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCycle(c)}
                className={`px-3 py-1.5 text-xs font-medium rounded capitalize ${
                  cycle === c ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                }`}
              >
                {c} {c === 'annual' ? '(Save 20%)' : ''}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-md border border-red-200 bg-red-50 text-xs text-red-700">{error}</div>
      )}
      {feedback && (
        <div className="p-3 rounded-md border border-emerald-200 bg-emerald-50 text-xs text-emerald-800 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{feedback}</span>
        </div>
      )}

      {/* Usage Metering + Current Cycle Estimator */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-lg p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-display font-semibold text-slate-900">
              Current Cycle Usage ({currentPlan.name} Plan)
            </h2>
            <span className="text-xs text-slate-500 tabular-nums">
              {data.usage.databasesCount} / {currentPlan.includedDatabases} databases provisioned
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {usageMeters.map((m) => {
              const pct = Math.min(100, Math.round((m.used / Math.max(1, m.limit)) * 100));
              return (
                <div key={m.label} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-600">{m.label}</span>
                    <span className="font-mono font-medium text-slate-900 tabular-nums">
                      {m.used.toLocaleString()}{m.unit} / {m.limit.toLocaleString()}{m.unit}
                    </span>
                  </div>
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${pct > 85 ? 'bg-amber-600' : 'bg-blue-700'}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-display font-semibold text-slate-900">
              Projected Invoice &amp; Promo Code
            </h2>
            <select
              aria-label="Payment Provider"
              value={provider}
              onChange={(e) => setProvider(e.target.value as 'stripe' | 'razorpay')}
              className="px-2 py-1 text-xs border border-slate-300 rounded bg-white"
            >
              <option value="stripe">Stripe Checkout</option>
              <option value="razorpay">Razorpay Gateway</option>
            </select>
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              value={couponCode}
              onChange={(e) => setCouponCode(e.target.value)}
              placeholder="Promo code (try KODEX20)"
              className="flex-1 px-3 py-1.5 text-xs font-mono border border-slate-300 rounded-md"
            />
            <button
              type="button"
              onClick={handleValidateCoupon}
              className="px-3 py-1.5 bg-slate-900 text-white text-xs font-medium rounded-md"
            >
              Apply
            </button>
          </div>
          {couponMessage && <div className="text-xs text-emerald-700">{couponMessage}</div>}

          <div className="pt-2 border-t border-slate-100 space-y-1.5 text-xs">
            <div className="flex justify-between">
              <span className="text-slate-600">Base Subscription ({cycle})</span>
              <span className="font-mono tabular-nums">{formatCurrencyCents(liveBreakdown.baseCents)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600">Metered Usage Overage</span>
              <span className="font-mono tabular-nums">{formatCurrencyCents(liveBreakdown.usageOverageCents)}</span>
            </div>
            {liveBreakdown.discountCents > 0 && (
              <div className="flex justify-between text-emerald-700">
                <span>Promo Discount ({appliedCoupon})</span>
                <span className="font-mono tabular-nums">-{formatCurrencyCents(liveBreakdown.discountCents)}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-slate-600">Estimated Tax / GST (18%)</span>
              <span className="font-mono tabular-nums">{formatCurrencyCents(liveBreakdown.taxCents)}</span>
            </div>
            <div className="flex justify-between pt-2 border-t border-slate-200 font-semibold text-sm text-slate-900">
              <span>Projected Total</span>
              <span className="font-mono tabular-nums">{formatCurrencyCents(liveBreakdown.totalCents)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Plan Matrix */}
      <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-5 gap-4">
        {data.plans.map((plan) => {
          const isCurrent = plan.id === data.currentPlanId;
          const priceCents = cycle === 'annual' ? plan.annualPriceCents : plan.monthlyPriceCents;
          return (
            <div
              key={plan.id}
              className={`bg-white border rounded-lg p-5 flex flex-col justify-between ${
                isCurrent ? 'border-blue-700 ring-1 ring-blue-700' : 'border-slate-200'
              }`}
            >
              <div>
                <div className="text-xs text-slate-500">{plan.audience}</div>
                <div className="mt-1 flex items-baseline justify-between">
                  <h3 className="text-base font-display font-bold text-slate-900">{plan.name}</h3>
                  {isCurrent && <span className="text-xs font-medium text-blue-700">Current</span>}
                </div>
                <div className="mt-3 text-2xl font-display font-bold text-slate-900 tabular-nums">
                  {formatCurrencyCents(priceCents)}
                  <span className="text-xs font-normal text-slate-500">
                    /{cycle === 'annual' ? 'yr' : 'mo'}
                  </span>
                </div>
                <ul className="mt-4 space-y-2 text-xs text-slate-600">
                  {plan.features.map((feat) => (
                    <li key={feat} className="leading-snug">
                      {feat}
                    </li>
                  ))}
                </ul>
              </div>

              <button
                type="button"
                onClick={() => handleCheckout(plan.id)}
                className={`mt-6 w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md transition-colors ${
                  isCurrent
                    ? 'border border-slate-300 text-slate-700 hover:bg-slate-50'
                    : 'bg-blue-700 hover:bg-blue-800 text-white'
                }`}
              >
                <CreditCard className="w-3.5 h-3.5" />
                <span>{isCurrent ? `Renew ${plan.name}` : `Switch to ${plan.name}`}</span>
              </button>
            </div>
          );
        })}
      </div>

      {/* Invoices & Webhook Verification Log */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 overflow-x-auto">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Receipt className="w-4 h-4 text-slate-500" />
            <h2 className="text-sm font-display font-semibold text-slate-900">
              Invoices &amp; Signed Payment History
            </h2>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <ShieldCheck className="w-4 h-4 text-emerald-700" />
            <span>No raw card numbers stored · HMAC webhook verified</span>
          </div>
        </div>

        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-slate-200 text-slate-500">
              <th className="pb-2 font-medium">Invoice #</th>
              <th className="pb-2 font-medium">Plan</th>
              <th className="pb-2 font-medium">Provider</th>
              <th className="pb-2 font-medium text-right">Subtotal</th>
              <th className="pb-2 font-medium text-right">Tax</th>
              <th className="pb-2 font-medium text-right">Total</th>
              <th className="pb-2 font-medium">Status</th>
              <th className="pb-2 font-medium text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.invoices.map((inv) => (
              <tr key={inv.id} className="hover:bg-slate-50">
                <td className="py-3 font-mono font-medium text-slate-900">{inv.invoiceNumber}</td>
                <td className="py-3 capitalize text-slate-700">
                  {inv.planId} · {inv.billingCycle}
                </td>
                <td className="py-3 capitalize text-slate-600">
                  {inv.paymentProvider} {inv.webhookVerified ? '· Signed' : ''}
                </td>
                <td className="py-3 text-right font-mono tabular-nums">
                  {formatCurrencyCents(inv.subtotalCents + inv.usageOverageCents - inv.discountCents)}
                </td>
                <td className="py-3 text-right font-mono tabular-nums">
                  {formatCurrencyCents(inv.taxCents)}
                </td>
                <td className="py-3 text-right font-mono font-semibold tabular-nums">
                  {formatCurrencyCents(inv.totalCents)}
                </td>
                <td className="py-3 capitalize">
                  <span
                    className={
                      inv.status === 'paid'
                        ? 'text-emerald-700 font-semibold'
                        : inv.status === 'refunded'
                          ? 'text-amber-700 font-medium'
                          : 'text-red-600 font-medium'
                    }
                  >
                    {inv.status}
                  </span>
                </td>
                <td className="py-3 text-right">
                  {inv.status === 'paid' && (
                    <button
                      type="button"
                      onClick={() => handleRefund(inv.id)}
                      className="text-slate-600 hover:text-red-600 font-medium"
                    >
                      Refund
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
