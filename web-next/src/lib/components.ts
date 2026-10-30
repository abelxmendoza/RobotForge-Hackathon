/* Curated component identities. Geometry is an envelope, never manufacturer CAD.
 * Do not infer a third-party carrier's dimensions or pinout from a module name. */
export interface ComponentDefinition {
  id: string; name: string; aliases: string[];
  sizeM: [number, number, number]; geometry: 'published-envelope' | 'illustrative';
  source: string; note: string; missing: string[];
}
export const COMPONENTS: ComponentDefinition[] = [{
  id: 'jetson-orin-nano-reference-devkit', name: 'Jetson Orin Nano — NVIDIA reference developer kit',
  aliases: ['jetson orin nano', 'jetson orin nano developer kit', 'nvidia jetson orin nano', 'orin nano devkit'],
  sizeM: [0.100, 0.079, 0.021], geometry: 'published-envelope',
  source: 'https://developer.nvidia.com/blog/develop-ai-powered-robots-smart-vision-systems-and-more-with-nvidia-jetson-orin-nano-developer-kit',
  note: 'NVIDIA publishes a 100 × 79 × 21 mm kit envelope. Confirm the reference carrier and your actual cooling hardware. This is a simple envelope, not detailed CAD; connectors and mounting holes are not modelled.',
  missing: ['Mounting-hole coordinates', 'Port and cooling keep-outs', 'Actual mass', 'Confirmed carrier revision and power requirements', 'Connector pin assignments'],
}, {
  id: 'battery-envelope', name: 'Battery — planning placeholder', aliases: ['battery', 'battery placeholder'],
  sizeM: [0.100, 0.035, 0.030], geometry: 'illustrative', source: '',
  note: 'Illustrative 100 × 35 × 30 mm box only. Not a battery recommendation or confirmed physical part.',
  missing: ['Exact battery model', 'Measured dimensions and mass', 'Minimum and maximum pack voltage', 'Continuous and peak current', 'Connector pin assignments', 'Protection requirements'],
}, {
  id: 'converter-envelope', name: 'DC converter — planning placeholder', aliases: ['buck converter', 'converter', 'dc converter'],
  sizeM: [0.045, 0.025, 0.015], geometry: 'illustrative', source: '',
  note: 'Illustrative 45 × 25 × 15 mm box only. Buck, boost or buck-boost topology and ratings remain unselected.',
  missing: ['Exact converter model and topology', 'Measured dimensions and mass', 'Input and output voltage ranges', 'Derated current and thermal capacity', 'Connector pin assignments'],
}];
export function resolveComponent(query: string): ComponentDefinition {
  const q = query.trim().toLowerCase();
  const matches = COMPONENTS.filter(c => c.id === q || c.name.toLowerCase() === q || c.aliases.includes(q));
  if (matches.length !== 1) throw new Error('Choose a supported component: Jetson Orin Nano (NVIDIA reference kit), battery placeholder, or buck converter placeholder.');
  return matches[0];
}
export const componentById = (id: string) => COMPONENTS.find(c => c.id === id);
