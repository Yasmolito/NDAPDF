const apiBaseUrl = 'https://api-sandbox.yousign.app/v3';
const apiKey = process.env.YOUSIGN_API_KEY;

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { signatureRequestId, signerId } = req.query;
  if (!signatureRequestId || !signerId) {
    return res.status(400).json({ error: 'Missing parameters' });
  }
  const response = await fetch(
    `${apiBaseUrl}/signature_requests/${signatureRequestId}/signers/${signerId}/audit_trails`,
    {
      headers: { authorization: `Bearer ${apiKey}` }
    }
  );
  const data = await response.json();
  res.json(data);
} 