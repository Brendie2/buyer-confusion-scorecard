// Cloudflare Worker (static assets + form handler)
// Route: POST /api/submit-scorecard
// Deployed automatically because this file lives at /functions/api/submit-scorecard.js
//
// Required environment variables (set in Cloudflare Pages > Settings > Environment variables,
// as *encrypted* secrets, for both Production and Preview):
//   BREVO_API_KEY     - from Brevo > Settings > SMTP & API > API Keys
//   BREVO_LIST_ID      - (optional) numeric ID of the Brevo contact list to add people to
//   RESEND_API_KEY     - from Resend > API Keys
//   RESEND_FROM        - a verified sender on your domain, e.g. "Brenda Blanche <hello@yourdomain.com>"
//   NOTIFY_EMAIL       - (optional) your own inbox, to get an alert every time someone completes the Scorecard
//   CLARITY_CALL_LINK  - (optional) your real Clarity Call booking URL — falls back to "#" if unset
//   BLUEPRINT_LINK     - (optional) your real Blueprint application URL — falls back to "#" if unset
//   NURTURE_LINK       - (optional) WhatsApp link for the "aligned" outcome — defaults to your WhatsApp with a preloaded message
//
// Brevo setup required BEFORE this works:
//   Go to Brevo > Contacts > Settings > Contact Attributes and create these (type Number unless noted):
//     SCORE_TOTAL, SCORE_OFFER, SCORE_MARKET, SCORE_CONTENT
//     RESULT_VERDICT (type Text), PRIMARY_GAP (type Text)
//   Brevo already has FIRSTNAME as a default attribute.
//
// Resend setup required BEFORE this works:
//   Verify your domain in Resend > Domains (add the DNS records they give you to your registrar),
//   then send from an address on that domain.

const CAT_LABEL = { offer: "Offer Clarity", market: "Market Clarity", content: "Content Signals" };
const VERDICT_LABEL = { aligned: "Aligned Perception", competing: "Competing Signals", invisible: "Invisible Expert" };

const COPY = {
  offer: {
    s: "Your offer is clear enough that most people who land on your profile can describe what you do. That's rarer than you'd think.",
    m: "People can tell you're skilled. They can't always tell what, specifically, they'd hire you for.",
    w: "Right now, a stranger looking at your profile would have to guess what you actually sell."
  },
  market: {
    s: "People who know your work would describe you consistently. That consistency is what recognition is built from.",
    m: "You have an association, but it's inconsistent — different people would describe you differently.",
    w: "Right now there isn't a consistent answer to \"what is this person known for.\""
  },
  content: {
    s: "Your content shows your thinking, not just your conclusions — which is what makes someone trust the process.",
    m: "Your content is useful, but it mostly shows what you believe, not how you got there.",
    w: "Right now your content isn't yet connected to a clear next step or a repeated idea."
  }
};

const TIER_LABEL = { s: "Strong signal", m: "Mixed signal", w: "Weak signal" };

const EXERCISES = {
  offer: [
    "In one sentence, no jargon: what do you actually help people do?",
    "Name the exact outcome someone gets after working with you — a result, not a feeling."
  ],
  market: [
    "If three people who know your work were asked what you're known for, what would each of them say right now?",
    "What's the one thing you want all three to say instead?"
  ],
  content: [
    "Look at your last 3 posts. Do they show a conclusion, or the thinking behind it? Write one sentence showing your process instead of your opinion.",
    "What's one phrase or idea you keep coming back to that could become recognizably yours?"
  ]
};

function tierOf(score) { return score >= 12 ? "s" : score >= 7 ? "m" : "w"; }

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const VERDICT_OPENER = {
  aligned: "Your signals are largely doing their job. The work from here isn't a rebuild — it's refinement.",
  competing: "You're not invisible. You're inconsistent. Different people are getting different, incomplete versions of who you are — and none of them are wrong, which is exactly the problem.",
  invisible: "The gap here isn't your skill. It's that almost none of your actual capability is currently visible in what the market can see."
};

