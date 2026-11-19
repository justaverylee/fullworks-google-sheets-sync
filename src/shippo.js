export async function getShippoToken(env) {
  return env.shippo_token;
}

export async function parseAddress(token, address) {
  const [name, ...addressLines] = address.trim().split(/\r?\n/);
  const addressText = addressLines
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ');
  if (!addressText) {
    throw new Error('Address must include details after the name line.');
  }

  const url = new URL('https://api.goshippo.com/v2/addresses/parse');
  url.searchParams.set('address', addressText);

  const response = await fetch(url, {
    headers: {
      Authorization: `ShippoToken ${token}`,
      Accept: 'application/json',
    },
  });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(
      `Shippo address parsing failed (${response.status}): ${JSON.stringify(result)}`
    );
  }

  // it appears that Shippo's address parser here uses an old address syntax. We migrate to the new one here. I'm sure there are fields missing
  return {
    name: name.trim(),
    street1: result.address_line_1,
    street2: result.address_line_2,
    city: result.city_locality,
    state: result.state_province,
    zip: result.postal_code,
    country: 'US',
    phone: result.phone,
    email: result.email,
  };
}

export async function createShippoOrder(token, address, order) {
  const response = await fetch('https://api.goshippo.com/orders/', {
    headers: {
      Authorization: `ShippoToken ${token}`,
      'Content-Type': 'application/json',
    },
    method: 'POST',
    body: JSON.stringify({
      to_address: address,
      line_items: [
        {
          quantity: order.details.units,
          sku: 'FIXTHEL8BUS',
          title: "L'eighty Bus",
          weight: '0.25',
          weight_unit: 'kg',
        },
      ],
      placed_at: new Date().toISOString(),
      order_number: order.orderNumber,
      weight: 0.25 * order.details.units,
      weight_unit: 'kg',
    }),
  });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(
      `Shippo order creation failed (${response.status}): ${JSON.stringify(result)}`
    );
  }
  return result;
}
