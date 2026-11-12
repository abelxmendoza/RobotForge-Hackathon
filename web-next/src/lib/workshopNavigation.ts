/** Legacy links retain their panel while selecting one of five primary tabs. */
export function workshopMainTab(tab: string): string {
  if (['bom', 'tools', 'drivetrain'].includes(tab)) return 'build';
  if (tab === 'simulate') return 'checks';
  if (tab === 'specs') return 'overview';
  return tab;
}
