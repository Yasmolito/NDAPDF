export default async function handler(req, res) {
  const { id } = req.query;
  if (!id) {
    res.status(400).json({ error: 'Missing id' });
    return;
  }

  const UPSTASH_REDIS_REST_URL = process.env.UPSTASH_REDIS_REST_URL;
  const UPSTASH_REDIS_REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
  const redisKey = `signature-status:${id}`;

  try {
    const response = await fetch(`${UPSTASH_REDIS_REST_URL}/get/${redisKey}`, {
      headers: {
        Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}`,
      },
    });
    const data = await response.json();
    if (!data.result) {
      res.status(404).json({ status: 'unknown' });
      return;
    }
    res.status(200).json(JSON.parse(data.result));
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch from Redis', details: err.message });
  }
} 