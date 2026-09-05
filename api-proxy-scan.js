// Vercel Serverless Function : /api/proxy-scan
// Effectue l'appel à l'IA Claude (Anthropic) à la place du navigateur, en utilisant la clé API
// de l'organisation — cette clé ne quitte JAMAIS ce serveur.
// Vérifie aussi le quota de scans du jour avant d'appeler l'IA.

import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  try {
    const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    const authHeader = req.headers['authorization'] || '';
    const jwt = authHeader.replace('Bearer ', '');
    if (!jwt) return res.status(401).json({ error: 'Non authentifié' });

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
    if (userErr || !userData?.user) return res.status(401).json({ error: 'Non authentifié' });

    const { data: profile } = await supabase.from('profiles').select('org_id').eq('id', userData.user.id).single();
    if (!profile?.org_id) return res.status(400).json({ error: 'Aucune organisation associée à ce compte' });

    const { data: org } = await supabase.from('organizations').select('*').eq('id', profile.org_id).single();
    if (!org) return res.status(404).json({ error: 'Organisation introuvable' });
    if (org.status !== 'active') {
      return res.status(402).json({ error: 'Abonnement suspendu. Rendez-vous sur Plan & Facturation.' });
    }

    const today = new Date().toISOString().slice(0, 10);
    const { data: usageRow } = await supabase.from('usage_daily').select('scan_count').eq('org_id', org.id).eq('day', today).maybeSingle();
    const scansUsed = usageRow?.scan_count || 0;
    const scansIncluded = org.base_scans_included + (org.extra_scan_tiers || 0) * org.scan_tier_size;
    if (scansUsed >= scansIncluded) {
      return res.status(429).json({ error: `Quota de scans du jour atteint (${scansIncluded}). Augmentez votre forfait dans Plan & Facturation.` });
    }

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(req.body),
    });
    const anthropicData = await anthropicRes.json();
    if (!anthropicRes.ok) {
      return res.status(anthropicRes.status).json({ error: anthropicData.error?.message || "Erreur du service IA" });
    }

    await supabase.from('usage_daily').upsert(
      { org_id: org.id, day: today, scan_count: scansUsed + 1 },
      { onConflict: 'org_id,day' }
    );

    return res.status(200).json(anthropicData);
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
