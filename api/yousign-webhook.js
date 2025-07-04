export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  let body = req.body;
  // If body is empty, parse from raw stream
  if (!body || Object.keys(body).length === 0) {
    try {
      const buffers = [];
      for await (const chunk of req) {
        buffers.push(chunk);
      }
      const rawBody = Buffer.concat(buffers).toString();
      body = JSON.parse(rawBody);
      console.log('Parsed raw body:', body);
    } catch (e) {
      console.error('Failed to parse raw body:', e);
      res.status(400).json({ error: 'Invalid JSON' });
      return;
    }
  } else {
    console.log('Parsed req.body:', body);
  }

  // Correct extraction for Yousign webhook payload
  const signatureRequestId = body?.data?.signature_request?.id;
  const status = body?.data?.signature_request?.status;
  const event = body?.event_name || body?.event || null;

  console.log('Extracted signatureRequestId:', signatureRequestId, 'status:', status, 'event:', event);

  if (!signatureRequestId) {
    res.status(400).json({ error: 'Missing signature request ID' });
    return;
  }

  // Inline Upstash Redis logic
  const UPSTASH_REDIS_REST_URL = process.env.UPSTASH_REDIS_REST_URL;
  const UPSTASH_REDIS_REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!UPSTASH_REDIS_REST_URL || !UPSTASH_REDIS_REST_TOKEN) {
    res.status(500).json({ error: 'Redis environment variables not set' });
    return;
  }

  // Store the status/event and full raw payload in Redis
  const redisKey = `signature-status:${signatureRequestId}`;
  const value = JSON.stringify({ status, event, updatedAt: Date.now(), raw: body });

  try {
    const redisResponse = await fetch(`${UPSTASH_REDIS_REST_URL}/set/${redisKey}/${encodeURIComponent(value)}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}`,
        'Content-Type': 'application/json',
      },
    });
    console.log('Redis write response:', redisResponse.status, redisResponse.statusText);
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Failed to update Redis:', err);
    res.status(500).json({ error: 'Failed to update Redis', details: err.message });
  }
} 