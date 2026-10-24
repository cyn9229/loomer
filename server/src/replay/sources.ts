// Two fixed research pages for the repeatable demo. They
// are labeled demonstration material and contain simple, inspectable facts, so
// the demo does not depend on live websites that can change or disappear.
import { Hono } from 'hono';

const page = (title: string, body: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<style>body{font:17px/1.6 Georgia,serif;max-width:680px;margin:40px auto;padding:0 16px;color:#1d1d1f}
.label{font:12px system-ui;color:#555;border:1px solid #ccc;padding:4px 8px;display:inline-block}</style></head>
<body><p class="label">Demonstration material for Loomer. Not a real publication.</p>
<article><h1>${title}</h1>${body}</article></body></html>`;

export const sourceRoutes = new Hono()
  .get('/sources/heat-islands', (c) =>
    c.html(
      page(
        'Heat Islands and Urban Temperatures',
        `<p>Cities are often warmer than nearby rural areas. This is called the urban heat island effect.</p>
<p>Roads and roofs absorb sunlight during the day and release heat at night. In the example city in this brief, downtown nights were about 5 degrees Fahrenheit warmer than the surrounding countryside.</p>
<p>The brief lists three responses: reflective roofs, more green space, and more street trees.</p>`,
      ),
    ),
  )
  .get('/sources/tree-cover', (c) =>
    c.html(
      page(
        'Street Trees and Neighborhood Cooling',
        `<p>A neighborhood study in the example city measured afternoon street temperatures on blocks with different tree cover.</p>
<p>Blocks with more than 40 percent tree canopy were about 4 degrees Fahrenheit cooler than blocks with less than 10 percent canopy.</p>
<p>The study notes that new trees take years to grow, so planting now affects temperatures later.</p>`,
      ),
    ),
  );
