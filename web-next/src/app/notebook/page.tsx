import AppShell from '@/components/shell/AppShell';
import Notebook from '@/components/workspace/Notebook';
export const metadata={title:'My robot notebook'};
export default function Page(){return <AppShell showChat={false} active="notebook" crumbs={[{label:'App',href:'/forge/'},{label:'Notebook'}]}><Notebook/></AppShell>}
