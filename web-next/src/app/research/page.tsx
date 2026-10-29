import AppShell from '@/components/shell/AppShell';
import Research from '@/components/workspace/Research';
export const metadata={title:'Robotics research'};
export default function Page(){return <AppShell active="research" crumbs={[{label:'App',href:'/forge/'},{label:'Research'}]}><Research/></AppShell>}
