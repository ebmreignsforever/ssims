import { NextFunction, Request, Response } from 'express';
import ipaddr from 'ipaddr.js';
import { query } from '../db/pool';
import { recordRequestEvent } from '../services/auditService';
import { logger } from '../utils/logger';

interface IpRule {
  cidr: string;
  action: 'allow' | 'deny';
  reason: string;
}

let cachedRules: IpRule[] | null = null;
let cacheExpiresAt = 0;

async function loadRules(): Promise<IpRule[]> {
  const now = Date.now();
  if (cachedRules && now < cacheExpiresAt) return cachedRules;
  try {
    cachedRules = await query<IpRule>(
      `SELECT cidr::text, action, reason
         FROM ip_rules
        WHERE expires_at IS NULL OR expires_at > now()
        ORDER BY action, cidr`,
    );
    cacheExpiresAt = now + 30_000;
  } catch (error) {
    logger.error({ err: error }, 'Unable to load IP access rules; request allowed');
    return cachedRules ?? [];
  }
  return cachedRules;
}

export function invalidateIpRuleCache(): void {
  cachedRules = null;
  cacheExpiresAt = 0;
}

function matches(ip: string, cidr: string): boolean {
  try {
    const address = ipaddr.process(ip);
    const range = ipaddr.parseCIDR(cidr);
    return address.match(range);
  } catch {
    return false;
  }
}

/**
 * Network access policy stored in the database and administered in the UI.
 * Deny rules always win. If one or more allow rules exist, traffic must match an
 * allow rule (default deny). Keep an allow rule for your admin network before
 * enabling allow-list mode or you will lock yourself out.
 */
export async function ipAccessControl(req: Request, res: Response, next: NextFunction): Promise<void> {
  const ip = req.ip?.replace(/^::ffff:/, '');
  if (!ip) {
    next();
    return;
  }

  const rules = await loadRules();
  if (rules.length === 0) {
    next();
    return;
  }

  const denied = rules.find((rule) => rule.action === 'deny' && matches(ip, rule.cidr));
  const allowRules = rules.filter((rule) => rule.action === 'allow');
  const allowed = allowRules.length === 0 || allowRules.some((rule) => matches(ip, rule.cidr));

  if (denied || !allowed) {
    await recordRequestEvent(req, {
      eventType: 'IP_ACCESS_BLOCKED',
      severity: 'high',
      description: denied
        ? `Request blocked by IP deny rule (${denied.reason || 'no reason supplied'})`
        : 'Request did not match any configured IP allow rule',
      metadata: { ip, path: req.originalUrl.split('?')[0] },
    });
    res.status(403).json({
      success: false,
      error: { code: 'IP_BLOCKED', message: 'Access from this network is not permitted' },
    });
    return;
  }

  next();
}
