async function importPrivateKey(pemKey) {
  const pemHeader = '-----BEGIN PRIVATE KEY-----';
  const pemFooter = '-----END PRIVATE KEY-----';
  const pemContents = pemKey
    .replace(pemHeader, '')
    .replace(pemFooter, '')
    .replace(/\s/g, '');

  const binaryDerString = atob(pemContents);
  const binaryDer = new Uint8Array(binaryDerString.length);
  for (let i = 0; i < binaryDerString.length; i++) {
    binaryDer[i] = binaryDerString.charCodeAt(i);
  }

  return await crypto.subtle.importKey(
    'pkcs8',
    binaryDer.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
}

// Helper: Base64URL encode string or Uint8Array
function base64UrlEncode(data) {
  let string = '';
  if (typeof data === 'string') {
    string = btoa(data);
  } else {
    string = btoa(String.fromCharCode(...new Uint8Array(data)));
  }
  return string.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function getGoogleAccessToken(serviceAccountJson) {
  const sa =
    typeof serviceAccountJson === 'string'
      ? JSON.parse(serviceAccountJson)
      : serviceAccountJson;

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claimSet = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: sa.token_uri,
    exp: now + 3600,
    iat: now,
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedClaimSet = base64UrlEncode(JSON.stringify(claimSet));
  const signatureInput = `${encodedHeader}.${encodedClaimSet}`;

  const cryptoKey = await importPrivateKey(sa.private_key);
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(signatureInput)
  );

  const jwt = `${signatureInput}.${base64UrlEncode(signature)}`;

  const response = await fetch(sa.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  const tokenData = await response.json();
  if (!response.ok) {
    throw new Error(
      `Failed to obtain Google OAuth token: ${JSON.stringify(tokenData)}`
    );
  }

  return tokenData.access_token;
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const [datePart, timePart] = dateStr.trim().split(' ');
  if (!datePart || !timePart) return dateStr;

  const [day, month, year] = datePart.split('/');
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')} ${timePart}`;
}

function parseOrderPricing(totalPriceStr) {
  if (!totalPriceStr) {
    return { items: '0', fulfillment: 'Unknown' };
  }

  const total = parseFloat(totalPriceStr.replace(/[^0-9.]/g, ''));
  if (isNaN(total) || total <= 0) {
    return { items: '0', fulfillment: 'Unknown' };
  }

  // Estimate pre-tax amount assuming an average ~6.5% sales tax
  const ESTIMATED_TAX_MULTIPLIER = 1.065;
  const preTaxEstimate = total / ESTIMATED_TAX_MULTIPLIER;

  // Option A: Assume Pickup ($0 shipping)
  const pickupUnits = Math.round(preTaxEstimate / 30);
  const pickupExpectedPreTax = pickupUnits * 30;
  const pickupError = Math.abs(preTaxEstimate - pickupExpectedPreTax);

  // Option B: Assume Shipped ($10 shipping)
  const shippedUnits = Math.max(1, Math.round((preTaxEstimate - 10) / 30));
  const shippedExpectedPreTax = shippedUnits * 30 + 10;
  const shippedError = Math.abs(preTaxEstimate - shippedExpectedPreTax);

  // Determine whether Pickup or Shipped is mathematically closer
  let isShipped = shippedError < pickupError;
  let units = isShipped ? shippedUnits : Math.max(1, pickupUnits);

  return {
    items: units,
    fulfillment: isShipped ? 'Shipped' : 'In Person',
  };
}

export default async function syncOrdersToGoogleSheet(orders, env) {
  const accessToken = await getGoogleAccessToken(
    env.google_sheets_service_account
  );
  const spreadsheetId = env.sheetid;
  const sheetName = env.sheetname;

  // 1. Fetch current rows from sheet
  const getUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${sheetName}!A1:Z`;
  const getRes = await fetch(getUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const sheetData = await getRes.json();
  const rows = sheetData.values || [];

  if (rows.length === 0) {
    throw new Error('Sheet is empty or headers are missing in Row 1.');
  }

  const headers = rows[0];
  const orderNumColIdx = headers.indexOf('Order Number');

  if (orderNumColIdx === -1) {
    throw new Error("Header 'Order Number' not found in Row 1.");
  }

  // 2. Map existing Order Numbers to row indices (1-indexed for Sheets)
  const existingOrderRowMap = new Map();
  for (let r = 1; r < rows.length; r++) {
    const orderNo = String(rows[r][orderNumColIdx] || '').trim();
    if (orderNo && !isNaN(orderNo)) {
      existingOrderRowMap.set(orderNo, r + 1);
    }
  }

  // 3. Define System Column Mapping
  const systemCols = {
    'Order Number': (o) => o.orderNumber,
    Name: (o) => o.name,
    'Order Date': (o) => formatDate(o.createdAt),
    Units: (o) => parseOrderPricing(o.totalPrice).items,
    'Pickup Method': (o) => parseOrderPricing(o.totalPrice).fulfillment, // "Shipped" or "Pickup"
  };

  const updateRequests = [];
  const rowsToAppend = [];

  // 4. Determine updates vs appends
  for (const order of orders) {
    const orderKey = String(order.orderNumber).trim();

    if (existingOrderRowMap.has(orderKey)) {
      // UPDATE: Existing order -> update specific cells on its row
      const targetRow = existingOrderRowMap.get(orderKey);

      Object.entries(systemCols).forEach(([colName, getValue]) => {
        const colIdx = headers.indexOf(colName);
        if (colIdx !== -1) {
          // Convert 0-indexed column offset to A1 letter
          const colLetter = String.fromCharCode(65 + colIdx);
          updateRequests.push({
            range: `${sheetName}!${colLetter}${targetRow}`,
            values: [[getValue(order)]],
          });
        }
      });
    } else {
      // NEW: Build a full row array up to the total width of existing columns
      const newRow = new Array(headers.length).fill('');
      Object.entries(systemCols).forEach(([colName, getValue]) => {
        const colIdx = headers.indexOf(colName);
        if (colIdx !== -1) {
          newRow[colIdx] = getValue(order);
        }
      });
      rowsToAppend.push(newRow);
    }
  }

  // 5. Execute Batch Update for existing rows
  if (updateRequests.length > 0) {
    const batchUpdateUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`;
    await fetch(batchUpdateUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        valueInputOption: 'USER_ENTERED',
        data: updateRequests,
      }),
    });
  }
  console.log('update requests' + JSON.stringify(updateRequests));

  // 6. Execute Append for new rows
  if (rowsToAppend.length > 0) {
    const appendUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${sheetName}!A1:append?valueInputOption=USER_ENTERED`;
    await fetch(appendUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        values: rowsToAppend,
      }),
    });
  }
  console.log('append requests' + JSON.stringify(rowsToAppend));
}
