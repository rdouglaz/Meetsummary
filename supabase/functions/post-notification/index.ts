/**
 * post-notification — Supabase Edge Function
 * Relays meeting summaries to Slack or Microsoft Teams incoming webhooks.
 * Browser can't POST to these directly due to CORS restrictions.
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } },
  );
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return json({ error: "Unauthorized" }, 401);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }

  const { platform, webhookUrl, meetingTitle, summary, actionItems, meetingUrl } = body as {
    platform: "slack" | "teams";
    webhookUrl: string;
    meetingTitle: string;
    summary: string;
    actionItems: string[];
    meetingUrl?: string;
  };

  if (!webhookUrl?.startsWith("https://")) {
    return json({ error: "Invalid webhook URL — must be HTTPS" }, 400);
  }
  if (!platform || !meetingTitle) {
    return json({ error: "Missing required fields: platform, meetingTitle" }, 400);
  }

  const items = (actionItems ?? []).slice(0, 20);
  let payload: Record<string, unknown>;

  if (platform === "slack") {
    const blocks: unknown[] = [
      {
        type: "header",
        text: { type: "plain_text", text: `📋 ${meetingTitle}`, emoji: true },
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: (summary ?? "Meeting completed.").slice(0, 3000) },
      },
    ];

    if (items.length > 0) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Action Items (${items.length}):*\n${items.map((a) => `• ${a}`).join("\n")}`,
        },
      });
    }

    if (meetingUrl) {
      blocks.push({
        type: "actions",
        elements: [{
          type: "button",
          text: { type: "plain_text", text: "View Meeting" },
          url: meetingUrl,
          style: "primary",
        }],
      });
    }

    payload = { blocks, text: `Meeting summary: ${meetingTitle}` };
  } else {
    // Microsoft Teams — Adaptive Card via Incoming Webhook
    const facts = items.map((a, i) => ({ title: `${i + 1}.`, value: a }));
    payload = {
      type: "message",
      attachments: [{
        contentType: "application/vnd.microsoft.card.adaptive",
        content: {
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
          type: "AdaptiveCard",
          version: "1.4",
          body: [
            {
              type: "TextBlock",
              text: `📋 ${meetingTitle}`,
              weight: "Bolder",
              size: "Medium",
            },
            {
              type: "TextBlock",
              text: (summary ?? "Meeting completed.").slice(0, 2000),
              wrap: true,
            },
            ...(facts.length > 0 ? [{
              type: "FactSet",
              facts,
            }] : []),
          ],
          ...(meetingUrl ? {
            actions: [{
              type: "Action.OpenUrl",
              title: "View Meeting",
              url: meetingUrl,
            }],
          } : {}),
        },
      }],
    };
  }

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return json({ error: `Webhook returned ${res.status}: ${text.slice(0, 200)}` }, 502);
  }

  return json({ ok: true });
});
