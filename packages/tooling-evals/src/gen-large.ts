import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Generates a >1 MB documentation-style page to test converter latency,
// memory, and robustness on large inputs. No golden (perf/robustness only).
const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, '..', 'fixtures', 'large-page');
mkdirSync(dir, { recursive: true });

const para =
  'This paragraph documents one configuration field in detail, covering ' +
  'its default value, accepted range, interaction with related settings, ' +
  'and the failure modes observed when it is misconfigured in production.';

const sections: string[] = [];
let i = 0;
while (sections.join('').length < 1_200_000) {
  i++;
  sections.push(`
    <section>
      <h2>Setting group ${i}</h2>
      <p>${para}</p>
      <h3>field_${i}_a</h3>
      <p>${para} ${para}</p>
      <pre><code class="language-yaml">field_${i}_a: true
field_${i}_b: 30s
field_${i}_c: [alpha, beta, gamma]</code></pre>
      <ul>
        <li>Item one for group ${i} with explanatory text.</li>
        <li>Item two for group ${i} with a <a href="/ref/${i}">reference</a>.</li>
        <li>Item three for group ${i}.</li>
      </ul>
      <table>
        <tr><th>Key</th><th>Default</th></tr>
        <tr><td>field_${i}_a</td><td>true</td></tr>
        <tr><td>field_${i}_b</td><td>30s</td></tr>
      </table>
    </section>`);
}

const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Large config reference</title></head>
<body>
  <nav><a href="/">Home</a> <a href="/docs">Docs</a></nav>
  <main><article>
    <h1>Configuration reference</h1>
    <p>Exhaustive reference for every configuration field.</p>
    ${sections.join('\n')}
  </article></main>
  <footer><p>&copy; 2026 Example</p></footer>
</body></html>`;

writeFileSync(join(dir, 'input.html'), html);
writeFileSync(join(dir, 'fixture.json'), JSON.stringify({
  url: 'https://docs.example/config/reference',
  category: 'large',
  notes: `Generated >1MB documentation page (${
    (html.length / 1_048_576).toFixed(1)
  } MB). Perf/memory/robustness only, no golden.`,
}, null, 2) + '\n');

process.stderr.write(`Wrote large-page fixture (${
  (html.length / 1_048_576).toFixed(2)} MB)\n`);
