/** One catalogue-backed concept generator for Workshop and Wrench. No persistence. */
import {generateRobot, parseBrief, type ArchetypeId, type CataloguePart, type ForgeSpec} from './forgeEngine';

export function designConcept(brief: string, catalogue: CataloguePart[], previous?: ForgeSpec): ForgeSpec {
  if (/\b(humanoid|biped|quadruped|legged)\b/i.test(brief)) throw new Error('The local concept engine supports rovers, robot arms and multirotors. Upload a compatible model for this robot class.');
    const priorType: Record<string,ArchetypeId> = {differential:'differential_rover',skid_steer:'differential_rover',mecanum:'mecanum_rover',robotic_arm:'robotic_arm',multirotor:'multirotor'};
    const parsed = parseBrief(brief);
    if (previous) {
      if (!/\b(rover|drone|multirotor|arm|mecanum)\b/i.test(brief)) parsed.archetype = priorType[String(previous.drivetrain)] ?? parsed.archetype;
      if (!/\b(compact|small|mini|tiny|desktop|large|big|heavy|outdoor|bigger|standard)\b/i.test(brief)) parsed.size = previous.conceptSize || 'standard';
      const priorSensors = Object.keys(previous.forge?.ids || {}).filter((key) => ['camera','depth_camera','lidar','imu','ultrasonic'].includes(key));
      parsed.sensors = [...new Set([...parsed.sensors,...priorSensors])].filter((sensor) => !new RegExp(`(?:without|remove)(?: the| a)? ${sensor.replace('_',' ')}`, 'i').test(brief));
    }
    const spec = generateRobot(parsed,catalogue);
    if (!spec?.forge?.bom?.length) throw new Error('I could not ground that idea in catalogue parts. Describe a rover, robot arm or multirotor.');
    spec.conceptBrief = brief;
    spec.conceptSize = parsed.size;
    if (previous) spec.name = previous.name;
    return spec;
}

/** A proposal can only apply to the clean robot still on the bench. */
export function canApplyDesign(targetId: string, baselineId: string, selectedId: string | undefined, latestId: string | undefined, draftDirty: boolean): boolean {
  return targetId === selectedId && baselineId === latestId && !draftDirty;
}
