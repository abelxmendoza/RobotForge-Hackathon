import type {Metadata} from 'next';
import AppShell from '@/components/shell/AppShell';
import RoverDesigner from '@/components/design/RoverDesigner';
export const metadata:Metadata={title:'Design a rover',description:'Describe a rover, choose catalogue parts, assemble your design and generate a consistent CAD and build package.'};
export default function DesignPage(){return <AppShell active="design" wide crumbs={[{label:'Design a rover'}]}><div className="page-head"><div><h1>Design a rover</h1><p className="lede">From an idea to parts, assembly and build files.</p></div></div><RoverDesigner/></AppShell>;}
