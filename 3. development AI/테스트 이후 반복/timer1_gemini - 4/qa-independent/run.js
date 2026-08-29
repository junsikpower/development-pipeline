const H = require('./harness');
const files = process.argv.slice(2);
(async () => {
  for (const f of files) {
    const run = require('./' + f);
    await run();
  }
  const total = H.results.length;
  const failed = H.results.filter(r => r.status === 'FAIL');
  console.log('\n================ SUMMARY ================');
  console.log(`total ${total} / pass ${total - failed.length} / fail ${failed.length}`);
  if (failed.length) {
    console.log('\nFAILED:');
    failed.forEach(r => console.log(` - ${r.id} [${r.prdRef}] ${r.name}\n     ${r.error}`));
  }
  require('fs').writeFileSync('results.json', JSON.stringify(H.results, null, 2));
  process.exit(0);
})().catch(e => { console.error('RUNNER ERROR', e); process.exit(1); });
