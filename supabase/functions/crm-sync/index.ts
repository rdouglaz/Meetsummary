/**
 * crm-sync — Supabase Edge Function
 * Syncs meeting notes + action items to HubSpot or Salesforce.
 * Credentials are passed in the request body (never stored in Supabase secrets —
 * they come from the user's browser localStorage via HTTPS).
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

  const { crm, meetingTitle, summary, actionItems, contactEmail, credentials } = body as {
    crm: string;
    meetingTitle: string;
    summary: string;
    actionItems: string[];
    contactEmail?: string;
    credentials: Record<string, string>;
  };

  const noteText = [
    `Meeting: ${meetingTitle}`,
    "",
    summary ?? "",
    "",
    "Action Items:",
    ...(actionItems ?? []).map((a) => `• ${a}`),
  ].join("\n").slice(0, 65535);

  // ── HubSpot ──────────────────────────────────────────────────────────────────
  if (crm === "hubspot") {
    const { apiKey } = credentials;
    if (!apiKey) return json({ error: "HubSpot API key missing" }, 400);

    const noteRes = await fetch("https://api.hubapi.com/crm/v3/objects/notes", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        properties: {
          hs_note_body: noteText,
          hs_timestamp: new Date().toISOString(),
        },
      }),
    });

    if (noteRes.status === 401 || noteRes.status === 403) {
      return json({ error: "HubSpot authentication failed — verify your Private App Token" }, 401);
    }
    if (!noteRes.ok) {
      const b = await noteRes.json().catch(() => ({})) as { message?: string };
      return json({ error: b?.message ?? `HubSpot error: HTTP ${noteRes.status}` }, 502);
    }

    const noteData = await noteRes.json() as { id?: string };
    const noteId = noteData.id;

    // Optional: associate with contact by email
    if (noteId && contactEmail) {
      const searchRes = await fetch("https://api.hubapi.com/crm/v3/objects/contacts/search", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          filterGroups: [{ filters: [{ propertyName: "email", operator: "EQ", value: contactEmail }] }],
          properties: ["email"],
          limit: 1,
        }),
      }).catch(() => null);

      if (searchRes?.ok) {
        const searchData = await searchRes.json() as { results?: { id: string }[] };
        const contactId = searchData.results?.[0]?.id;
        if (contactId) {
          await fetch(
            `https://api.hubapi.com/crm/v3/objects/notes/${noteId}/associations/contact/${contactId}/202`,
            { method: "PUT", headers: { Authorization: `Bearer ${apiKey}` } },
          ).catch(() => {});
        }
      }
    }

    return json({ ok: true });
  }

  // ── Salesforce ─────────────────────────────────────────────────────────────
  if (crm === "salesforce") {
    const { instanceUrl, clientId, clientSecret, username, password, securityToken } = credentials;
    if (!instanceUrl || !clientId || !username || !password) {
      return json({ error: "Salesforce credentials incomplete — instanceUrl, clientId, username, password required" }, 400);
    }

    // Step 1: OAuth username+password flow
    const loginUrl = instanceUrl.startsWith("https://")
      ? instanceUrl
      : `https://${instanceUrl}`;

    const authParams = new URLSearchParams({
      grant_type: "password",
      client_id: clientId,
      client_secret: clientSecret ?? "",
      username,
      password: password + (securityToken ?? ""),
    });

    const authRes = await fetch(`${loginUrl}/services/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: authParams,
    });

    if (!authRes.ok) {
      const b = await authRes.json().catch(() => ({})) as { error_description?: string };
      return json({ error: b?.error_description ?? `Salesforce auth failed: HTTP ${authRes.status}` }, 502);
    }

    const { access_token, instance_url: sfUrl } = await authRes.json() as {
      access_token: string;
      instance_url: string;
    };

    const sfBase = sfUrl || loginUrl;

    // Step 2: Create a Note or Tasks in Salesforce
    const description = noteText.slice(0, 32000);

    // Create one Task with the full summary, then create individual tasks for action items
    const results = await Promise.all([
      // Main meeting note
      fetch(`${sfBase}/services/data/v59.0/sobjects/Task/`, {
        method: "POST",
        headers: { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          Subject: `Meeting Summary: ${meetingTitle}`.slice(0, 255),
          Description: description,
          Status: "Completed",
          Priority: "Normal",
          ActivityDate: new Date().toISOString().slice(0, 10),
        }),
      }).then(r => r.ok).catch(() => false),
      // Individual action items as open tasks
      ...(actionItems ?? []).map((task) =>
        fetch(`${sfBase}/services/data/v59.0/sobjects/Task/`, {
          method: "POST",
          headers: { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            Subject: task.slice(0, 255),
            Description: `From meeting: ${meetingTitle}`,
            Status: "Not Started",
            Priority: "Normal",
          }),
        }).then(r => r.ok).catch(() => false)
      ),
    ]);

    const failed = results.filter((ok) => !ok).length;
    if (failed > 0) {
      return json({ error: `${failed}/${results.length} Salesforce records failed — check your permissions` }, 502);
    }

    return json({ ok: true });
  }

  return json({ error: `Unknown CRM: ${crm}` }, 400);
});
