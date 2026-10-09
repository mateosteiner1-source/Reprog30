const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

async function redis(cmd) {
  const r = await fetch(REDIS_URL, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + REDIS_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd)
  });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(j.error || 'redis');
  return j.result;
}

const clean = (v, n) =>
  String(v == null ? '' : v).replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, n);

module.exports = async function (req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!REDIS_URL || !REDIS_TOKEN) {
    return res.status(500).json({ erreur: 'stockage non configuré' });
  }
  try {
    if (req.method === 'GET') {
      const items = await redis(['LRANGE', 'avis', 0, 49]);
      const rows = items
        .map((s) => { try { return JSON.parse(s); } catch (e) { return null; } })
        .filter(Boolean);
      return res.status(200).json(rows);
    }
    if (req.method === 'POST') {
      const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      if (b.site) return res.status(200).json({ ok: true });
      const note = Number(b.note);
      const texte = clean(b.texte, 500);
      if (!(note >= 1 && note <= 5) || Math.floor(note) !== note || texte.length < 5) {
        return res.status(400).json({ erreur: 'avis invalide' });
      }
      const ip = String(req.headers['x-forwarded-for'] || 'inconnu').split(',')[0].trim();
      const ok = await redis(['SET', 'rl:' + ip, '1', 'NX', 'EX', 60]);
      if (!ok) return res.status(429).json({ erreur: 'trop rapide' });
      const avis = {
        prenom: clean(b.prenom, 40) || 'Client',
        note: note,
        prestation: clean(b.prestation, 80),
        texte: texte,
        date: new Date().toISOString()
      };
      await redis(['LPUSH', 'avis', JSON.stringify(avis)]);
      await redis(['LTRIM', 'avis', 0, 199]);
      return res.status(201).json({ ok: true });
    }
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ erreur: 'méthode non autorisée' });
  } catch (e) {
    return res.status(500).json({ erreur: 'erreur serveur' });
  }
};
