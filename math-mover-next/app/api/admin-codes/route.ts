import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type CodeKind = 'credits' | 'membership';
type CodeStatus = 'unused' | 'used' | 'all';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

function isLocalRequest(request: NextRequest) {
  const hostHeader = request.headers.get('host') ?? '';
  const forwardedHost = request.headers.get('x-forwarded-host');
  const host = hostHeader.replace(/:\d+$/, '').toLowerCase();
  const forwarded = forwardedHost?.replace(/:\d+$/, '').toLowerCase();

  return LOCAL_HOSTS.has(host) && (!forwarded || LOCAL_HOSTS.has(forwarded));
}

function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

function assertLocal(request: NextRequest) {
  if (!isLocalRequest(request)) {
    return json(
      {
        error: '这个管理接口只允许在本机 localhost / 127.0.0.1 使用。',
      },
      403
    );
  }

  return null;
}

function randomChunk(length = 4) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let text = '';

  for (const byte of bytes) {
    text += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  }

  return text;
}

function makeCreditCode(points: number) {
  return `MM${points}-${randomChunk()}-${randomChunk()}-${randomChunk()}`;
}

function makeMembershipCode(tier: string, days: number) {
  return `${tier.toUpperCase()}${days}-${randomChunk()}-${randomChunk()}-${randomChunk()}`;
}

function parsePositiveInteger(value: unknown, fallback: number) {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function getCount(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  table: 'redemption_codes' | 'membership_codes',
  isUsed: boolean
) {
  const { count, error } = await supabase
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq('is_used', isUsed);

  if (error) throw error;
  return count ?? 0;
}

export async function GET(request: NextRequest) {
  const blocked = assertLocal(request);
  if (blocked) return blocked;

  const { searchParams } = new URL(request.url);
  const kind = (searchParams.get('kind') ?? 'credits') as CodeKind;
  const status = (searchParams.get('status') ?? 'unused') as CodeStatus;
  const limit = Math.min(parsePositiveInteger(searchParams.get('limit'), 80), 200);

  if (!['credits', 'membership'].includes(kind)) {
    return json({ error: 'kind 必须是 credits 或 membership。' }, 400);
  }

  if (!['unused', 'used', 'all'].includes(status)) {
    return json({ error: 'status 必须是 unused、used 或 all。' }, 400);
  }

  try {
    const supabase = getSupabaseAdmin();
    const [
      creditUnused,
      creditUsed,
      membershipUnused,
      membershipUsed,
    ] = await Promise.all([
      getCount(supabase, 'redemption_codes', false),
      getCount(supabase, 'redemption_codes', true),
      getCount(supabase, 'membership_codes', false),
      getCount(supabase, 'membership_codes', true),
    ]);

    const table = kind === 'credits' ? 'redemption_codes' : 'membership_codes';
    const columns =
      kind === 'credits'
        ? 'id,code,points,is_used,used_by,used_at'
        : 'id,code,duration_days,subscription_tier,is_used,used_by,used_at,created_at';

    let query = supabase.from(table).select(columns).limit(limit);

    if (status !== 'all') {
      query = query.eq('is_used', status === 'used');
    }

    if (kind === 'membership') {
      query = query.order('created_at', { ascending: false, nullsFirst: false });
    }

    const { data, error } = await query;

    if (error) throw error;

    return json({
      stats: {
        credits: {
          unused: creditUnused,
          used: creditUsed,
          total: creditUnused + creditUsed,
        },
        membership: {
          unused: membershipUnused,
          used: membershipUsed,
          total: membershipUnused + membershipUsed,
        },
      },
      rows: data ?? [],
    });
  } catch (error) {
    console.error('admin-codes GET failed:', error);
    return json({ error: error instanceof Error ? error.message : '读取兑换码失败。' }, 500);
  }
}

export async function POST(request: NextRequest) {
  const blocked = assertLocal(request);
  if (blocked) return blocked;

  try {
    const body = await request.json();
    const kind = body.kind as CodeKind;
    const count = Math.min(parsePositiveInteger(body.count, 1), 500);

    if (!['credits', 'membership'].includes(kind)) {
      return json({ error: 'kind 必须是 credits 或 membership。' }, 400);
    }

    const supabase = getSupabaseAdmin();
    const generated = new Set<string>();

    if (kind === 'credits') {
      const points = Math.min(parsePositiveInteger(body.points, 300), 100000);
      const rows = [];

      while (rows.length < count) {
        const code = makeCreditCode(points);
        if (generated.has(code)) continue;
        generated.add(code);
        rows.push({ code, points, is_used: false });
      }

      const { data, error } = await supabase
        .from('redemption_codes')
        .insert(rows)
        .select('id,code,points,is_used,used_by,used_at');

      if (error) throw error;

      return json({
        message: `已生成 ${data?.length ?? 0} 个 ${points} 永久积分兑换码。`,
        rows: data ?? [],
      });
    }

    const durationDays = Math.min(parsePositiveInteger(body.durationDays, 30), 3650);
    const tier = body.tier === 'pro' ? 'pro' : 'basic';
    const rows = [];

    while (rows.length < count) {
      const code = makeMembershipCode(tier, durationDays);
      if (generated.has(code)) continue;
      generated.add(code);
      rows.push({
        code,
        duration_days: durationDays,
        subscription_tier: tier,
        is_used: false,
      });
    }

    const { data, error } = await supabase
      .from('membership_codes')
      .insert(rows)
      .select('id,code,duration_days,subscription_tier,is_used,used_by,used_at,created_at');

    if (error) throw error;

    return json({
      message: `已生成 ${data?.length ?? 0} 个 ${tier.toUpperCase()} ${durationDays} 天会员兑换码。`,
      rows: data ?? [],
    });
  } catch (error) {
    console.error('admin-codes POST failed:', error);
    return json({ error: error instanceof Error ? error.message : '生成兑换码失败。' }, 500);
  }
}

export async function DELETE(request: NextRequest) {
  const blocked = assertLocal(request);
  if (blocked) return blocked;

  try {
    const body = await request.json();
    const kind = body.kind as CodeKind;
    const ids = Array.isArray(body.ids)
      ? body.ids.filter((id: unknown) => typeof id === 'string')
      : [];

    if (!['credits', 'membership'].includes(kind)) {
      return json({ error: 'kind 必须是 credits 或 membership。' }, 400);
    }

    if (ids.length === 0 || ids.length > 500) {
      return json({ error: '请选择 1 到 500 个兑换码。' }, 400);
    }

    const table = kind === 'credits' ? 'redemption_codes' : 'membership_codes';
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from(table)
      .delete()
      .in('id', ids)
      .eq('is_used', false)
      .select('id,code');

    if (error) throw error;

    return json({
      message: `已删除 ${data?.length ?? 0} 个未使用兑换码。已使用的兑换码不会被删除。`,
      deleted: data ?? [],
    });
  } catch (error) {
    console.error('admin-codes DELETE failed:', error);
    return json({ error: error instanceof Error ? error.message : '删除兑换码失败。' }, 500);
  }
}
