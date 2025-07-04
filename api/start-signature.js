import fetch from 'node-fetch';
import FormData from 'form-data';
const express = require('express');
const fs = require('fs');
const path = require('path');
const { PDFDocument } = require('pdf-lib');

const apiBaseUrl = 'https://api-sandbox.yousign.app/v3';
const apiKey = process.env.YOUSIGN_API_KEY;

const router = express.Router();

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const { first_name, last_name, email } = req.body;
    console.log('Received signature request for:', { first_name, last_name, email });
    // Fill NDA-template.pdf with user input
    const templatePath = path.join(__dirname, '../public/NDA-template.pdf');
    const pdfBytes = fs.readFileSync(templatePath);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const form = pdfDoc.getForm();
    form.getTextField('firstName').setText(first_name || '');
    form.getTextField('lastName').setText(last_name || '');
    form.getTextField('adress').setText(email || ''); // Using email for address field as no address field in form
    form.flatten();
    const filledPdfBytes = await pdfDoc.save();
    // Use the filled PDF for Yousign
    const pdfBuffer = Buffer.from(filledPdfBytes);
    // 1. Create signature request
    let response = await fetch(`${apiBaseUrl}/signature_requests`, {
      method: 'POST',
      headers: {
        'Content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        name: 'Signature Request',
        delivery_mode: 'email',
        timezone: 'Europe/Paris',
      }),
    });
    const signatureRequest = await response.json();
    console.log('Signature request creation response:', signatureRequest);
    if (!signatureRequest.id) {
      console.error('Failed to create signature request:', signatureRequest);
      return res.status(500).json({ error: 'Failed to create signature request', details: signatureRequest });
    }
    // 2. Upload document
    const formData = new FormData();
    formData.append('file', pdfBuffer, 'file.pdf');
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
    console.log('Document upload response:', document);
    if (!document.id) {
      console.error('Failed to upload document:', document);
      return res.status(500).json({ error: 'Failed to upload document', details: document });
    }

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
    console.log('Signer creation response:', signer);
    if (!signer.id) {
      console.error('Failed to add signer:', signer);
      return res.status(500).json({ error: 'Failed to add signer', details: signer });
    }

    // 4. Activate signature request
    response = await fetch(`${apiBaseUrl}/signature_requests/${signatureRequest.id}/activate`, {
      method: 'POST',
      headers: {
        'Content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
    });
    const activateResp = await response.json();
    console.log('Activation response:', activateResp);

    // Try to get signature link from activation response
    let signatureLink = activateResp.signers?.[0]?.signature_link || null;
    if (signatureLink) {
      console.log('Signature link found in activation response:', signatureLink);
      return res.status(200).json({ iframeUrl: signatureLink, signatureRequestId: signatureRequest.id });
    }

    // 5. Poll for signature_link in the signers array (up to 20 attempts, 5s apart)
    const maxAttempts = 20;
    const delay = ms => new Promise(res => setTimeout(res, ms));

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      response = await fetch(`${apiBaseUrl}/signature_requests/${signatureRequest.id}`, {
        headers: {
          authorization: `Bearer ${apiKey}`,
        },
      });
      const sigReqDetails = await response.json();
      console.log(`Polling attempt ${attempt + 1}:`, sigReqDetails);
      signatureLink = sigReqDetails.signers?.[0]?.signature_link;
      if (signatureLink) {
        console.log('Signature link found during polling:', signatureLink);
        return res.status(200).json({ iframeUrl: signatureLink, signatureRequestId: signatureRequest.id });
      }
      await delay(5000); // wait 5 seconds before next attempt
    }

    console.error('Failed to get signature link after polling for request:', signatureRequest.id);
    return res.status(500).json({ error: 'Failed to get signature link after polling.' });
  } catch (err) {
    console.error('Error in start-signature:', err);
    res.status(500).json({ error: err.message });
  }
}

// New endpoint to fill NDA-template.pdf with user input
router.post('/fill-nda', async (req, res) => {
  try {
    const { firstName, lastName, address } = req.body;
    const templatePath = path.join(__dirname, '../public/NDA-template.pdf');
    const pdfBytes = fs.readFileSync(templatePath);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const form = pdfDoc.getForm();

    form.getTextField('firstName').setText(firstName || '');
    form.getTextField('lastName').setText(lastName || '');
    form.getTextField('adress').setText(address || '');

    form.flatten(); // Optional: make fields uneditable
    const filledPdfBytes = await pdfDoc.save();

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="NDA-filled.pdf"',
    });
    res.send(Buffer.from(filledPdfBytes));
  } catch (err) {
    console.error('Error filling NDA PDF:', err);
    res.status(500).send('Failed to fill NDA PDF');
  }
}); 