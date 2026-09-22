import assert from 'node:assert/strict';
import test from 'node:test';
import { pageIssues, redirectIssues, robotsAllows, sitemapUrls } from '../scripts/check-seo.mjs';
const canonical = 'https://docs.airscale.io/api-reference/email-finder';
const html = `<html><head><meta content="index, follow" name="robots"><link href="${canonical}" rel="canonical"><title>Email finder</title><meta name="description" content="Find a professional email"></head><body>Reference</body></html>`;
test('SEO checker accepts indexable HTML and rejects hidden header or page exclusions', () => {
  assert.deepEqual(pageIssues({status:200,html,headers:new Headers(),canonical}),[]);
  assert.ok(pageIssues({status:200,html,headers:new Headers({'X-Robots-Tag':'googlebot: noindex'}),canonical}).some(x=>x.includes('noindex')));
  assert.ok(pageIssues({status:200,html:html.replace('index, follow','none'),headers:new Headers(),canonical}).some(x=>/indexing/i.test(x)));
  assert.ok(pageIssues({status:200,html:html.replace(canonical,'https://airscale.mintlify.app/email'),headers:new Headers(),canonical}).some(x=>x.includes('canonical')));
  assert.ok(pageIssues({status:404,html,headers:new Headers(),canonical}).some(x=>x.includes('200')));
});
test('staging checks require a general noindex directive instead of allowing indexable pages', () => {
  const check = (source, headers = new Headers()) => pageIssues({status:200,html:source,headers,canonical,indexing:'noindex'});
  assert.deepEqual(check(html.replace('index, follow','noindex, follow')), []);
  assert.deepEqual(check(html,new Headers({'X-Robots-Tag':'noindex'})), []);
  assert.ok(check(html).some(x=>x.includes('Staging must declare noindex')));
  assert.ok(check(html.replace('name="robots"','name="googlebot"').replace('index, follow','noindex')).length);
  assert.ok(check(html,new Headers({'X-Robots-Tag':'googlebot: noindex'})).length);
});
test('SEO checker requires an exact permanent redirect with no chain', () => {
  assert.deepEqual(redirectIssues(308,'/mcp/airscale-mcp-server','/mcp/airscale-mcp-server','http://localhost:3210'),[]);
  assert.ok(redirectIssues(307,'/mcp/airscale-mcp-server','/mcp/airscale-mcp-server','http://localhost:3210').length);
  assert.ok(redirectIssues(308,'https://other.example/mcp','/mcp','http://localhost:3210').length);
});
test('robots evaluation respects Googlebot specificity and longest allow rule', () => {
  assert.equal(robotsAllows('User-agent: *\nDisallow: /\n','/api-reference/email-finder'),false);
  assert.equal(robotsAllows('User-agent: *\nAllow: /\nUser-agent: Googlebot\nDisallow: /api-reference/','/api-reference/email-finder'),false);
  assert.equal(robotsAllows('User-agent: *\nDisallow: /\nAllow: /api-reference/','/api-reference/email-finder'),true);
});
test('sitemap parsing decodes XML and rejects malformed or duplicate URLs', () => {
  assert.deepEqual(sitemapUrls('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://docs.airscale.io/</loc></url></urlset>'),['https://docs.airscale.io/']);
  assert.throws(()=>sitemapUrls('<html>not a sitemap</html>'));
});
