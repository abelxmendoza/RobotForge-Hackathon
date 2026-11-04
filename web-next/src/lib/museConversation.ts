/* Frontend context adapter for the frozen Worker's 2,000-character message API.
 * Context is conversation data, never a claim that an action has executed. */
export type ConversationTurn = {who:'user'|'bot';text?:string;html?:string};
function plain(t:ConversationTurn):string {
  return (t.text ?? t.html ?? '').replace(/<[^>]*>/g,' ').replace(/&(?:rsquo|#39);/g,"'").replace(/&amp;/g,'&').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim();
}
export function conversationMessage(question:string,turns:ConversationTurn[]):string {
  if(question.length>2000)throw new Error('This message exceeds the current 2,000-character service limit. Please split it into shorter messages.');
  const recent=turns.filter(t=>plain(t)&&!/^Checking|^Asking the live model/.test(plain(t)));
  if(recent.at(-1)?.who==='user'&&plain(recent.at(-1)!)===question.trim())recent.pop();
  const ending='\nCurrent user request: '+question;
  const intro='Recent conversation (context only; do not claim actions were completed):\n';
  let remaining=2000-intro.length-ending.length;
  const lines:string[]=[];
  for(const t of recent.slice(-8).reverse()){
    const line=(t.who==='user'?'User: ':'Assistant: ')+plain(t).slice(0,550)+'\n';
    if(line.length>remaining)continue;
    lines.unshift(line);remaining-=line.length;
  }
  return lines.length?intro+lines.join('')+ending:question;
}
export function spawnDesignPrompt(question:string,turns:ConversationTurn[]):string|null {
  if(/[?]/.test(question)||/\b(not|never|don't|dont)\b/i.test(question))return null;
  if(!/^(?:please\s+)?(?:spawn|create|build|make|generate|save)\s+(?:it|that|this)(?:\s+(?:robot|rover|car))?(?:\s|$)/i.test(question.trim()))return null;
  const descriptions=turns.filter(t=>t.who==='user'&&/\b(robot|rover|car|freenove|motor|servo|raspberry|camera|chassis)\b/i.test(plain(t))).map(plain).slice(-6);
  if(!descriptions.length)return null;
  return 'Create a distinct new robot concept with these user-provided details. Do not substitute or clone a reference robot. Keep unknown dimensions and ratings explicitly estimated; this is not hardware-validated.\n'+descriptions.join('\n').slice(-1400)+'\nLatest instruction: '+question;
}
export function researchQuery(question:string,turns:ConversationTurn[]):string|null {
  if(!/\b(?:look\s*up|search\s+(?:for|online|the web)|familiar\s+with.+online)\b/i.test(question))return null;
  const prior=turns.filter(t=>t.who==='user'&&/\b(freenove|fnk\d+|raspberry|robot|rover|car)\b/i.test(plain(t))).map(plain).slice(-2).join(' ');
  return (prior+' '+question).trim().slice(-700);
}
export function contextualWebIntent(question:string,turns:ConversationTurn[],detected:{kind:'scrape';url:string}|{kind:'search';query:string}|null):{kind:'scrape';url:string}|{kind:'search';query:string}|null {
  if(detected?.kind==='scrape')return detected;
  const query=researchQuery(question,turns);
  return query?{kind:'search',query}:detected;
}
