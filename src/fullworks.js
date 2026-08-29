import puppeteer from '@cloudflare/puppeteer';

export default async function loginAndReadOrders(env) {
  const login = JSON.parse(env.fullworkslogin);

  let browser;
  browser = await puppeteer.launch(env.FullWorks);
  const page = await browser.newPage();

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

  // 5. Navigate to orders page using active browser session
  const targetUrl = env.orderurl;
  await page.goto(targetUrl, { waitUntil: 'networkidle0' });

  // Wait for table
  await page.waitForSelector('#orders-table');

  // 6. Extract and parse row data
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

  await browser.close();

  return orders;
}
