// Vercel Serverless Function : /api/create-payment
// Crée une demande de paiement CinetPay et renvoie le lien de paiement au navigateur.
// La clé secrète CinetPay ne quitte JAMAIS ce serveur.

import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  try {
    const CINETPAY_APIKEY = process.env.CINETPAY_APIKEY;
    const CINETPAY_SITE_ID = process.env.CINETPAY_SITE_ID;
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const APP_URL = process.env.APP_URL || 'https://vectorscan-ai-2.vercel.app';

    const authHeader = req.headers['authorization'] || '';
    const jwt = authHeader.replace('Bearer ', '');
    if (!jwt) return res.status(401).json({ error: 'Non authentifié' });

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
    if (userErr || !userData?.user) {
      return res.status(401).json({ error: 'Non authentifié' });
    }

    const { data: profile } = await supabase.from('profiles').select('org_id').eq('id', userData.user.id).single();
    if (!profile?.org_id) {
      return res.status(400).json({ error: 'Aucune organisation associée à ce compte' });
    }
    const { data: org } = await supabase.from('organizations').select('*').eq('id', profile.org_id).single();
    if (!org) return res.status(404).json({ error: 'Organisation introuvable' });

    const amount = Number(req.body?.amount);
    const humanDescription = String(req.body?.description || 'Abonnement VectorScan AI');
    const purchase = req.body?.purchase || {};
    if (!amount || amount < 100) return res.status(400).json({ error: 'Montant invalide' });

    const transactionId = `VS-${org.id.slice(0, 8)}-${Date.now()}`;

    await supabase.from('payments').insert({
      org_id: org.id, amount, description: JSON.stringify(purchase), status: 'pending', cinetpay_transaction_id: transactionId,
    });

    const cinetpayRes = await fetch('https://api-checkout.cinetpay.com/v2/payment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apikey: CINETPAY_APIKEY,
        site_id: CINETPAY_SITE_ID,
        transaction_id: transactionId,
        amount: Math.round(amount),
        currency: 'XOF',
        description: humanDescription,
        customer_name: userData.user.user_metadata?.name || 'Client',
        customer_surname: 'VectorScan',
        notify_url: `${APP_URL}/api/cinetpay-notify`,
        return_url: `${APP_URL}/`,
        channels: 'ALL',
        metadata: org.id,
      }),
    });
    const cinetpayData = await cinetpayRes.json();

    if (cinetpayData.code !== '201') {
      return res.status(400).json({ error: cinetpayData.description || 'Échec de la création du paiement' });
    }

    return res.status(200).json({ payment_url: cinetpayData.data.payment_url });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
