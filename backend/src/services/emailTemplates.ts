/**
 * Engagement Email Templates
 *
 * HTML templates for retention/engagement emails. Plain template literals —
 * no engine, SendGrid ships the raw HTML. Every template:
 *   - Uses inline CSS (email clients drop <style> tags inconsistently)
 *   - Contains no PHI (counts + names only, never values)
 *   - Includes an unsubscribe link to the settings page (CAN-SPAM)
 *   - Keeps a single-column, ≤600px body
 */

import { config } from '../config/index.js';

const BRAND = {
  primary: '#2563eb',
  primaryDark: '#1d4ed8',
  success: '#16a34a',
  warning: '#f59e0b',
  danger: '#dc2626',
  text: '#111827',
  mutedText: '#6b7280',
  faintText: '#9ca3af',
  border: '#e5e7eb',
  bg: '#f9fafb',
} as const;

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

function escapeHtml(input: string): string {
  return input.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default: return c;
    }
  });
}

function appUrl(path: string = ''): string {
  const base = (config.email.frontendUrl || '').replace(/\/+$/, '');
  const trail = path.startsWith('/') ? path : `/${path}`;
  return `${base}${trail}`;
}

function unsubscribeUrl(): string {
  return appUrl('/settings');
}

/**
 * Wrap a body in the shared email shell. Centralizes the header, footer,
 * brand chrome, and unsubscribe link so individual templates only need to
 * worry about their own content.
 */
