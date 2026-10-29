import AppShell from '@/components/shell/AppShell';
import Workspace from '@/components/workspace/Workspace';
export const metadata={title:'Data workspace'};
export default function Page(){return <AppShell active="data" crumbs={[{label:'App',href:'/forge/'},{label:'Data'}]}><Workspace/></AppShell>}