function categoryRowHtml(key, score) {
  const tier = tierOf(score);
  const pct = Math.round((score / 16) * 100);
  return `
    <div style="margin-bottom:18px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:4px;"><tr>
        <td style="font-size:11px;font-family:'Courier New',monospace;text-transform:uppercase;letter-spacing:.5px;color:#14100F;opacity:.65;">${CAT_LABEL[key]}</td>
        <td align="right" style="font-size:11px;font-family:'Courier New',monospace;text-transform:uppercase;letter-spacing:.5px;color:#14100F;opacity:.65;">${TIER_LABEL[tier]}</td>
      </tr></table>
      <div style="margin-bottom:6px;">
        <span style="font-family:Georgia,serif;font-weight:bold;font-size:20px;">${score}<span style="font-size:12px;opacity:.5;"> /16</span></span>
      </div>
      <div style="background:#e9e2d8;border-radius:4px;height:8px;overflow:hidden;margin-bottom:8px;">
        <div style="background:#E4007C;height:8px;width:${pct}%;"></div>
      </div>
      <p style="font-size:14px;line-height:1.6;margin:0;color:#14100F;">${COPY[key][tier]}</p>
    </div>`;
}

function buildResultsEmailHtml({ name, overallScore, categoryScores, verdict, weakest, links }) {
  const categoryRows = Object.keys(CAT_LABEL).map(k => categoryRowHtml(k, categoryScores[k])).join("");
  const diagnosis = COPY[weakest][tierOf(categoryScores[weakest])];
  const exerciseItems = EXERCISES[weakest].map(q =>
    `<li style="margin-bottom:14px;font-size:14px;line-height:1.6;">${escapeHtml(q)}<br><span style="display:inline-block;border-bottom:1px solid #14100F;width:100%;height:18px;"></span></li>`
  ).join("");

  const weakCount = Object.values(categoryScores).filter(v => v < 12).length;
  let routeTitle, routeCopy, routeCtaText, routeCtaHref;
  if (weakCount === 0) {
    routeTitle = "Your Next Step";
    routeCopy = "Your signals are strong. The next move is compounding recognition, not fixing a gap. Message me on WhatsApp and let's talk about what's next.";
    routeCtaText = "Message Me on WhatsApp →"; routeCtaHref = links.nurture;
  } else if (weakCount === 1) {
    routeTitle = "Your Next Step";
    routeCopy = "You have one specific gap. A 90-minute Clarity Call is built exactly for this — a focused diagnosis and a clear direction, $79.";
    routeCtaText = "Book Your Clarity Call →"; routeCtaHref = links.clarity;
  } else {
    routeTitle = "Your Next Step";
    routeCopy = "This isn't a single-session fix — it's a sequence. The Market Perception Blueprint walks the full path in 6–8 weeks, $400 founding rate.";
    routeCtaText = "Apply for the Blueprint →"; routeCtaHref = links.blueprint;
  }

  return `
  <div style="font-family:Arial,Helvetica,sans-serif;background:#F5EDE4;padding:32px 16px;color:#14100F;">
    <div style="max-width:560px;margin:0 auto;">

      <p style="font-family:'Courier New',monospace;font-weight:bold;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#E4007C;margin:0 0 6px;">Your Scorecard Result</p>
      <h1 style="font-family:Georgia,serif;font-size:28px;margin:0 0 4px;">Hi ${escapeHtml(name)},</h1>
      <p style="font-size:15px;opacity:.85;margin:0 0 24px;">Here's your full, personalized breakdown — not just the number.</p>

      <div style="background:#ffffff;border-radius:12px;padding:24px;margin-bottom:16px;">
        <div style="margin-bottom:6px;">
          <span style="font-family:Georgia,serif;font-weight:bold;font-size:44px;color:#E4007C;">${overallScore}</span>
          <span style="font-family:'Courier New',monospace;font-size:12px;opacity:.6;margin-left:10px;">out of 48 — reflects three signal areas, not a percentage</span>
        </div>
        <h2 style="font-family:Georgia,serif;font-size:20px;margin:8px 0 4px;">${VERDICT_LABEL[verdict] || verdict}</h2>
        <p style="font-size:14px;line-height:1.6;margin:0;opacity:.9;">${VERDICT_OPENER[verdict] || ""}</p>
      </div>

      <div style="background:#ffffff;border-radius:12px;padding:24px;margin-bottom:16px;">
        <h3 style="font-family:Georgia,serif;font-size:17px;margin:0 0 16px;">Your Breakdown, Category by Category</h3>
        ${categoryRows}
      </div>

      <div style="background:#ffffff;border-radius:12px;padding:24px;margin-bottom:16px;border-left:4px solid #E4007C;">
        <p style="font-family:'Courier New',monospace;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#E4007C;margin:0 0 6px;">Your Biggest Single Gap</p>
        <h3 style="font-family:Georgia,serif;font-size:19px;margin:0 0 8px;">${CAT_LABEL[weakest]}</h3>
        <p style="font-size:14px;line-height:1.6;margin:0;">${diagnosis}</p>
      </div>

      <div style="background:#ffffff;border-radius:12px;padding:24px;margin-bottom:16px;">
        <h3 style="font-family:Georgia,serif;font-size:17px;margin:0 0 6px;">Your Action Plan — Worth Actually Writing</h3>
        <p style="font-size:13px;opacity:.7;margin:0 0 14px;">Two questions, specific to your biggest gap. Answer them now, while it's fresh.</p>
        <ol style="padding-left:18px;margin:0;">${exerciseItems}</ol>
      </div>

      <div style="background:#ffffff;border-radius:12px;padding:24px;text-align:center;">
        <h3 style="font-family:Georgia,serif;font-size:19px;margin:0 0 8px;">${routeTitle}</h3>
        <p style="font-size:14px;line-height:1.6;margin:0 0 16px;">${routeCopy}</p>
        <a href="${routeCtaHref}" style="display:inline-block;background:#E4007C;color:#ffffff;text-decoration:none;font-weight:bold;border-radius:8px;padding:12px 24px;font-size:14px;">${routeCtaText}</a>
      </div>

      <p style="font-size:13px;text-align:center;opacity:.6;margin-top:24px;font-family:'Courier New',monospace;">Brenda Blanche · Market Perception Strategist</p>
    </div>
  </div>`;
}

