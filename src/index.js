import loginAndReadOrders from './fullworks';
import syncOrdersToGoogleSheet from './google';

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
    const orders = await loginAndReadOrders(env);

    await syncOrdersToGoogleSheet(orders, env);
  },
};
