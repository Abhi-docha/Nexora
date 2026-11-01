/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * NEXORA Enterprise Operations Cloud - Authoritative Plan & Entitlement Catalog
 */

import { PlanCode, PlanDefinition } from '../types';
import { getDodoConfig } from './dodo';

export const PLAN_CATALOG: Record<PlanCode, PlanDefinition> = {
  FREE: {
    code: 'FREE',
    name: 'Free Evaluation Sandbox',
    monthlyPriceInr: 0,
    priceFormatted: '₹0',
    description: 'Basic multi-tenant operations sandbox for initial team evaluation.',
    dodoProductIdEnvVar: '',
    limits: {
      seats: 3,
      projects: 3,
      workflows: 1,
      automationRules: 5,
      cloudStorageGb: 1,
      aiCreditsMonthly: 10,
    },
    features: {
      basicModules: true,
      incidentWarRoom: false,
      exportReports: false,
      slaEscalationEngine: false,
      scheduledRuns: false,
      customRoles: false,
      workflowReplay: false,
      capacityPlanning: false,
      governanceWarRoom: false,
      unlimitedProjects: false,
    },
  },
  STARTER: {
    code: 'STARTER',
    name: 'Starter Operations',
    monthlyPriceInr: 199,
    priceFormatted: '₹199',
    description: 'Essential enterprise operations for boutique and focused teams.',
    dodoProductIdEnvVar: 'DODO_PRODUCT_ID_STARTER',
    limits: {
      seats: 10,
      projects: 25,
      workflows: 5,
      automationRules: 25,
      cloudStorageGb: 2,
      aiCreditsMonthly: 100,
    },
    features: {
      basicModules: true,
      incidentWarRoom: true,
      exportReports: true,
      slaEscalationEngine: false,
      scheduledRuns: false,
      customRoles: false,
      workflowReplay: false,
      capacityPlanning: false,
      governanceWarRoom: false,
      unlimitedProjects: false,
    },
  },
  GROWTH: {
    code: 'GROWTH',
    name: 'Growth Operations',
    monthlyPriceInr: 499,
    priceFormatted: '₹499',
    description: 'Advanced visual workflows, SLA escalation, and multi-department analytics.',
    dodoProductIdEnvVar: 'DODO_PRODUCT_ID_GROWTH',
    limits: {
      seats: 50,
      projects: 100,
      workflows: 25,
      automationRules: 250,
      cloudStorageGb: 25,
      aiCreditsMonthly: 1000,
    },
    features: {
      basicModules: true,
      incidentWarRoom: true,
      exportReports: true,
      slaEscalationEngine: true,
      scheduledRuns: true,
      customRoles: true,
      workflowReplay: false,
      capacityPlanning: false,
      governanceWarRoom: false,
      unlimitedProjects: false,
    },
  },
  SCALE: {
    code: 'SCALE',
    name: 'Scale Enterprise Core',
    monthlyPriceInr: 1999,
    priceFormatted: '₹1,999',
    description: 'Full operational intelligence, workflow replay, governance, and capacity planning.',
    dodoProductIdEnvVar: 'DODO_PRODUCT_ID_SCALE',
    limits: {
      seats: 250,
      projects: 999999, // Unlimited
      workflows: 100,
      automationRules: 2000,
      cloudStorageGb: 250,
      aiCreditsMonthly: 10000,
    },
    features: {
      basicModules: true,
      incidentWarRoom: true,
      exportReports: true,
      slaEscalationEngine: true,
      scheduledRuns: true,
      customRoles: true,
      workflowReplay: true,
      capacityPlanning: true,
      governanceWarRoom: true,
      unlimitedProjects: true,
    },
  },
};

export function getPlanDefinition(planCode?: string | null): PlanDefinition {
  if (!planCode) return PLAN_CATALOG.FREE;
  const upper = planCode.toUpperCase() as PlanCode;
  return PLAN_CATALOG[upper] || PLAN_CATALOG.FREE;
}

export function getDodoProductIdForPlan(planCode: PlanCode): string {
  const config = getDodoConfig();
  switch (planCode) {
    case 'STARTER':
      return config.productIds.STARTER;
    case 'GROWTH':
      return config.productIds.GROWTH;
    case 'SCALE':
      return config.productIds.SCALE;
    default:
      throw new Error(`Plan ${planCode} does not require a paid Dodo subscription product.`);
  }
}

export function resolvePlanFromDodoProductId(productId?: string | null): PlanCode {
  if (!productId) return 'FREE';

  const config = getDodoConfig();
  if (productId === config.productIds.STARTER) return 'STARTER';
  if (productId === config.productIds.GROWTH) return 'GROWTH';
  if (productId === config.productIds.SCALE) return 'SCALE';

  // Fallback heuristic based on product naming or ID substring
  const lower = productId.toLowerCase();
  if (lower.includes('starter') || lower.includes('199')) return 'STARTER';
  if (lower.includes('growth') || lower.includes('499')) return 'GROWTH';
  if (lower.includes('scale') || lower.includes('1999')) return 'SCALE';

  console.warn(`[PlanResolver] Unrecognized Dodo product ID "${productId}". Defaulting to STARTER.`);
  return 'STARTER';
}
