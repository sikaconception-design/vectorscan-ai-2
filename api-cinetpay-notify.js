// Vercel Serverless Function : /api/cinetpay-notify
// Appelée automatiquement par CinetPay après chaque paiement (jamais par le navigateur).
// Vérifie le statut réel auprès de CinetPay avant de mettre à jour l'abonnement.

import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  try {
    const CINETPAY_APIKEY = process.env.CINETPAY_APIKEY;
    const CINETPAY_SITE_ID = process.env.CINETPAY_SITE_ID;
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    const transactionId = req.body?.cpm_trans_id || req.query?.cpm_trans_id;
    if (!transactionId) return res.status(400).send('missing transaction id');

    const checkRes = await fetch('https://api-checkout.cinetpay.com/v2/payment/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apikey: CINETPAY_APIKEY, site_id: CINETPAY_SITE_ID, transaction_id: transactionId }),
    });
    const checkData = await checkRes.json();
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    if (checkData.code === '00' && checkData.data?.status === 'ACCEPTED') {
      const { data: payment } = await supabase
        .from('payments')
        .update({ status: 'success', updated_at: new Date().toISOString() })
        .eq('cinetpay_transaction_id', transactionId)
        .select('org_id, amount, description')
        .single();

      if (payment?.org_id) {
        const nextMonth = new Date();
        nextMonth.setMonth(nextMonth.getMonth() + 1);
        const update = { status: 'active', current_period_end: nextMonth.toISOString().slice(0, 10) };
        try {
          const purchase = JSON.parse(payment.description || '{}');
          if (purchase.extra_users || purchase.extra_scan_tiers) {
            const { data: org } = await supabase.from('organizations').select('extra_users, extra_scan_tiers').eq('id', payment.org_id).single();
            if (org) {
              update.extra_users = (org.extra_users || 0) + (purchase.extra_users || 0);
              update.extra_scan_tiers = (org.extra_scan_tiers || 0) + (purchase.extra_scan_tiers || 0);
            }
          }
        } catch (_e) { /* description sans données d'achat structurées */ }
        await supabase.from('organizations').update(update).eq('id', payment.org_id);
      }
    } else {
      await supabase.from('payments').update({ status: 'failed', updated_at: new Date().toISOString() }).eq('cinetpay_transaction_id', transactionId);
    }

    return res.status(200).send('ok');
  } catch (e) {
    return res.status(500).send(String(e?.message || e));
  }
}
