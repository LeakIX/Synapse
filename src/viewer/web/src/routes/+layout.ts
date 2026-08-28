/**
 * The viewer is one static page. It reads live data from the Bun server in
 * the browser, so there is nothing to render on a server and nothing to
 * prerender per route.
 */
export const prerender = true;
export const ssr = false;
