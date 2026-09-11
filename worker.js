// worker.js — place this at the ROOT of your repo, next to index.html
//
// Fires on every LinkedIn Buyer Confusion Scorecard submission.
//
// Does two things:
//  1. Emails the LEAD their own personalised result — required by the spec
//     (Section 18: "Delivery Format" — on-screen result + personalised email
//     result are both required).
//  2. Emails BRENDA a notification with the lead's full submission — contact
//     info, qualification answers, all 5 dimension scores, primary gap,
//     observed evidence answers, and which supporting resources (if any)
//     were triggered — so she has everything needed to personalise follow-up
//     or manually add the lead to a tracking sheet.
//
// No Airtable this time — kept deliberately simple (email only), matching
// what the spec actually requires. You can add a CRM step later the same
// way earlier tools did, if useful.
//
// ── PROJECT STRUCTURE ─────────────────────────────────────────────
//   your-project/
//     index.html
//     worker.js          ← this file
//     wrangler.jsonc      ← companion config, also at repo root
//
// ── SETUP ─────────────────────────────────────────────────────────
// Reuse your existing Resend account/API key and verified brendablanche.site
// domain if you still have them from earlier tools. If not: sign up free at
// resend.com, verify a sending domain, grab an API key (re_...).
//
// ── CLOUDFLARE PAGES ENV VARS ────────────────────────────────────
//      RESEND_API_KEY
//      NOTIFY_EMAIL     — your inbox, e.g. brenda@brendablanche.site
//      FROM_EMAIL       — a verified sender, e.g. reports@brendablanche.site
//
// The page POSTs here with: { name, email, whatsapp, workType,
// workDescription, yearsExperience, urgency, offerStatusRaw, overallScore,
// category, dimensionScores, primaryGap, supportingGaps, recommendedProduct,
// routeReason, derivedOfferStatus, derivedProofStatus, marketConflict,
// marketingConsent, whatsappConsent, evidenceAnswers }

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/notify' && request.method === 'POST') {
      return handleNotify(request, env);
    }

    return env.ASSETS.fetch(request);
  }
};

