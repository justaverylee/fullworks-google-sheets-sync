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

    return { ...result, name: name.trim(), country: 'USA' };
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
                    "quantity": order.details.units,
                    "sku": "FIXTHEL8BUS",
                    title: "L'eighty Bus",
                    weight: "0.25",
                    "weight_unit": "kg",
                }
            ],
            placed_at: new Date().toISOString(),
            order_number: order.orderNumber,
            weight: 0.25 * order.details.units,
            weight_unit: "kg",
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
