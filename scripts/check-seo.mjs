import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

const decode = value => value.replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&#39;', "'");
function tags(html, name) {
  const head = html.split(/<\/head\s*>/i)[0];
  return [...head.matchAll(new RegExp(`<${name}\\b([^>]*)>`, 'gi'))].map(([, source]) =>
    Object.fromEntries([...source.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)].map(([, key, a, b, c]) => [key.toLowerCase(), decode(a ?? b ?? c)])));
}
export function pageIssues({status, html, headers, canonical, indexing = 'index'}) {
  const issues = [];
  if (status !== 200) issues.push(`Expected 200, received ${status}`);
  const links = tags(html, 'link').filter(x => x.rel?.toLowerCase() === 'canonical');
  if (links.length !== 1 || links[0].href !== canonical) issues.push(`Expected one canonical ${canonical}; received ${links.map(x=>x.href).join(', ')}`);
  const meta = tags(html, 'meta');
  const robotValues = [headers.get('x-robots-tag') ?? '', ...meta.filter(x => /^(robots|googlebot)$/i.test(x.name)).map(x=>x.content ?? '')];
  if (indexing === 'noindex') {
    const header = headers.get('x-robots-tag') ?? '';
    const generalValues = [...meta.filter(x=>x.name?.toLowerCase()==='robots').map(x=>x.content ?? ''), ...(!header.includes(':') ? [header] : [])];
    if (!generalValues.some(x=>/\b(noindex|none)\b/i.test(x))) issues.push('Staging must declare noindex for all search engines');
  } else if (robotValues.some(x => /\b(noindex|none)\b/i.test(x))) issues.push('Indexing blocked by noindex/none in a tag or header');
  if (!/<title>[^<]+<\/title>/i.test(html)) issues.push('Missing title');
  if (!meta.some(x=>x.name?.toLowerCase()==='description' && x.content?.trim())) issues.push('Missing description');
  return issues;
}
export function redirectIssues(status, location, destination, base) {
  const issues = [];
  if (![301,308].includes(status)) issues.push(`Expected permanent 301/308; received ${status}`);
  if (!location || new URL(location, base).href !== new URL(destination, base).href) issues.push(`Expected redirect to ${destination}; received ${location}`);
  return issues;
}
export function robotsAllows(source, path, agent = 'googlebot') {
  const groups = []; let group; let rulesStarted = false;
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.split('#')[0].trim(); const colon = line.indexOf(':');
    if (colon < 0) continue;
    const key = line.slice(0,colon).toLowerCase(); const value = line.slice(colon+1).trim();
    if (key === 'user-agent') {
      if (!group || rulesStarted) {group = {agents:[],rules:[]}; groups.push(group); rulesStarted=false;}
      group.agents.push(value.toLowerCase());
    } else if (['allow','disallow'].includes(key) && group) {rulesStarted=true; if(value) group.rules.push({key,value});}
  }
  const specific = groups.filter(g=>g.agents.some(a=>a!=='*' && agent.includes(a)));
  const selected = specific.length ? specific : groups.filter(g=>g.agents.includes('*'));
  const matching = selected.flatMap(g=>g.rules).filter(({value})=>{
    const regex = value.split('*').map(part=>part.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('.*').replace(/\\\$$/,'$');
    return new RegExp('^'+regex).test(path);
  }).sort((a,b)=>b.value.length-a.value.length || (a.key==='allow' ? -1 : 1));
  return !matching.length || matching[0].key==='allow';
}
export function sitemapUrls(xml) {
  const doc = new DOMParser({onError:()=>{throw new Error('Malformed sitemap XML');}}).parseFromString(xml,'application/xml');
  if(doc.documentElement?.localName!=='urlset') throw new Error('Expected a sitemap urlset');
  const urls = Array.from(doc.getElementsByTagName('loc'), x=>x.textContent.trim());
  if(new Set(urls).size !== urls.length) throw new Error('Duplicate sitemap URLs');
  return urls;
}
export async function checkSeo({base,manifest,fetcher=fetch}) {
  const origin = new URL(base).origin;
  const results = [];
  async function get(path) {
    const r=await fetcher(new URL(path,origin),{redirect:'manual',signal:AbortSignal.timeout(20000)});
    return {status:r.status,headers:r.headers,html:await r.text()};
  }
  async function check(path, fn) {
    try { const r=await get(path); results.push({path,status:r.status,issues:fn(r)}); }
    catch(error) {results.push({path,issues:[error.message]});}
  }
  let robots='';
  await check('/robots.txt', r=>{ robots=r.html; return [
    ...(r.status===200?[]:[`Expected 200; received ${r.status}`]),
    ...(r.html.includes(`Sitemap: ${manifest.documentationOrigin}/sitemap.xml`)?[]:['Missing production sitemap directive'])
  ];});
  await check('/sitemap.xml',r=>{
    if(r.status!==200) return [`Expected 200; received ${r.status}`];
    const urls=sitemapUrls(r.html); const expected=manifest.indexablePages.map(p=>manifest.documentationOrigin+p);
    return [...expected.filter(u=>!urls.includes(u)).map(u=>`Missing sitemap URL: ${u}`), ...urls.filter(u=>!expected.includes(u)).map(u=>`Unexpected sitemap URL: ${u}`)];
  });
  const tasks = [...manifest.indexablePages.map(path=>({path,canonical:manifest.documentationOrigin+path})),
    ...manifest.routes.filter(r=>r.behavior==='redirect').map(r=>({path:r.source,destination:r.destination}))];
  let cursor=0;
  await Promise.all(Array.from({length:4},async()=>{
    while(cursor<tasks.length) {
      const task=tasks[cursor++];
      await check(task.path,r=>task.destination ? redirectIssues(r.status,r.headers.get('location'),task.destination,origin) : [
        ...pageIssues({...r,canonical:task.canonical,indexing:manifest.indexing ?? 'index'}),
        ...(robotsAllows(robots,task.path)?[]:['robots.txt blocks Googlebot'])
      ]);
    }
  }));
  await check('/__airscale_seo_missing_page__',r=>r.status===404?[]:[`Missing page must return 404, received ${r.status}`]);
  results.sort((a,b)=>a.path.localeCompare(b.path));
  return {base:origin,checkedAt:new Date().toISOString(),checked:results.length,passed:results.filter(r=>!r.issues.length).length,failures:results.filter(r=>r.issues.length),results};
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const args=process.argv.slice(2);
  if(args.length!==4 || args[0]!=='--base' || args[2]!=='--manifest') throw new Error('Usage: node scripts/check-seo.mjs --base https://docs.airscale.io --manifest /absolute/publication-manifest.json');
  const report=await checkSeo({base:args[1],manifest:JSON.parse(readFileSync(args[3],'utf8'))});
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
  if(report.failures.length) process.exitCode=1;
}
