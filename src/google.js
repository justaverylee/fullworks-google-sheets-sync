const systemCols = {
  'Order Number': (o) => o.orderNumber,
  Name: (o) => o.name,
  'Order Date': (o) => formatDate(o.createdAt),
  Units: (o) => o.details.units,
  'Pickup Method': (o) => o.details.fulfillment, // "Shipped" or "Pickup"
  Email: (o) => o.details.email,
};

const colsNeedingDetails = ['Units', 'Pickup Method', 'Email'];

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

function formatDate(dateStr) {
  if (!dateStr) return '';
  const [datePart, timePart] = dateStr.trim().split(' ');
  if (!datePart || !timePart) return dateStr;

  const [day, month, year] = datePart.split('/');
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')} ${timePart}`;
}

export async function getToken(env) {
  const sa = JSON.parse(env.google_sheets_service_account);

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

export async function getExistingOrderKeys(token, env) {
  const spreadsheetId = env.sheetid;
  const sheetName = env.sheetname;

  const getUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${sheetName}!A1:Z`;
  const getRes = await fetch(getUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const sheetData = await getRes.json();
  const rows = sheetData.values || [];  if (rows.length === 0) return { headers: [], existingOrderRowMap: new Map() };

  const headers = rows[0];
  const orderNumColIdx = headers.indexOf('Order Number');
  const existingOrderRowMap = new Map();

  if (orderNumColIdx !== -1) {
    for (let r = 1; r < rows.length; r++) {
      const orderNo = String(rows[r][orderNumColIdx] || '').trim();
      if (orderNo) existingOrderRowMap.set(orderNo, r + 1);
    }
  }

  return { headers, existingOrderRowMap };
}

export async function syncOrdersToGoogleSheet(
  token,
  headers,
  orders,
  existingOrderRowMap,
  env
) {
  const spreadsheetId = env.sheetid;
  const sheetName = env.sheetname;

  if (headers.length === 0) {
    throw new Error('Sheet is empty or headers are missing in Row 1.');
  }

  const updateRequests = [];
  const rowsToAppend = [];

  for (const order of orders) {
    const orderKey = String(order.orderNumber).trim();

    if (existingOrderRowMap.has(orderKey)) {
      // Existing order -> update status/system values in place
      const targetRow = existingOrderRowMap.get(orderKey);

      Object.entries(systemCols).forEach(([colName, getValue]) => {
        // Skip detail updates for existing orders if details weren't scraped
        if (colsNeedingDetails.includes(colName) && !order.details) {
          return;
        }

        const colIdx = headers.indexOf(colName);
        if (colIdx !== -1) {
          const colLetter = String.fromCharCode(65 + colIdx);
          updateRequests.push({
            range: `${sheetName}!${colLetter}${targetRow}`,
            values: [[getValue(order)]],
          });
        }
      });
    } else {
      // New order -> construct a complete row
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

  // Batch Update existing rows
  if (updateRequests.length > 0) {
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          valueInputOption: 'USER_ENTERED',
          data: updateRequests,
        }),
      }
    );
  }

  // Append new rows
  if (rowsToAppend.length > 0) {
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${sheetName}!A1:append?valueInputOption=USER_ENTERED`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ values: rowsToAppend }),
      }
    );
  }
}
