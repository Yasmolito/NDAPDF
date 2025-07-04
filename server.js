import express from 'express';
import fetch from 'node-fetch';
import FormData from 'form-data';
import fs from 'fs';
import cors from 'cors';
import path from 'path';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { PDFDocument } from 'pdf-lib';

const app = express();
const PORT = 3000;

const apiBaseUrl = 'https://api-sandbox.yousign.app/v3';
const apiKey = 't7B3IBDA7Nexoyth128lWqnYEPQaN2x3'; // Replace with your sandbox API key

const __dirname = dirname(fileURLToPath(import.meta.url));

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

app.post('/api/start-signature', async (req, res) => {
  try {
    const { first_name, last_name, email } = req.body;
    // Fill NDA-template.pdf with user input
    const templatePath = path.join(__dirname, 'public/NDA-template2.pdf');
    const pdfBytes = fs.readFileSync(templatePath);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const form = pdfDoc.getForm();
    form.getTextField('firstName').setText(first_name || '');
    form.getTextField('lastName').setText(last_name || '');
    form.getTextField('adress').setText(email || ''); // Using email for address field as no address field in form
    form.flatten();
    const filledPdfBytes = await pdfDoc.save();
    // Save the filled PDF to a temp file
    const filledPath = path.join(__dirname, 'uploads', `NDA-filled-${Date.now()}.pdf`);
    fs.writeFileSync(filledPath, filledPdfBytes);
    // Use the filled PDF for Yousign
    const pdfPath = filledPath;

    // 1. Create signature request
    let response = await fetch(`${apiBaseUrl}/signature_requests`, {
      method: 'POST',
      headers: {
        'Content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        name: 'Signature Request',
        delivery_mode: 'email', // switched back to email
        timezone: 'Europe/Paris',
      }),
    });
    const signatureRequest = await response.json();
    if (!signatureRequest.id) {
      console.error('Yousign error:', signatureRequest);
      throw new Error('Failed to create signature request: ' + JSON.stringify(signatureRequest));
    }

    // 2. Upload document
    const formData = new FormData();
    formData.append('file', fs.createReadStream(pdfPath), 'file.pdf');
    formData.append('nature', 'signable_document');
    response = await fetch(`${apiBaseUrl}/signature_requests/${signatureRequest.id}/documents`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        ...formData.getHeaders(),
      },
      body: formData,
    });
    const document = await response.json();
    if (!document.id) throw new Error('Failed to upload document: ' + JSON.stringify(document));

    // 3. Add signer
    const signerPayload = {
      info: {
        first_name,
        last_name,
        email,
        locale: 'fr',
      },
      signature_authentication_mode: 'no_otp',
      signature_level: 'electronic_signature',
      fields: [{
        document_id: document.id,
        type: 'signature',
        height: 40,
        width: 85,
        page: 1,
        x: 100,
        y: 100,
      }],
    };
    response = await fetch(`${apiBaseUrl}/signature_requests/${signatureRequest.id}/signers`, {
      method: 'POST',
      headers: {
        'Content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(signerPayload),
    });
    const signer = await response.json();
    if (!signer.id) {
      console.error('Yousign signer error:', signer);
      throw new Error('Failed to add signer: ' + JSON.stringify(signer));
    }

    // 4. Activate signature request
    response = await fetch(`${apiBaseUrl}/signature_requests/${signatureRequest.id}/activate`, {
      method: 'POST',
      headers: {
        'Content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
    });
    await response.json();

    // 5. Poll for signature_link in the signers array (up to 30 attempts, 5s apart)
    let signatureLink = null;
    const maxAttempts = 30;
    const delay = ms => new Promise(res => setTimeout(res, ms));

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      response = await fetch(`${apiBaseUrl}/signature_requests/${signatureRequest.id}`, {
        headers: {
          authorization: `Bearer ${apiKey}`,
        },
      });
      const sigReqDetails = await response.json();
      signatureLink = sigReqDetails.signers?.[0]?.signature_link;
      if (signatureLink) break;
      await delay(5000); // wait 5 seconds before next attempt
    }

    if (!signatureLink) {
      throw new Error('Failed to get signature link after polling.');
    }

    res.json({ iframeUrl: signatureLink, signatureRequestId: signatureRequest.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Endpoint to check signature request status
app.get('/api/signature-status/:id', async (req, res) => {
  try {
    const signatureRequestId = req.params.id;
    const response = await fetch(`${apiBaseUrl}/signature_requests/${signatureRequestId}`, {
      headers: {
        authorization: `Bearer ${apiKey}`,
      },
    });
    const sigReqDetails = await response.json();
    res.json({
      status: sigReqDetails.status,
      signers: sigReqDetails.signers?.map(s => ({
        id: s.id,
        status: s.status
      })) || []
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Webhook endpoint for Yousign events
// To use: Register this endpoint URL with Yousign (e.g., https://yourdomain.com/api/yousign-webhook)
// For local testing, use a tool like ngrok to expose your local server to the internet.
app.post('/api/yousign-webhook', express.json(), (req, res) => {
  console.log('Received Yousign webhook:', req.body);
  // TODO: Handle signature completion event here, e.g.:
  // if (req.body.event === 'signature_request.completed') {
  //   // Update your database, notify frontend, etc.
  // }
  res.status(200).send('OK');
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
}); 