// Vercel Serverless Function : /api/create-payment
// Crée une demande de paiement CinetPay (nouvelle plateforme officielle "cinetpay-js")
// et renvoie le lien de paiement au navigateur.
// Les identifiants CinetPay ne quittent JAMAIS ce serveur.

import { createClient } from '@supabase/supabase-js';
import { CinetPayClient } from 'cinetpay-js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  try {
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

    const cinetpay = new CinetPayClient({
      credentials: {
        CI: {
          apiKey: process.env.CINETPAY_API_KEY,
          apiPassword: process.env.CINETPAY_API_PASSWORD,
        },
      },
    });

    const payment = await cinetpay.payment.initialize({
      currency: 'XOF',
      merchantTransactionId: transactionId,
      amount: Math.round(amount),
      lang: 'fr',
      designation: humanDescription,
      clientEmail: userData.user.email || 'client@vectorscan.app',
      clientFirstName: userData.user.user_metadata?.name || 'Client',
      clientLastName: 'VectorScan',
      successUrl: `${APP_URL}/`,
      failedUrl: `${APP_URL}/`,
      notifyUrl: `${APP_URL}/api/cinetpay-notify`,
      channel: 'PUSH',
    }, 'CI');

    if (!payment?.paymentUrl) {
      return res.status(400).json({ error: 'CinetPay n\'a pas renvoyé de lien de paiement' });
    }

    return res.status(200).json({ payment_url: payment.paymentUrl });
  } catch (e) {
    const detail = e?.cause?.message || e?.cause?.code || e?.message || String(e);
    console.error('ERREUR create-payment:', e);
    return res.status(500).json({ error: 'Erreur serveur : ' + detail });
  }
}