async function handleNotify(request, env) {
  let data;
  try {
    data = await request.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const {
    name = 'there',
    email = '',
    whatsapp = 'Not provided',
    workType = '',
    workDescription = '',
    yearsExperience = '',
    offerStatus = '',
    overallScore = 0,
    category = 'Unknown',
    dimensionScores = {},
    primaryGap = 'Unknown',
    marketingConsent = false,
    whatsappConsent = false,
    evidenceAnswers = {},
    supportingGaps = [],
    recommendedProduct = 'Perception Call',
    routeReason = '',
    derivedOfferStatus = '',
    derivedProofStatus = '',
    marketConflict = false,
    urgency = '',
    offerStatusRaw = ''
  } = data;

  const dimLabels = {
    BC: 'Buyer Clarity (out of 25)',
    PC: 'Problem Clarity (out of 25)',
    OC: 'Outcome Clarity (out of 15)',
    PR: 'Proof Clarity (out of 15)',
    AC: 'Action Clarity (out of 20)'
  };

  const dimRows = Object.entries(dimensionScores)
    .map(([key, score]) => `<tr><td style="color:#6E6570">${dimLabels[key] || key}</td><td>${score}${key === primaryGapKeyFromLabel(primaryGap) ? ' \u2190 primary gap' : ''}</td></tr>`)
    .join('');

  function primaryGapKeyFromLabel(label) {
    const map = { 'Buyer Clarity': 'BC', 'Problem Clarity': 'PC', 'Outcome Clarity': 'OC', 'Proof Clarity': 'PR', 'Action Clarity': 'AC' };
    return map[label] || '';
  }

  // ── Email 1: to the LEAD — their own result summary ──────────────
  const leadEmailHtml = `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#14100F">
      <p style="font-size:12px;letter-spacing:1px;text-transform:uppercase;color:#E4007C;margin-bottom:4px">
        LinkedIn Buyer Confusion Scorecard
      </p>
      <h2 style="margin:0 0 16px">Hi ${name}, your result is ready</h2>
      <p style="font-size:14px;line-height:1.6;color:#333">
        <strong>Buyer Clarity Score:</strong> ${overallScore}/100<br>
        <strong>Result:</strong> ${category}<br>
        <strong>Primary gap:</strong> ${primaryGap}
      </p>
      <p style="font-size:11px;font-style:italic;color:#888">The higher your Buyer Clarity Score, the easier it is for the market to understand your value.</p>
      <p style="font-size:13px;line-height:1.6;color:#333">
        Your profile may be communicating more \u2014 or less \u2014 than you intend. The important question is whether a relevant buyer can quickly understand what they could hire you for.
      </p>
      <p style="font-size:13px;line-height:1.6;color:#333">
        <strong>Recommended route:</strong> ${recommendedProduct}<br>${routeReason}
      </p>
      <p style="font-size:11px;font-style:italic;color:#888;line-height:1.6">
        This is a directional diagnostic based on your responses and reported market signals. It is not an objective market study, a guarantee of demand, or a prediction of revenue.
      </p>
      <p style="margin-top:20px">
        <a href="https://calendly.com/unapologeticquenn/brand-clarity-call" style="background:#E4007C;color:#fff;padding:12px 20px;text-decoration:none;border-radius:2px;display:inline-block;font-size:13px">Talk It Through With Brenda</a>
      </p>
      <p style="font-size:11px;color:#999;margin-top:24px">The LinkedIn Buyer Confusion Scorecard \u00b7 Brenda Blanche\u2122</p>
    </div>
  `;

  const leadEmailPromise = email
    ? fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: env.FROM_EMAIL,
          to: email,
          subject: `Your Buyer Clarity Score \u2014 ${category}`,
          html: leadEmailHtml
        })
      }).then(async (r) => {
        if (!r.ok) console.error('Resend error (lead email):', await r.text());
      }).catch((err) => console.error('Lead email send failed:', err))
    : Promise.resolve();

  // ── Email 2: to BRENDA — full submission notification ────────────
  const evidenceRows = Object.entries(evidenceAnswers)
    .filter(([k]) => !k.match(/^(BC|PC|OC|PR|AC)_q/)) // exclude the raw scored answers, keep evidence/routing/text
    .map(([k, v]) => `<tr><td style="color:#6E6570">${k}</td><td>${v}</td></tr>`)
    .join('');

  const notifyEmailHtml = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#14100F">
      <p style="font-size:12px;letter-spacing:1px;text-transform:uppercase;color:#E4007C;margin-bottom:4px">
        New Scorecard Completion
      </p>
      <h2 style="margin:0 0 16px">${name} just completed the LinkedIn Buyer Confusion Scorecard</h2>
      <table cellpadding="6" style="border-collapse:collapse;font-size:14px;width:100%;margin-bottom:16px">
        <tr><td style="color:#6E6570">Email</td><td><strong>${email}</strong></td></tr>
        <tr><td style="color:#6E6570">WhatsApp</td><td><strong>${whatsapp}</strong></td></tr>
        <tr><td style="color:#6E6570">Work type</td><td>${workType}</td></tr>
        <tr><td style="color:#6E6570">Years of experience</td><td>${yearsExperience}</td></tr>
        <tr><td style="color:#6E6570">Offer status (raw answer)</td><td>${offerStatusRaw}</td></tr>
        <tr><td style="color:#6E6570">Urgency</td><td>${urgency}</td></tr>
        <tr><td style="color:#6E6570">What they help with</td><td>${workDescription}</td></tr>
        <tr><td style="color:#6E6570">Buyer Clarity Score</td><td><strong>${overallScore}/100</strong></td></tr>
        <tr><td style="color:#6E6570">Category</td><td><strong>${category}</strong></td></tr>
        <tr><td style="color:#6E6570">Primary gap</td><td><strong>${primaryGap}</strong></td></tr>
        <tr><td style="color:#6E6570">Supporting gaps</td><td>${supportingGaps.length ? supportingGaps.join(', ') : 'None'}</td></tr>
        ${dimRows}
        <tr><td style="color:#6E6570">Market conflict flag</td><td>${marketConflict ? '\u26a0\ufe0f YES \u2014 high score but confusion signals present' : 'No'}</td></tr>
        <tr><td style="color:#6E6570">Derived offer status</td><td>${derivedOfferStatus}</td></tr>
        <tr><td style="color:#6E6570">Derived proof status</td><td>${derivedProofStatus}</td></tr>
        <tr><td style="color:#6E6570"><strong>Recommended route</strong></td><td><strong>${recommendedProduct}</strong></td></tr>
        <tr><td style="color:#6E6570">Route reason</td><td>${routeReason}</td></tr>
        <tr><td style="color:#6E6570">Marketing consent?</td><td>${marketingConsent ? 'Yes' : 'No'}</td></tr>
        <tr><td style="color:#6E6570">WhatsApp consent?</td><td>${whatsappConsent ? 'Yes' : 'No'}</td></tr>
      </table>
      <p style="font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#E4007C;margin-top:16px">Reported market signals & routing answers</p>
      <table cellpadding="6" style="border-collapse:collapse;font-size:12px;width:100%">${evidenceRows}</table>
      <p style="font-size:11px;color:#999;margin-top:24px">The LinkedIn Buyer Confusion Scorecard \u00b7 Brenda Blanche\u2122</p>
    </div>
  `;

  const notifyEmailPromise = fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: env.FROM_EMAIL,
      to: env.NOTIFY_EMAIL,
      subject: `\ud83d\udd14 ${name} completed the Scorecard \u2014 ${category} (${overallScore}/100)`,
      html: notifyEmailHtml
    })
  }).then(async (r) => {
    if (!r.ok) console.error('Resend error (notify email):', await r.text());
  }).catch((err) => console.error('Notify email send failed:', err));

  await Promise.allSettled([leadEmailPromise, notifyEmailPromise]);

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}