async function onRequestPost(context) {
  const { request, env } = context;

  let data;
  try {
    data = await request.json();
  } catch (e) {
    return json({ ok: false, error: "Invalid request body" }, 400);
  }

  const { name, email, overallScore, categoryScores, verdict, weakest } = data || {};

  if (!name || !email || typeof email !== "string" || !email.includes("@")) {
    return json({ ok: false, error: "A name and valid email are required" }, 400);
  }
  const okScore = (v) => Number.isInteger(v) && v >= 4 && v <= 16;
  if (
    typeof name !== "string" || name.length > 80 || email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    !categoryScores || typeof categoryScores !== "object" ||
    !okScore(categoryScores.offer) || !okScore(categoryScores.market) || !okScore(categoryScores.content) ||
    overallScore !== categoryScores.offer + categoryScores.market + categoryScores.content ||
    !VERDICT_LABEL[verdict] || !CAT_LABEL[weakest]
  ) {
    return json({ ok: false, error: "Missing or invalid scorecard results" }, 400);
  }
  if (!env.BREVO_API_KEY || !env.RESEND_API_KEY) {
    return json({ ok: false, error: "Server is missing BREVO_API_KEY or RESEND_API_KEY configuration" }, 500);
  }

  let crmSaved = true;
  // 1. Upsert the contact + their results into Brevo (the CRM record)
  try {
    const brevoBody = {
      email,
      updateEnabled: true,
      attributes: {
        FIRSTNAME: name,
        SCORE_TOTAL: overallScore,
        SCORE_OFFER: categoryScores.offer,
        SCORE_MARKET: categoryScores.market,
        SCORE_CONTENT: categoryScores.content,
        RESULT_VERDICT: verdict || "",
        PRIMARY_GAP: weakest || ""
      }
    };
    if (env.BREVO_LIST_ID) brevoBody.listIds = [parseInt(env.BREVO_LIST_ID, 10)];

    const brevoRes = await fetch("https://api.brevo.com/v3/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json", "api-key": env.BREVO_API_KEY },
      body: JSON.stringify(brevoBody)
    });
    if (!brevoRes.ok) {
      crmSaved = false;
      console.error("Brevo rejected the contact:", await brevoRes.text());
    }
  } catch (e) {
    crmSaved = false;
    console.error("Could not reach Brevo");
  }

  // 2. Send the personalized results email via Resend
  let emailedLead = true, emailWarning = null;
  try {
    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${env.RESEND_API_KEY}` },
      body: JSON.stringify({
        from: env.RESEND_FROM || "onboarding@resend.dev",
        to: [email],
        subject: `Your Scorecard result — ${overallScore}/48`,
        html: buildResultsEmailHtml({
          name, overallScore, categoryScores, verdict, weakest,
          links: {
            clarity: env.CLARITY_CALL_LINK || "#",
            blueprint: env.BLUEPRINT_LINK || "#",
            nurture: env.NURTURE_LINK || "https://wa.me/237672411155?text=Hi%20Brenda%2C%20I%20just%20took%20your%20Market%20Perception%20Scorecard%20and%20my%20signals%20came%20out%20strong.%20I%27d%20love%20to%20talk%20about%20what%27s%20next."
          }
        })
      })
    });
    if (!resendRes.ok) {
      emailedLead = false;
      emailWarning = "The results email failed to send: " + (await resendRes.text());
    }
  } catch (e) {
    emailedLead = false;
    emailWarning = "The results email could not be sent";
  }

  // 3. Notify you (Brenda) that a new lead just completed the Scorecard — separate send, never blocks the response
  if (env.NOTIFY_EMAIL) {
    try {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${env.RESEND_API_KEY}` },
        body: JSON.stringify({
          from: env.RESEND_FROM || "onboarding@resend.dev",
          to: [env.NOTIFY_EMAIL],
          subject: `New Scorecard lead: ${name} (${overallScore}/48)`,
          html: `<div style="font-family:Arial,sans-serif;">
            <p><strong>${escapeHtml(name)}</strong> (${escapeHtml(email)}) just completed the Scorecard.</p>
            <p>Overall: ${overallScore}/48 — ${VERDICT_LABEL[verdict] || verdict}</p>
            <p>Offer Clarity: ${categoryScores.offer}/16 · Market Clarity: ${categoryScores.market}/16 · Content Signals: ${categoryScores.content}/16</p>
            <p>Biggest gap: ${CAT_LABEL[weakest] || weakest}</p>
          </div>`
        })
      });
    } catch (e) {
      // Notification failing should never break the visitor's experience — swallow silently.
    }
  }

  return json({ ok: true, emailed: emailedLead, warning: emailWarning, crmSaved });
}


// ---- Cloudflare Pages "advanced mode" entry point (_worker.js) ----
// Sends /api/submit-scorecard to the code above; everything else is served as normal website files.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/submit-scorecard") {
      if (request.method === "POST") return onRequestPost({ request, env });
      // Opening this address in a browser shows a status check (true/false only, never the keys).
      if (request.method === "GET") {
        const set = (k) => Boolean(env[k]);
        return new Response(JSON.stringify({
          running: true,
          RESEND_API_KEY: set("RESEND_API_KEY"),
          RESEND_FROM: set("RESEND_FROM"),
          NOTIFY_EMAIL: set("NOTIFY_EMAIL"),
          BREVO_API_KEY: set("BREVO_API_KEY"),
          BREVO_LIST_ID: set("BREVO_LIST_ID")
        }, null, 2), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
      }
      return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), {
        status: 405, headers: { "Content-Type": "application/json", Allow: "POST, GET" }
      });
    }
    return env.ASSETS.fetch(request);
  }
};
