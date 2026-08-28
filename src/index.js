/**
 * Welcome to Cloudflare Workers!
 *
 * This is a template for a Scheduled Worker: a Worker that can run on a
 * configurable interval:
 * https://developers.cloudflare.com/workers/platform/triggers/cron-triggers/
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Run `curl "http://localhost:8787/__scheduled?cron=0+*+*+*+*"` to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

export default {
	async fetch(req) {
		const url = new URL(req.url)
		url.pathname = "/__scheduled";
		url.searchParams.append("cron", "0 * * * *");
		return new Response(`To test the scheduled handler, ensure you have used the "--test-scheduled" then try running "curl ${url.href}".`);
	},

	// The scheduled handler is invoked at the interval set in our wrangler.jsonc's
	// [[triggers]] configuration.
	async scheduled(event, env, ctx) {
		const login = JSON.parse(env.fullworkslogin);
		const loginPage = await fetch(env.loginurl);

		let csrfToken = "";

		// Set up HTMLRewriter to target the specific input field
		const rewriter = new HTMLRewriter().on('input[name="_csrf_token"]', {
			element(element) {
				csrfToken = element.getAttribute("value") || "";
			},
		});

		await rewriter.transform(response).text();

		console.log("Extracted CSRF Token:", csrfToken);
	},
};
