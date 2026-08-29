export async function login(page, env) {
  const login = JSON.parse(env.fullworkslogin);

  // 1. Navigate to login page
  await page.goto(env.loginurl, {
    waitUntil: 'networkidle0',
  });

  // 2. Wait for input fields
  await page.waitForSelector('#user_email');
  await page.waitForSelector('#user_password');

  // 3. Type user credentials
  await page.type('#user_email', login.user);
  await page.type('#user_password', login.password);

  // 4. Submit form via form element directly or button inside #login_form
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle0' }),
    page.click('#login_form button'),
  ]);
}

export async function getOrders(page, env) {
  const targetUrl = env.orderurl;
  await page.goto(targetUrl, { waitUntil: 'networkidle0' });

  // Wait for table
  await page.waitForSelector('#orders-table');

  const orders = await page.evaluate(() => {
    const rows = Array.from(
      document.querySelectorAll('#orders-table tr.group')
    );

    return rows.map((row) => {
      const cells = Array.from(row.querySelectorAll('td'));

      const idInput = cells[0]?.querySelector('input[phx-value-id]');
      const id = idInput ? idInput.getAttribute('phx-value-id') : null;

      const name = cells[1]?.textContent.trim() || '';
      const orderNumber = cells[2]?.textContent.trim() || '';
      const createdAt = cells[3]?.textContent.trim() || '';
      const status = cells[4]?.textContent.trim() || '';
      const totalPrice = cells[5]?.textContent.trim() || '';

      const detailsAnchor = cells[6]?.querySelector('a');
      const detailsUrl = detailsAnchor
        ? detailsAnchor.getAttribute('href')
        : null;

      return {
        id,
        name,
        orderNumber,
        createdAt,
        status,
        totalPrice,
        detailsUrl,
      };
    });
  });

  return orders;
}

export async function fetchOrderDetails(detailsUrl, page) {
  try {
    // Navigate to the full order details page using the active browser session
    await page.goto(detailsUrl, { waitUntil: 'networkidle0' });

    // Extract details directly from the DOM
    const details = await page.evaluate(() => {
      // Helper function to find text in table rows by matching label cells
      function getValueByLabel(labelText) {
        const rows = Array.from(document.querySelectorAll('tr'));
        for (const row of rows) {
          const cells = Array.from(row.querySelectorAll('td'));
          if (cells.length >= 2 && cells[0].textContent.includes(labelText)) {
            return cells[1].textContent.trim();
          }
        }
        return '';
      }

      // 1. Parse Shipping Method (Fulfillment)
      const fulfillment = getValueByLabel('Shipping Method') || 'Unknown';

      // 2. Parse Email
      const email = getValueByLabel('Email') || '';

      // 3. Parse Units (Summing up the 'Quantity' column from #order-items)
      let totalUnits = 0;
      const orderItemsTable = document.querySelector('#order-items');

      if (orderItemsTable) {
        // Only select item rows (skipping subtotal/tax summary rows)
        const itemRows = Array.from(
          orderItemsTable.querySelectorAll('tr.group')
        );

        for (const row of itemRows) {
          const cells = Array.from(row.querySelectorAll('td'));
          // Quantity is in the 3rd column (index 2)
          if (cells.length >= 3) {
            const qtyText = cells[2].textContent.trim();
            const qty = parseInt(qtyText, 10);
            if (!isNaN(qty)) {
              totalUnits += qty;
            }
          }
        }
      }

      return {
        email,
        fulfillment,
        units: totalUnits,
      };
    });

    return details;
  } catch (error) {
    console.error(`Failed to fetch details for ${detailsUrl}:`, error);
    throw error;
  }
}
