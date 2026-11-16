import puppeteer from '@cloudflare/puppeteer';
import { fetchOrderDetails, getOrders, login } from './fullworks';
import { getExistingOrders, getToken, syncOrdersToGoogleSheet } from './google';
import { getShippoToken, parseAddress, createShippoOrder } from './shippo';

export default {
  async fetch(req, env) {
    const { pathname } = new URL(req.url);
    if (pathname === '/') {
      await this.scheduled(req, env);
      return new Response(`A run has been completed.`);
    }
    return new Response(`To trigger a run use base path`, { status: 404 });
  },

  async scheduled(event, env) {
    let browser;
    try {
      const googleToken = await getToken(env);
      const { headers, existingOrderRowMap } = await getExistingOrders(
        googleToken,
        env
      );

      browser = await puppeteer.launch(env.FullWorks);
      const page = await browser.newPage();
      await login(page, env);
      const orders = await getOrders(page, env);

      orders.sort((a, b) => a.orderNumber - b.orderNumber);

      const shippoToken = await getShippoToken(env);

      for (const order of orders) {
        const orderKey = String(order.orderNumber).trim();
        const isNewOrder = !existingOrderRowMap.has(orderKey);
        let needsDetails = isNewOrder;
        if (!needsDetails) {
          const prior = existingOrderRowMap.get(orderKey);
          needsDetails = !prior.units || !prior.fulfillment || !prior.email;
          if (prior.name != order.name) {
            console.log(
              'Name difference for order #',
              orderKey,
              prior.name,
              order.name
            );
          }
        }
        if (needsDetails && order.detailsUrl) {
          const detailsUrl = `${env.baseurl}${order.detailsUrl}`;
          order.details = await fetchOrderDetails(detailsUrl, page);
          console.log('enriched new order' + JSON.stringify(order));
          if (order.details.fulfillment === 'Shipping') {
            const address = await parseAddress(
              shippoToken,
              order.details.shippingAddress
            );
            await createShippoOrder(shippoToken, address, order);
          }
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
