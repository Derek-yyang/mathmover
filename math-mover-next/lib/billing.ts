export type BillingCycle = 'monthly' | 'quarterly' | 'annually';
export type SubscriptionPlan = 'basic' | 'pro';

export interface SubscriptionPrice {
  total: string;
  unit: string;
  avg: string;
}

export interface CreditPack {
  name: string;
  credits: number;
  price: number;
  url?: string;
}

const SUBSCRIPTION_BASE_PRICES: Record<SubscriptionPlan, number> = {
  basic: 7.9,
  pro: 19.9,
};

const SUBSCRIPTION_PURCHASE_URLS: Record<SubscriptionPlan, Record<BillingCycle, string | undefined>> = {
  basic: {
    monthly: process.env.NEXT_PUBLIC_PAY_BASIC_MONTHLY_URL,
    quarterly: process.env.NEXT_PUBLIC_PAY_BASIC_QUARTERLY_URL,
    annually: process.env.NEXT_PUBLIC_PAY_BASIC_ANNUALLY_URL,
  },
  pro: {
    monthly: process.env.NEXT_PUBLIC_PAY_PRO_MONTHLY_URL,
    quarterly: process.env.NEXT_PUBLIC_PAY_PRO_QUARTERLY_URL,
    annually: process.env.NEXT_PUBLIC_PAY_PRO_ANNUALLY_URL,
  },
};

export const CREDIT_PACKS: CreditPack[] = [
  {
    name: '入门包',
    credits: 20,
    price: 6,
    url: process.env.NEXT_PUBLIC_PAY_CREDITS_STARTER_URL,
  },
  {
    name: '标准包',
    credits: 50,
    price: 15,
    url: process.env.NEXT_PUBLIC_PAY_CREDITS_STANDARD_URL,
  },
  {
    name: '畅享包',
    credits: 100,
    price: 30,
    url: process.env.NEXT_PUBLIC_PAY_CREDITS_PRO_URL,
  },
];

export function getSubscriptionPricing(
  plan: SubscriptionPlan,
  cycle: BillingCycle
): SubscriptionPrice {
  const base = SUBSCRIPTION_BASE_PRICES[plan];

  if (cycle === 'monthly') {
    return {
      total: base.toString(),
      unit: '月',
      avg: base.toString(),
    };
  }

  if (cycle === 'quarterly') {
    const total = (base * 3 * 0.9).toFixed(1);
    const avg = ((base * 3 * 0.9) / 3).toFixed(1);
    return {
      total,
      unit: '季',
      avg,
    };
  }

  const total = Math.floor(base * 12 * 0.8).toString();
  const avg = (Math.floor(base * 12 * 0.8) / 12).toFixed(1);
  return {
    total,
    unit: '年',
    avg,
  };
}

export function getSubscriptionPurchaseUrl(
  plan: SubscriptionPlan,
  cycle: BillingCycle
): string | undefined {
  return SUBSCRIPTION_PURCHASE_URLS[plan][cycle];
}
