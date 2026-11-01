/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * NEXORA Enterprise Operations Cloud - Central Entitlement Engine
 * Enforces tier limits (Seats, Projects, Workflows) and Feature Flags server-side.
 */

import { PlanCode, PlanFeatures, PlanLimits } from '../types';
import { getPlanDefinition, PLAN_CATALOG } from '../config/plans';
import { db } from '../auth/firebaseAuth';

export class EntitlementError extends Error {
  statusCode: number;
  limitKey?: string;
  current?: number;
  max?: number | string;

  constructor(message: string, limitKey?: string, current?: number, max?: number | string) {
    super(message);
    this.name = 'EntitlementError';
    this.statusCode = 403;
    this.limitKey = limitKey;
    this.current = current;
    this.max = max;
  }
}

export interface EntitlementCheckResult {
  allowed: boolean;
  reason?: string;
  planCode: PlanCode;
  feature?: keyof PlanFeatures;
  limitKey?: keyof PlanLimits;
  current?: number;
  max?: number;
  remaining?: number;
}

export class EntitlementEngine {
  /**
   * Retrieves the full plan definition and limits for an organization
   */
  static async getOrgEntitlements(orgId: string): Promise<{
    planCode: PlanCode;
    limits: PlanLimits;
    features: PlanFeatures;
    billingStatus: string;
  }> {
    let data: any = {};
    try {
      const orgSnap = await db.collection('organizations').doc(orgId).get();
      if (orgSnap.exists) {
        data = orgSnap.data() || {};
      }
    } catch {
      // Safe fallback when Admin SDK is unconfigured
    }

    const planCode: PlanCode = (data.planId || 'FREE').toUpperCase() as PlanCode;
    const planDef = getPlanDefinition(planCode);

    return {
      planCode,
      limits: planDef.limits,
      features: planDef.features,
      billingStatus: data.billingStatus || 'ACTIVE',
    };
  }

  /**
   * Checks whether a specific enterprise feature is enabled for the organization
   */
  static async checkFeature(orgId: string, feature: keyof PlanFeatures): Promise<EntitlementCheckResult> {
    const { planCode, features } = await this.getOrgEntitlements(orgId);
    const allowed = Boolean(features[feature]);

    return {
      allowed,
      planCode,
      feature,
      reason: allowed
        ? undefined
        : `Feature "${String(feature)}" requires a higher tier. Current plan is ${planCode}.`,
    };
  }

  /**
   * Enforces feature access, throwing an EntitlementError if unauthorized.
   */
  static async enforceFeature(orgId: string, feature: keyof PlanFeatures): Promise<void> {
    const check = await this.checkFeature(orgId, feature);
    if (!check.allowed) {
      throw new EntitlementError(
        check.reason || `Feature "${String(feature)}" is not available on current plan tier.`,
        String(feature)
      );
    }
  }

  /**
   * Checks volumetric capacity (seats, projects, workflows) against current Firestore count.
   */
  static async checkLimit(
    orgId: string,
    limitKey: 'seats' | 'projects' | 'workflows',
    delta = 1
  ): Promise<EntitlementCheckResult> {
    const { planCode, limits } = await this.getOrgEntitlements(orgId);
    const max = limits[limitKey];

    // Unlimited projects for SCALE (max >= 999999)
    if (max >= 999999) {
      return {
        allowed: true,
        planCode,
        limitKey,
        current: 0,
        max,
        remaining: 999999,
      };
    }

    // Query current live count from Firestore subcollection
    let collectionName = 'projects';
    if (limitKey === 'seats') collectionName = 'members';
    if (limitKey === 'workflows') collectionName = 'workflows';

    const snap = await db.collection('organizations').doc(orgId).collection(collectionName).count().get();
    const current = snap.data().count;

    const allowed = current + delta <= max;
    const remaining = Math.max(0, max - current);

    return {
      allowed,
      planCode,
      limitKey,
      current,
      max,
      remaining,
      reason: allowed
        ? undefined
        : `Plan limit reached for ${limitKey}. Current usage: ${current} / ${max}. Upgrade your plan tier in Billing settings.`,
    };
  }

  /**
   * Enforces volumetric capacity, throwing an EntitlementError if limit would be breached.
   */
  static async enforceLimit(
    orgId: string,
    limitKey: 'seats' | 'projects' | 'workflows',
    delta = 1
  ): Promise<void> {
    const check = await this.checkLimit(orgId, limitKey, delta);
    if (!check.allowed) {
      throw new EntitlementError(
        check.reason || `Limit reached for ${limitKey}`,
        limitKey,
        check.current,
        check.max
      );
    }
  }
}
