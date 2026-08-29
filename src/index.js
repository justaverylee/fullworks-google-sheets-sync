import puppeteer from '@cloudflare/puppeteer';
import { fetchOrderDetails, getOrders, login } from './fullworks';
import {
  getExistingOrderKeys,
  getToken,
  syncOrdersToGoogleSheet,
} from './google';

export default {
  async fetch(req) {
    const url = new URL(req.url);
    url.pathname = '/__scheduled';
    url.searchParams.append('cron', '0 * * * *');
    return new Response(
      `To test the scheduled handler, ensure you have used the "--test-scheduled" then try running "curl ${url.href}".`
    );
  },

  async scheduled(event, env, ctx) {
    let browser;
    try {
      const googleToken = await getToken(env);
      const { headers, existingOrderRowMap } = await getExistingOrderKeys(
        googleToken,
        env
      );

      browser = await puppeteer.launch(env.FullWorks);
      const page = await browser.newPage();
      await login(page, env);
      const orders = await getOrders(page, env);

      orders.sort((a, b) => a.orderNumber - b.orderNumber);

      for (const order of orders) {
        const orderKey = String(order.orderNumber).trim();
        const isNewOrder = !existingOrderRowMap.has(orderKey);
        if (isNewOrder && order.detailsUrl) {
          const detailsUrl = `${env.baseurl}${order.detailsUrl}`;
          order.details = await fetchOrderDetails(detailsUrl, page);
          console.log("enriched new order" + JSON.stringify(order));
        }
      }

      await browser.close();
      browser = undefined;

      await syncOrdersToGoogleSheet(
        googleToken,
        headers,
        orders,
        existingOrderRowMap,
        env
      );
    } catch (error) {
      if (browser) await browser.close();
      console.log('Closing browser while catching error', error);
      throw error;
    }
  },
};