function emailShell(opts: {
  preheader: string;
  bodyHtml: string;
  ctaLabel?: string;
  ctaUrl?: string;
  ctaColor?: string;
}): string {
  const year = new Date().getFullYear();
  const { preheader, bodyHtml, ctaLabel, ctaUrl, ctaColor = BRAND.primary } = opts;

  const ctaBlock = ctaLabel && ctaUrl
    ? `
        <div style="text-align: center; margin: 28px 0 8px 0;">
          <a href="${ctaUrl}" style="display: inline-block; background: ${ctaColor}; color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: 600;">
            ${escapeHtml(ctaLabel)}
          </a>
        </div>`
    : '';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background: ${BRAND.bg}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: ${BRAND.text};">
  <!-- Preheader text (hidden) shown in inbox previews -->
  <div style="display: none; max-height: 0; overflow: hidden;">${escapeHtml(preheader)}</div>

  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background: ${BRAND.bg};">
    <tr>
      <td align="center" style="padding: 24px 12px;">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="max-width: 600px; width: 100%; background: #ffffff; border: 1px solid ${BRAND.border}; border-radius: 12px; overflow: hidden;">
          <tr>
            <td style="padding: 28px 32px; border-bottom: 1px solid ${BRAND.border};">
              <h1 style="margin: 0; color: ${BRAND.primary}; font-size: 20px;">OwnMyHealth</h1>
              <p style="margin: 4px 0 0 0; color: ${BRAND.mutedText}; font-size: 13px;">Your health, your data, your control.</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 28px 32px;">
              ${bodyHtml}
              ${ctaBlock}
            </td>
          </tr>
          <tr>
            <td style="padding: 20px 32px; border-top: 1px solid ${BRAND.border}; background: ${BRAND.bg};">
              <p style="margin: 0 0 8px 0; color: ${BRAND.mutedText}; font-size: 12px;">
                OwnMyHealth — Your health data stays private. HIPAA-compliant.
              </p>
              <p style="margin: 0; color: ${BRAND.faintText}; font-size: 12px;">
                You're receiving this because you have OwnMyHealth email notifications enabled.
                <a href="${unsubscribeUrl()}" style="color: ${BRAND.primary}; text-decoration: underline;">Manage notifications</a> ·
                &copy; ${year} OwnMyHealth
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ============================================
// a) New results notification
// ============================================

export interface NewResultsEmailData {
  biomarkerCount: number;
  outOfRangeCount: number;
  /** Lab name is a label, not PHI. Leave undefined if unknown. */
  labName?: string;
}

export function buildNewResultsEmail(data: NewResultsEmailData): EmailContent {
  const { biomarkerCount, outOfRangeCount, labName } = data;
  const subject = 'Your lab results are ready';
  const preheader = `We extracted ${biomarkerCount} biomarker${biomarkerCount === 1 ? '' : 's'} from your latest upload.`;
  const labLine = labName
    ? `<p style="margin: 0 0 12px 0; color: ${BRAND.mutedText}; font-size: 14px;">Source: ${escapeHtml(labName)}</p>`
    : '';

  const outOfRangeLine =
    outOfRangeCount > 0
      ? `<p style="margin: 0 0 16px 0; color: ${BRAND.warning}; font-weight: 600;">
           ${outOfRangeCount} biomarker${outOfRangeCount === 1 ? '' : 's'} flagged for attention.
         </p>`
      : `<p style="margin: 0 0 16px 0; color: ${BRAND.success};">
           All biomarkers are within normal ranges.
         </p>`;

  const bodyHtml = `
    <h2 style="margin: 0 0 12px 0; font-size: 22px;">Your lab results are ready</h2>
    ${labLine}
    <p style="margin: 0 0 16px 0;">
      We extracted <strong>${biomarkerCount}</strong> biomarker${biomarkerCount === 1 ? '' : 's'} from your upload.
    </p>
    ${outOfRangeLine}
    <p style="margin: 0; color: ${BRAND.mutedText}; font-size: 14px;">
      View the full breakdown, trends, and AI-powered context on your dashboard.
    </p>
  `;

  const text = [
    `Your lab results are ready.`,
    labName ? `Source: ${labName}` : '',
    `We extracted ${biomarkerCount} biomarker${biomarkerCount === 1 ? '' : 's'}.`,
    outOfRangeCount > 0
      ? `${outOfRangeCount} biomarker${outOfRangeCount === 1 ? '' : 's'} flagged for attention.`
      : 'All biomarkers are within normal ranges.',
    '',
    `View on dashboard: ${appUrl('/')}`,
    `Manage notifications: ${unsubscribeUrl()}`,
  ].filter(Boolean).join('\n');

  const html = emailShell({
    preheader,
    bodyHtml,
    ctaLabel: 'View Dashboard',
    ctaUrl: appUrl('/'),
  });

  return { subject, html, text };
}

// ============================================
// b) Out-of-range alert
// ============================================

export interface OutOfRangeEmailData {
  biomarkers: Array<{ name: string; status: 'high' | 'low' }>;
}

export function buildOutOfRangeAlert(data: OutOfRangeEmailData): EmailContent {
  const { biomarkers } = data;
  const count = biomarkers.length;
  const subject = `${count} biomarker${count === 1 ? '' : 's'} need${count === 1 ? 's' : ''} attention`;
  const preheader = `${count} of your latest biomarkers are outside the reference range.`;

  // NO values — only names + direction. Keeps the email PHI-light so an
  // intercepted inbox leak exposes only the fact that a metric was flagged.
  const rows = biomarkers
    .map((b) => {
      const statusLabel = b.status === 'high' ? 'Above range' : 'Below range';
      const color = b.status === 'high' ? BRAND.danger : BRAND.warning;
      return `
        <tr>
          <td style="padding: 12px 16px; border-bottom: 1px solid ${BRAND.border}; font-size: 14px;">${escapeHtml(b.name)}</td>
          <td style="padding: 12px 16px; border-bottom: 1px solid ${BRAND.border}; font-size: 13px; color: ${color}; font-weight: 600; text-align: right;">${statusLabel}</td>
        </tr>`;
    })
    .join('');

  const bodyHtml = `
    <h2 style="margin: 0 0 12px 0; font-size: 22px; color: ${BRAND.warning};">
      ${count} biomarker${count === 1 ? '' : 's'} need${count === 1 ? 's' : ''} attention
    </h2>
    <p style="margin: 0 0 16px 0;">
      These were flagged as outside your reference range on your latest upload.
      Log in to see the values in context and how they're trending.
    </p>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border: 1px solid ${BRAND.border}; border-radius: 8px; overflow: hidden; margin-bottom: 12px;">
      ${rows}
    </table>
    <p style="margin: 0; color: ${BRAND.mutedText}; font-size: 13px;">
      This isn't medical advice — always consult your healthcare provider about abnormal results.
    </p>
  `;

  const text = [
    `${count} biomarker${count === 1 ? '' : 's'} outside the reference range:`,
    ...biomarkers.map((b) => `  - ${b.name} (${b.status === 'high' ? 'above' : 'below'} range)`),
    '',
    `View on dashboard: ${appUrl('/')}`,
    `Manage notifications: ${unsubscribeUrl()}`,
  ].join('\n');

  const html = emailShell({
    preheader,
    bodyHtml,
    ctaLabel: 'Review Results',
    ctaUrl: appUrl('/'),
    ctaColor: BRAND.warning,
  });

  return { subject, html, text };
}

// ============================================
// c) Goal reminder (weekly)
// ============================================

export interface GoalReminderEmailData {
  goals: Array<{ name: string; progressPct: number }>;
}

export function buildGoalReminderEmail(data: GoalReminderEmailData): EmailContent {
  const { goals } = data;
  const subject = 'Health goal check-in';
  const preheader =
    goals.length === 0
      ? 'Set a goal this week to track what matters.'
      : `You have ${goals.length} active goal${goals.length === 1 ? '' : 's'} in progress.`;

  const rows = goals
    .map((g) => {
      const pct = Math.max(0, Math.min(100, Math.round(g.progressPct)));
      return `
        <tr>
          <td style="padding: 12px 16px; border-bottom: 1px solid ${BRAND.border};">
            <div style="font-size: 14px; font-weight: 500;">${escapeHtml(g.name)}</div>
            <div style="margin-top: 6px; height: 6px; background: ${BRAND.border}; border-radius: 999px; overflow: hidden;">
              <div style="width: ${pct}%; height: 100%; background: ${BRAND.success}; border-radius: 999px;"></div>
            </div>
            <div style="margin-top: 4px; font-size: 12px; color: ${BRAND.mutedText};">${pct}% complete</div>
          </td>
        </tr>`;
    })
    .join('');

  const goalsBlock = goals.length === 0
    ? `<p style="margin: 0 0 12px 0; color: ${BRAND.mutedText};">
         You don't have any active goals yet. Setting one makes it easier to
         see progress from the biomarkers and habits you're already tracking.
       </p>`
    : `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border: 1px solid ${BRAND.border}; border-radius: 8px; overflow: hidden;">
         ${rows}
       </table>`;

  const bodyHtml = `
    <h2 style="margin: 0 0 12px 0; font-size: 22px;">Weekly goal check-in</h2>
    <p style="margin: 0 0 16px 0;">
      Small, consistent steps compound. Here's where your active goals stand today.
    </p>
    ${goalsBlock}
  `;

  const text = [
    `Weekly goal check-in.`,
    '',
    goals.length === 0
      ? 'You have no active goals yet.'
      : goals.map((g) => `  - ${g.name}: ${Math.round(g.progressPct)}% complete`).join('\n'),
    '',
    `View goals: ${appUrl('/goals')}`,
    `Manage notifications: ${unsubscribeUrl()}`,
  ].filter(Boolean).join('\n');

  const html = emailShell({
    preheader,
    bodyHtml,
    ctaLabel: goals.length === 0 ? 'Create a Goal' : 'View Goals',
    ctaUrl: appUrl('/goals'),
    ctaColor: BRAND.success,
  });

  return { subject, html, text };
}

// ============================================
// d) Weekly summary
// ============================================

export interface WeeklySummaryEmailData {
  inRangePct: number;
  biomarkerCount: number;
  activeGoals: number;
  upcomingDeadlines: number;
}

export function buildWeeklySummaryEmail(data: WeeklySummaryEmailData): EmailContent {
  const { inRangePct, biomarkerCount, activeGoals, upcomingDeadlines } = data;
  const subject = 'Your weekly health summary';
  const preheader = `${Math.round(inRangePct)}% of your biomarkers are in range this week.`;

  const card = (label: string, value: string, color: string) => `
    <td align="center" style="padding: 16px; border: 1px solid ${BRAND.border}; border-radius: 8px; width: 33%;">
      <div style="font-size: 22px; font-weight: 700; color: ${color};">${escapeHtml(value)}</div>
      <div style="font-size: 12px; color: ${BRAND.mutedText}; margin-top: 4px;">${escapeHtml(label)}</div>
    </td>`;

  const bodyHtml = `
    <h2 style="margin: 0 0 8px 0; font-size: 22px;">Your weekly health summary</h2>
    <p style="margin: 0 0 20px 0; color: ${BRAND.mutedText};">
      A quick snapshot of where your tracked health data stands.
    </p>
    <table role="presentation" width="100%" cellspacing="8" cellpadding="0">
      <tr>
        ${card('In-range biomarkers', `${Math.round(inRangePct)}%`, BRAND.success)}
        ${card('Active goals', String(activeGoals), BRAND.primary)}
        ${card('Deadlines this week', String(upcomingDeadlines), upcomingDeadlines > 0 ? BRAND.warning : BRAND.mutedText)}
      </tr>
    </table>
    <p style="margin: 20px 0 0 0; color: ${BRAND.mutedText}; font-size: 14px;">
      Based on ${biomarkerCount} tracked biomarker${biomarkerCount === 1 ? '' : 's'}.
    </p>
  `;

  const text = [
    `Your weekly health summary:`,
    `  - In-range biomarkers: ${Math.round(inRangePct)}%`,
    `  - Active goals: ${activeGoals}`,
    `  - Deadlines this week: ${upcomingDeadlines}`,
    `  - Tracked biomarkers: ${biomarkerCount}`,
    '',
    `View on dashboard: ${appUrl('/')}`,
    `Manage notifications: ${unsubscribeUrl()}`,
  ].join('\n');

  const html = emailShell({
    preheader,
    bodyHtml,
    ctaLabel: 'Open Dashboard',
    ctaUrl: appUrl('/'),
  });

  return { subject, html, text };
}

// ============================================
// e) Plan expiring
// ============================================

export interface PlanExpiringEmailData {
  planName: string;
  /** Calendar date string (YYYY-MM-DD) or locale-formatted — ship whatever
   *  you want rendered verbatim. */
  expiresOn: string;
  daysRemaining: number;
}

export function buildPlanExpiringEmail(data: PlanExpiringEmailData): EmailContent {
  const { planName, expiresOn, daysRemaining } = data;
  const subject = `Your OwnMyHealth ${planName} plan expires soon`;
  const preheader = `${daysRemaining} day${daysRemaining === 1 ? '' : 's'} remaining on your ${planName} plan.`;

  const bodyHtml = `
    <h2 style="margin: 0 0 12px 0; font-size: 22px;">Your ${escapeHtml(planName)} plan expires soon</h2>
    <p style="margin: 0 0 16px 0;">
      Your ${escapeHtml(planName)} plan is scheduled to end on
      <strong>${escapeHtml(expiresOn)}</strong> — about
      <strong>${daysRemaining} day${daysRemaining === 1 ? '' : 's'}</strong> from now.
    </p>
    <p style="margin: 0 0 16px 0;">
      When the plan expires your account will downgrade to the Free tier:
      AI-powered features, higher upload limits, and premium integrations will be capped.
      Your existing data stays yours.
    </p>
    <p style="margin: 0; color: ${BRAND.mutedText}; font-size: 14px;">
      Questions? Just reply to this email.
    </p>
  `;

  const text = [
    `Your ${planName} plan expires on ${expiresOn} (${daysRemaining} day${daysRemaining === 1 ? '' : 's'} remaining).`,
    `When it expires your account will downgrade to the Free tier.`,
    '',
    `Manage plan: ${appUrl('/settings')}`,
    `Manage notifications: ${unsubscribeUrl()}`,
  ].join('\n');

  const html = emailShell({
    preheader,
    bodyHtml,
    ctaLabel: 'Manage Plan',
    ctaUrl: appUrl('/settings'),
  });

  return { subject, html, text };
}
