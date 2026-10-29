import { createEngine, type RobotData, type PartData, type TemplateData, type KindData, type ReportsData, type IntentsData } from './engine';
import { robots, parts, gateReports } from '@/lib/data';
import partsDoc from '@/data/parts.json';
import kindsDoc from '@/data/kinds.json';
import intentsDoc from '@/data/chat-intents.json';
export function buildCatalogEngine() {
 const templates=(partsDoc as unknown as {templates?:TemplateData[]}).templates || [];
 return createEngine({robots:robots as unknown as RobotData[],parts:parts as unknown as PartData[],templates:templates.length,templateList:templates,kinds:(kindsDoc as {kinds?:KindData[]}).kinds || [],reports:{runs:gateReports} as unknown as ReportsData,intents:intentsDoc as unknown as IntentsData,root:''});
}
